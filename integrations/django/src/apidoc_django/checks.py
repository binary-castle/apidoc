from django.core import checks

from . import conf


def check_bundle(app_configs, **kwargs):
    """Warn when running from a source checkout whose JS bundle was never built."""
    if conf.get("BUNDLE_URL"):
        return []
    from django.contrib.staticfiles import finders

    if finders.find(conf.BUNDLE_STATIC_PATH):
        return []
    return [
        checks.Warning(
            "The apidoc JS bundle is missing, so /docs pages will render empty.",
            hint=(
                "Wheels from PyPI include it. In a source checkout run `pnpm build:django` "
                "in the apidoc repo, or set APIDOC['BUNDLE_URL'] to a CDN copy."
            ),
            id="apidoc_django.W001",
        )
    ]
