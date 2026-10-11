"""
Settings-driven URLconf:

    path("docs/", include("apidoc_django.urls"))

with ``APIDOC = {"SCHEMA_URL": "schema"}`` in settings.
"""

from django.urls import path

from .views import ApiDocView

app_name = "apidoc"

urlpatterns = [
    path("", ApiDocView.as_view(), name="docs"),
]
