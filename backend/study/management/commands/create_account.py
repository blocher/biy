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

    def handle(self, username, seed, **options):
        User = get_user_model()
        if User.objects.filter(username=username).exists():
            self.stdout.write("Account already exists; password unchanged.")
            return
        user = User(username=username)
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
            + (" Set a password with manage.py changepassword." if seed else "")
        )
