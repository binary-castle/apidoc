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
}

BUNDLE_STATIC_PATH = "apidoc_django/apidoc.js"


def get(name):
    return getattr(settings, "APIDOC", {}).get(name, DEFAULTS[name])
