from django.db import models


class Customer(models.Model):
    email = models.EmailField(unique=True, help_text="Unique per account. Used for receipts.")
    name = models.CharField(max_length=256, blank=True)
    country = models.CharField(max_length=2, blank=True, help_text="ISO-3166 alpha-2 country code.")
    balance = models.IntegerField(default=0, help_text="Balance in the smallest currency unit.")
    archived = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.email


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        SUCCEEDED = "succeeded"
        FAILED = "failed"
        REFUNDED = "refunded"

    customer = models.ForeignKey(Customer, related_name="payments", on_delete=models.CASCADE)
    amount = models.PositiveIntegerField(help_text="Amount in the smallest currency unit, e.g. 4900 for £49.00.")
    currency = models.CharField(max_length=3, default="gbp")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    description = models.CharField(max_length=500, blank=True)
    created = models.DateTimeField(auto_now_add=True)
