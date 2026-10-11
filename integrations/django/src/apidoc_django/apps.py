from django.apps import AppConfig
from django.core import checks


class ApidocConfig(AppConfig):
    name = "apidoc_django"
    verbose_name = "apidoc"

    def ready(self):
        from .checks import check_bundle

        checks.register(check_bundle, checks.Tags.staticfiles)
