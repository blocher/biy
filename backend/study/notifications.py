"""Optional SMTP notifications; never prevent a reflection from being saved."""

import logging
from html import escape

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives

from .models import Note

logger = logging.getLogger(__name__)


def notify_shared_note(note_id):
    from .push_notifications import enqueue_shared_note

    enqueue_shared_note(note_id)
    if not all(
        (
            settings.EMAIL_HOST,
            settings.EMAIL_HOST_USER,
            settings.EMAIL_HOST_PASSWORD,
            settings.DEFAULT_FROM_EMAIL,
        )
    ):
        return
    note = Note.objects.select_related("user", "episode").filter(pk=note_id, shared=True).first()
    if note is None:
        return
    edition = (
        "catechism"
        if note.catechism_day_id or (note.episode_id and note.episode.edition == "catechism")
        else "bible"
    )
    day_id = note.day_id or note.catechism_day_id
    target = f"day/{day_id}" if day_id else f"episode/{note.episode_id}"
    url = f"{settings.PUBLIC_APP_URL}/{target}?edition={edition}"
    author = note.user.get_full_name() or note.user.username
    name = "Catechism in a Year" if edition == "catechism" else "Bible in a Year"
    subject = f"A new shared reflection · {name}"
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
    users = (
        users.exclude(profile__catechism_enabled=False)
        if edition == "catechism"
        else users.exclude(profile__bible_enabled=False)
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
