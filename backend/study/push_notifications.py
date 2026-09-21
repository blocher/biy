"""Durable Web Push planning and delivery for reminders and shared reflections."""

import json
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from pywebpush import WebPushException, webpush

from .models import (
    CatechismDayProgress,
    CommunitySettings,
    DayProgress,
    Note,
    Profile,
    PushDelivery,
    PushSubscription,
)

logger = logging.getLogger(__name__)
REMINDER_GRACE = timedelta(minutes=15)
MAX_ATTEMPTS = 5


def _zone(name):
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(settings.TIME_ZONE)


def _community_start(edition):
    state = CommunitySettings.objects.filter(pk=1).first()
    if state is not None:
        if edition == "catechism" and state.catechism_start_date:
            return state.catechism_start_date
        return state.start_date
    return date.fromisoformat(settings.LEADERBOARD_START_DATE)


def expected_day(profile, edition, today):
    """Return the scheduled plan day, matching the client-side schedule bases."""
    progress_model = DayProgress if edition == "bible" else CatechismDayProgress
    basis = profile.progress_basis if edition == "bible" else profile.catechism_progress_basis
    if basis == "first-completion":
        first = (
            progress_model.objects.filter(user=profile.user, completed_at__isnull=False)
            .order_by("completed_at")
            .values_list("completed_at", flat=True)
            .first()
        )
        if first is None:
            return None
        start = first.astimezone(_zone(profile.notification_timezone)).date()
    elif basis == "leaderboard":
        start = _community_start(edition)
    else:
        start = date(today.year, 1, 1)
    return max(0, min(365, (today - start).days + 1))


def incomplete_editions(profile, today):
    incomplete = []
    editions = (
        ("bible", "Bible in a Year", profile.bible_enabled, DayProgress),
        (
            "catechism",
            "Catechism in a Year",
            profile.catechism_enabled,
            CatechismDayProgress,
        ),
    )
    for edition, label, enabled, progress_model in editions:
        if not enabled:
            continue
        day_number = expected_day(profile, edition, today)
        if day_number is None or day_number == 0:
            continue
        complete = progress_model.objects.filter(
            user=profile.user, day_id=day_number, completed_at__isnull=False
        ).exists()
        if not complete:
            incomplete.append((edition, label, day_number))
    return incomplete


def _reminder_payload(profile, slot, incomplete):
    if incomplete:
        if len(incomplete) == 1:
            edition, label, day_number = incomplete[0]
            return {
                "title": f"{slot.title()} reading reminder",
                "body": f"Day {day_number} of {label} is ready when you are.",
                "url": f"/day/{day_number}?edition={edition}",
            }
        return {
            "title": f"{slot.title()} reading reminder",
            "body": "Today’s Bible and Catechism readings are ready when you are.",
            "url": "/?edition=bible",
        }
    edition = "bible" if profile.bible_enabled else "catechism"
    return {
        "title": f"{slot.title()} reading reminder",
        "body": "Take a quiet moment for today’s reading.",
        "url": f"/?edition={edition}",
    }


def enqueue_due_reminders(now=None):
    now = now or timezone.now()
    created = 0
    profiles = Profile.objects.filter(
        ~Q(reminder_condition="never"), user__is_active=True
    ).select_related("user")
    for profile in profiles:
        subscriptions = list(profile.user.push_subscriptions.all())
        if not subscriptions:
            continue
        zone = _zone(profile.notification_timezone)
        local_now = now.astimezone(zone)
        slots = (
            ("morning", profile.morning_reminder_enabled, profile.morning_reminder_time),
            ("evening", profile.evening_reminder_enabled, profile.evening_reminder_time),
        )
        for slot, enabled, target_time in slots:
            if not enabled:
                continue
            target = datetime.combine(local_now.date(), target_time, zone)
            if not target <= local_now < target + REMINDER_GRACE:
                continue
            incomplete = incomplete_editions(profile, local_now.date())
            if profile.reminder_condition == "incomplete" and not incomplete:
                continue
            payload = _reminder_payload(profile, slot, incomplete)
            dedupe_key = f"{profile.user_id}:{local_now.date().isoformat()}:{slot}"
            for subscription in subscriptions:
                _, was_created = PushDelivery.objects.get_or_create(
                    subscription=subscription,
                    kind="reminder",
                    dedupe_key=dedupe_key,
                    defaults={"payload": payload},
                )
                created += int(was_created)
    return created


def enqueue_shared_note(note_id):
    note = (
        Note.objects.select_related("user", "episode")
        .filter(pk=note_id, shared=True)
        .first()
    )
    if note is None:
        return 0
    edition = (
        "catechism"
        if note.catechism_day_id or (note.episode_id and note.episode.edition == "catechism")
        else "bible"
    )
    day_id = note.day_id or note.catechism_day_id
    target = f"/day/{day_id}" if day_id else f"/episode/{note.episode_id}"
    author = note.user.get_full_name() or note.user.username
    payload = {
        "title": "New shared reflection",
        "body": f"{author} shared a {note.kind}.",
        "url": f"{target}?edition={edition}",
    }
    subscriptions = PushSubscription.objects.filter(
        user__is_active=True,
        user__profile__shared_push_notifications=True,
    ).exclude(user=note.user)
    subscriptions = (
        subscriptions.filter(user__profile__catechism_enabled=True)
        if edition == "catechism"
        else subscriptions.filter(user__profile__bible_enabled=True)
    )
    created = 0
    for subscription in subscriptions:
        _, was_created = PushDelivery.objects.get_or_create(
            subscription=subscription,
            kind="shared-note",
            dedupe_key=str(note.pk),
            defaults={"payload": payload},
        )
        created += int(was_created)
    return created


def _status_code(exc):
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None)


def deliver_push_batch(limit=25, now=None):
    if not all(
        (
            settings.WEB_PUSH_VAPID_SUBJECT,
            settings.WEB_PUSH_VAPID_PUBLIC_KEY,
            settings.WEB_PUSH_VAPID_PRIVATE_KEY,
        )
    ):
        return 0
    now = now or timezone.now()
    ids = list(
        PushDelivery.objects.filter(
            sent_at__isnull=True, attempts__lt=MAX_ATTEMPTS, available_at__lte=now
        )
        .order_by("available_at", "pk")
        .values_list("pk", flat=True)[:limit]
    )
    sent = 0
    for delivery_id in ids:
        delivery = PushDelivery.objects.select_related("subscription").filter(pk=delivery_id).first()
        if delivery is None or delivery.sent_at is not None:
            continue
        delivery.attempts += 1
        delivery.available_at = now + timedelta(minutes=min(60, 2**delivery.attempts))
        delivery.save(update_fields=["attempts", "available_at"])
        subscription = delivery.subscription
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps(delivery.payload),
                vapid_private_key=settings.WEB_PUSH_VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.WEB_PUSH_VAPID_SUBJECT},
                ttl=86400,
                timeout=10,
            )
        except WebPushException as exc:
            if _status_code(exc) in {404, 410}:
                subscription.delete()
                continue
            delivery.last_error = str(exc)[:500]
            delivery.save(update_fields=["last_error"])
            logger.warning("Web Push delivery %s failed: %s", delivery.pk, exc)
            continue
        except Exception as exc:
            delivery.last_error = str(exc)[:500]
            delivery.save(update_fields=["last_error"])
            logger.exception("Web Push delivery %s failed", delivery.pk)
            continue
        delivery.sent_at = timezone.now()
        delivery.last_error = ""
        delivery.save(update_fields=["sent_at", "last_error"])
        sent += 1
    return sent
