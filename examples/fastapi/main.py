"""
FastAPI example used to develop and test apidoc-fastapi.

    .venv/bin/uvicorn main:app --port 8001

apidoc is at /docs; FastAPI's Swagger UI moved to /swagger for comparison.
"""

import time
from datetime import datetime, timezone
from enum import Enum
from itertools import count
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from apidoc_fastapi import mount_apidoc
from oauth_server import require
from oauth_server import router as oauth_router

app = FastAPI(
    title="Orbit Payments API",
    version="1.0.0",
    summary="FastAPI flavour of the Orbit example.",
    docs_url="/swagger",
    openapi_tags=[
        {"name": "Customers", "description": "Customers you can attach payments to."},
        {"name": "Payments", "description": "Charge customers and refund payments."},
    ],
)
mount_apidoc(app, "/docs", oauth_client_id="orbit-docs", oauth_scopes=["profile"])
app.include_router(oauth_router)

# The apidoc UI dev server (any local port) loads this API cross-origin.
# /docs above is same-origin and needs none of this.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$", allow_methods=["*"], allow_headers=["*"])


class Address(BaseModel):
    line1: str
    city: str | None = None
    postal_code: str | None = None
    country: Annotated[str, Field(min_length=2, max_length=2, description="ISO-3166 alpha-2 country code.", examples=["GB"])]


class CustomerCreate(BaseModel):
    email: EmailStr = Field(description="Unique per account. Used for receipts.")
    name: Annotated[str | None, Field(max_length=256)] = None
    address: Address | None = None
    metadata: dict[str, str] = {}


class Customer(CustomerCreate):
    id: int
    balance: int = Field(0, description="Balance in the smallest currency unit.")
    created: datetime


class PaymentStatus(str, Enum):
    pending = "pending"
    succeeded = "succeeded"
    refunded = "refunded"


class PaymentCreate(BaseModel):
    customer_id: int
    amount: Annotated[int, Field(ge=50, description="Amount in the smallest currency unit, e.g. 4900 for £49.00.")]
    currency: Annotated[str, Field(pattern="^(gbp|usd|eur)$")] = "gbp"


class Payment(PaymentCreate):
    id: int
    status: PaymentStatus


customers: dict[int, Customer] = {}
payments: dict[int, Payment] = {}
ids = count(1)


@app.get("/v1/customers", tags=["Customers"], summary="List customers")
def list_customers(email: Annotated[str | None, Query(description="Filter by exact email.")] = None, limit: Annotated[int, Query(ge=1, le=100)] = 10) -> list[Customer]:
    found = [c for c in customers.values() if email is None or c.email == email]
    return found[:limit]


@app.post("/v1/customers", tags=["Customers"], summary="Create a customer", status_code=status.HTTP_201_CREATED,
          responses={409: {"description": "A customer with this email already exists."}})
def create_customer(body: CustomerCreate) -> Customer:
    if any(c.email == body.email for c in customers.values()):
        raise HTTPException(status.HTTP_409_CONFLICT, "A customer with this email already exists.")
    customer = Customer(**body.model_dump(), id=next(ids), created=datetime.now(timezone.utc))
    customers[customer.id] = customer
    return customer


@app.get("/v1/customers/{customer_id}", tags=["Customers"], summary="Retrieve a customer", responses={404: {"description": "Not found."}})
def get_customer(customer_id: int) -> Customer:
    if customer_id not in customers:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found.")
    return customers[customer_id]


@app.delete("/v1/customers/{customer_id}", tags=["Customers"], summary="Delete a customer", deprecated=True, status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(customer_id: int) -> None:
    customers.pop(customer_id, None)


@app.post("/v1/payments", tags=["Payments"], summary="Create a payment", status_code=status.HTTP_201_CREATED)
def create_payment(body: PaymentCreate) -> Payment:
    if body.customer_id not in customers:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found.")
    payment = Payment(**body.model_dump(), id=next(ids), status=PaymentStatus.succeeded)
    payments[payment.id] = payment
    return payment


@app.post("/v1/payments/{payment_id}/refund", tags=["Payments"], summary="Refund a payment")
def refund_payment(payment_id: int) -> Payment:
    if payment_id not in payments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found.")
    payments[payment_id].status = PaymentStatus.refunded
    return payments[payment_id]


class Me(BaseModel):
    subject: str = Field(description="The user, or the client for client credentials.")
    scopes: list[str]
    flow: str = Field(description="The OAuth grant that issued the token.")
    expires_in: int


@app.get("/v1/me", tags=["Account"], summary="Who am I", responses={401: {"description": "Missing or expired token."}, 403: {"description": "Token lacks the profile scope."}})
def me(token: Annotated[dict, require("profile")]) -> Me:
    """Needs an OAuth token with the `profile` scope. Use **Authorize** to sign in."""
    return Me(subject=token["sub"], scopes=token["scopes"], flow=token["flow"], expires_in=int(token["exp"] - time.time()))
