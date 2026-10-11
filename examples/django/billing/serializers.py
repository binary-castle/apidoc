from rest_framework import serializers

from .models import Customer, Payment


class AddressSerializer(serializers.Serializer):
    line1 = serializers.CharField()
    city = serializers.CharField(required=False)
    postal_code = serializers.CharField(required=False)
    country = serializers.CharField(max_length=2, help_text="ISO-3166 alpha-2 country code.")


class CustomerSerializer(serializers.ModelSerializer):
    address = AddressSerializer(required=False, write_only=True)
    metadata = serializers.DictField(child=serializers.CharField(), required=False)

    class Meta:
        model = Customer
        fields = ["id", "email", "name", "country", "balance", "archived", "address", "metadata", "created"]
        read_only_fields = ["id", "balance", "archived", "created"]

    def create(self, validated_data):
        validated_data.pop("address", None)
        validated_data.pop("metadata", None)
        return super().create(validated_data)


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "customer", "amount", "currency", "status", "description", "created"]
        read_only_fields = ["id", "status", "created"]


class RefundSerializer(serializers.Serializer):
    amount = serializers.IntegerField(required=False, min_value=1, help_text="Partial refund amount. Omit to refund in full.")
    reason = serializers.ChoiceField(choices=["duplicate", "fraudulent", "requested_by_customer"], required=False)
