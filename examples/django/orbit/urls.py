from django.contrib import admin
from django.urls import include, path
from apidoc_django.views import ApiDocView
from drf_spectacular.views import SpectacularAPIView
from drf_yasg.views import get_schema_view
from rest_framework import permissions, routers

from billing.views import CustomerViewSet, PaymentViewSet
from orbit.swagger import info

router = routers.DefaultRouter()
router.register("customers", CustomerViewSet)
router.register("payments", PaymentViewSet)

# drf-yasg emits Swagger 2.0 — kept here so apidoc is tested against both generators.
yasg_view = get_schema_view(
    info,
    public=True,
    permission_classes=[permissions.AllowAny],
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include(router.urls)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", ApiDocView.as_view(schema_url="schema", title="Orbit Payments API")),
    path("api/swagger.json", yasg_view.without_ui(cache_timeout=0), name="swagger-json"),
]
