from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Customer, Payment
from .serializers import CustomerSerializer, PaymentSerializer, RefundSerializer


@extend_schema_view(
    list=extend_schema(summary="List customers", parameters=[
        OpenApiParameter("email", str, description="Filter by exact email."),
        OpenApiParameter("archived", bool, description="Include archived customers."),
    ]),
    create=extend_schema(summary="Create a customer", description=(
        "Creates a customer you can attach payment methods and subscriptions to. "
        "Emails are unique per account — sending a duplicate returns 400 with the existing customer id."
    )),
    retrieve=extend_schema(summary="Retrieve a customer"),
    partial_update=extend_schema(summary="Update a customer"),
    update=extend_schema(summary="Replace a customer"),
    destroy=extend_schema(summary="Delete a customer", deprecated=True, description="Deprecated: use the archive endpoint instead."),
)
@extend_schema(tags=["Customers"])
class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().order_by("-created")
    serializer_class = CustomerSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        email = self.request.query_params.get("email")
        if email:
            queryset = queryset.filter(email=email)
        if self.request.query_params.get("archived") not in ("true", "1"):
            queryset = queryset.filter(archived=False)
        return queryset

    @extend_schema(summary="Archive a customer", request=None, responses=CustomerSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        customer = self.get_object()
        customer.archived = True
        customer.save(update_fields=["archived"])
        return Response(CustomerSerializer(customer).data)


@extend_schema_view(
    list=extend_schema(summary="List payments"),
    create=extend_schema(summary="Create a payment"),
    retrieve=extend_schema(summary="Retrieve a payment"),
)
@extend_schema(tags=["Payments"])
class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.all().order_by("-created")
    serializer_class = PaymentSerializer
    http_method_names = ["get", "post", "head", "options"]

    def perform_create(self, serializer):
        serializer.save(status=Payment.Status.SUCCEEDED)

    @extend_schema(summary="Refund a payment", request=RefundSerializer, responses=PaymentSerializer)
    @action(detail=True, methods=["post"])
    def refund(self, request, pk=None):
        payment = self.get_object()
        RefundSerializer(data=request.data).is_valid(raise_exception=True)
        payment.status = Payment.Status.REFUNDED
        payment.save(update_fields=["status"])
        return Response(PaymentSerializer(payment).data, status=status.HTTP_200_OK)
