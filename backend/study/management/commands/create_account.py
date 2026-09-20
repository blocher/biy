import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create an account (default ben) using a hidden password prompt."

    def add_arguments(self, parser):
        parser.add_argument("username", nargs="?", default="ben")
        parser.add_argument(
            "--seed",
            action="store_true",
            help="Seed with an unusable password; run changepassword to activate.",
        )
        parser.add_argument(
            "--admin",
            action="store_true",
            help="Allow this account to manage other BIY accounts.",
        )

    def handle(self, username, seed, admin, **options):
        User = get_user_model()
        existing = User.objects.filter(username=username).first()
        make_admin = admin or username == "ben"
        if existing:
            if make_admin and not existing.is_staff:
                existing.is_staff = True
                existing.save(update_fields=["is_staff"])
                self.stdout.write("Account already exists; administrator access enabled.")
            else:
                self.stdout.write("Account already exists; password unchanged.")
            return
        user = User(username=username, is_staff=make_admin)
        if seed:
            user.set_unusable_password()
        else:
            password = getpass.getpass("Password: ")
            if password != getpass.getpass("Repeat password: "):
                raise CommandError("Passwords do not match.")
            try:
                validate_password(password, user)
            except ValidationError as exc:
                raise CommandError("; ".join(exc.messages)) from exc
            user.set_password(password)
        user.save()
        self.stdout.write(
            f"Created {username}."
            + (" Administrator access enabled." if make_admin else "")
            + (" Set a password with manage.py changepassword." if seed else "")
        )
