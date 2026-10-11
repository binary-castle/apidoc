"""Settings, read from ``settings.APIDOC`` with these defaults."""

from django.conf import settings

DEFAULTS = {
    # URL name (e.g. "schema" for drf-spectacular), path, or absolute URL of the spec.
    "SCHEMA_URL": None,
    # Page <title>; defaults to "API Reference".
    "TITLE": None,
    # "dark" or "light"; None follows the viewer's choice, then their OS.
    "THEME": None,
    # Load the bundle from a CDN instead of this package's static files.
    "BUNDLE_URL": None,
    # Send Django's CSRF token on unsafe same-origin "Try it" requests (session auth).
    "CSRF": True,
    # Older releases for the changelog, newest first:
    # [{"version": "1.2.0", "url": "/static/openapi-1.2.0.yaml", "date": "2026-09-18"}]
    "VERSIONS": [],
    # Arazzo 1.x document with runnable multi-step workflows: URL name, path or absolute URL.
    "WORKFLOWS_URL": None,
    # Branding. ACCENT is any CSS colour; the palette for both themes is derived from it.
    "ACCENT": None,
    # Logo for the top bar (and a variant for the dark theme). These and the two below
    # take a static file path ("img/logo.svg"), a URL path or an absolute URL.
    "LOGO": None,
    "LOGO_DARK": None,
    # Stylesheet applied inside the docs after the built-in theme (override --ad-* tokens).
    "CSS_URL": None,
    "FAVICON": None,
    # OAuth sign-in defaults for the playground: the docs' client id and scopes to preselect.
    # Register the docs URL as a redirect URI with your provider.
    "OAUTH_CLIENT_ID": None,
    "OAUTH_SCOPES": [],
}

BUNDLE_STATIC_PATH = "apidoc_django/apidoc.js"


def get(name):
    return getattr(settings, "APIDOC", {}).get(name, DEFAULTS[name])
