from django.http import JsonResponse
from django.urls import include, path

from apidoc_django.views import ApiDocView


def schema(request):
    return JsonResponse({"openapi": "3.1.0", "info": {"title": "t", "version": "1"}, "paths": {}})


urlpatterns = [
    path("api/schema/", schema, name="schema"),
    path("docs/", ApiDocView.as_view(schema_url="schema")),
    path(
        "docs-custom/",
        ApiDocView.as_view(schema_url="/openapi.yaml", title="<b>Orbit</b>", theme="light", bundle_url="https://cdn.example/apidoc.js", csrf=False),
    ),
    path("docs-unresolvable/", ApiDocView.as_view(schema_url="no-such-url-name")),
    path("docs-from-settings/", include("apidoc_django.urls")),
]
