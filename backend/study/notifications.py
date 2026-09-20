"""Optional SMTP notifications; never prevent a reflection from being saved."""

import logging
from html import escape

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives

from .models import Note

logger = logging.getLogger(__name__)


def notify_shared_note(note_id):
    if not all(
        (
            settings.EMAIL_HOST,
            settings.EMAIL_HOST_USER,
            settings.EMAIL_HOST_PASSWORD,
            settings.DEFAULT_FROM_EMAIL,
        )
    ):
        return
    note = Note.objects.select_related("user").filter(pk=note_id, shared=True).first()
    if note is None:
        return
    target = f"day/{note.day_id}" if note.day_id else f"episode/{note.episode_id}"
    url = f"{settings.PUBLIC_APP_URL}/{target}"
    author = note.user.get_full_name() or note.user.username
    subject = "A new shared reflection · Bible in a Year"
    body = (
        f"{author} shared a {note.kind}.\n\nRead it in your study space: {url}\n\n"
        f"Manage email notifications: {settings.PUBLIC_APP_URL}/account"
    )
    users = (
        get_user_model()
        .objects.filter(is_active=True)
        .exclude(email="")
        .exclude(profile__email_notifications=False)
    )
    for user in users:
        recipients = [user.email]
        if settings.EMAIL_DELIVERY_MODE != "production":
            recipients = [
                address.strip()
                for address in settings.EMAIL_REDIRECT_TO.split(",")
                if address.strip()
            ]
        if not recipients:
            continue
        try:
            message = EmailMultiAlternatives(subject, body, settings.DEFAULT_FROM_EMAIL, recipients)
            message.attach_alternative(
                f"<p>{escape(author)} shared a {escape(note.kind)}.</p>"
                f'<p><a href="{escape(url, quote=True)}">Read the reflection</a></p>'
                f'<p><a href="{escape(settings.PUBLIC_APP_URL, quote=True)}/account">Manage email notifications</a></p>',
                "text/html",
            )
            message.send()
        except Exception:
            logger.exception("Shared reflection email failed for user %s", user.pk)
