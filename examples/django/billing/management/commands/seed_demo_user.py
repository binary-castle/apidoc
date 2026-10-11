import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

# Local example only: a known login for trying session auth in /docs/.
DEFAULT_USERNAME = "demo"
DEFAULT_PASSWORD = "orbit-demo-password"


class Command(BaseCommand):
    help = "Create (or reset) a staff user for trying session-authenticated requests in /docs/."

    def handle(self, *args, **options):
        username = os.environ.get("DEMO_USERNAME", DEFAULT_USERNAME)
        password = os.environ.get("DEMO_PASSWORD", DEFAULT_PASSWORD)
        user, created = get_user_model().objects.get_or_create(username=username, defaults={"is_staff": True})
        user.is_staff = True
        user.set_password(password)
        user.save()
        self.stdout.write(f"{'Created' if created else 'Reset'} staff user {username!r}. Log in at /admin/, then open /docs/.")
