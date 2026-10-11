import json

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.middleware.csrf import get_token
from django.templatetags.static import static
from django.urls import NoReverseMatch, reverse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.generic import TemplateView

from . import conf

THEMES = {"dark", "light"}


def resolve_schema_url(value):
    """Accept an absolute URL, a path, or a URL name such as "schema"."""
    if not value:
        raise ImproperlyConfigured(
            "apidoc needs the URL of your OpenAPI schema: pass ApiDocView.as_view(schema_url=...) "
            'or set APIDOC = {"SCHEMA_URL": "schema"} (drf-spectacular\'s default URL name).'
        )
    if value.startswith(("/", "http://", "https://")):
        return value
    try:
        return reverse(value)
    except NoReverseMatch as error:
        raise ImproperlyConfigured(
            f"apidoc schema_url {value!r} is not a path or a URL name that reverse() can resolve."
        ) from error


def csrf_header_name():
    """settings.CSRF_HEADER_NAME is a META key ("HTTP_X_CSRFTOKEN"); turn it into a header name."""
    meta_name = settings.CSRF_HEADER_NAME
    if meta_name.startswith("HTTP_"):
        meta_name = meta_name[len("HTTP_"):]
    return meta_name.replace("_", "-")


@method_decorator(never_cache, name="dispatch")
class ApiDocView(TemplateView):
    """
    Renders the apidoc reference for your schema.

        path("docs/", ApiDocView.as_view(schema_url="schema"))

    Docs served from the API's own domain make "Try it" work without CORS,
    and session-authenticated users can send unsafe requests because the
    page passes Django's CSRF token to the playground.

    Wrap it like any view to restrict access, e.g. ``staff_member_required(ApiDocView.as_view(...))``.
    """

    template_name = "apidoc_django/docs.html"
    schema_url = None
    title = None
    theme = None
    bundle_url = None
    csrf = None
    versions = None

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        theme = self.theme or conf.get("THEME")
        if theme and theme not in THEMES:
            raise ImproperlyConfigured(f"apidoc theme must be 'dark', 'light' or None, not {theme!r}.")
        csrf = conf.get("CSRF") if self.csrf is None else self.csrf
        cookie_readable = not (settings.CSRF_USE_SESSIONS or settings.CSRF_COOKIE_HTTPONLY)
        versions = self.versions if self.versions is not None else conf.get("VERSIONS")
        context.update(
            schema_url=resolve_schema_url(self.schema_url or conf.get("SCHEMA_URL")),
            title=self.title or conf.get("TITLE") or "API Reference",
            theme=theme,
            bundle_url=self.bundle_url or conf.get("BUNDLE_URL") or static(conf.BUNDLE_STATIC_PATH),
            csrf_header=csrf_header_name() if csrf else None,
            # Prefer the live cookie (rotated on login); the embedded token covers HttpOnly/session storage.
            csrf_cookie=settings.CSRF_COOKIE_NAME if csrf and cookie_readable else None,
            csrf_token_value=get_token(self.request) if csrf else None,
            # django-csp and Django 6's built-in CSP both expose the per-request nonce here.
            csp_nonce=getattr(self.request, "csp_nonce", None),
            # JSON for the element's `versions` attribute; the template escapes it.
            versions_json=json.dumps(versions) if versions else None,
        )
        return context
