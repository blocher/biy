import re
from datetime import date as calendar_date
from datetime import datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Max, Min, Q
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError
from ninja.security import django_auth
from pydantic import Field

from .catechism_audio import align_catechism_audio
from .catechism_content import paragraph_data
from .chat_api import router as chat_router
from .commentaries import (
    CommentaryRange,
    commentary_ranges_for_readings,
    commentary_rows,
    matching_references,
    ordered_commentary_ids,
    year_label,
)
from .models import (
    CatechismDay,
    CatechismDayProgress,
    CatechismParagraph,
    Commentary,
    CommentaryAuthor,
    CommunitySettings,
    Day,
    DayProgress,
    Episode,
    EpisodeProgress,
    LoginAttempt,
    Note,
    Profile,
    PushSubscription,
)
from .scripture import reading_text, reference_ranges
from .scripture_audio import align_scripture_audio
from .site_search import reading_locations, site_search

api = NinjaAPI(title="Bible in a Year", auth=django_auth, docs_url=None)


@api.get("/search")
def search(request, q: str):
    if len(q.strip()) < 2 or len(q) > 120:
        raise HttpError(422, "Enter 2–120 characters to search.")
    return site_search(request.user, q)


def requested_edition(request):
    edition = request.GET.get("edition", "bible")
    if edition not in {"bible", "catechism"}:
        raise HttpError(422, "Choose the Bible or Catechism edition.")
    return edition


def edition_enabled(profile, edition):
    return profile.bible_enabled if edition == "bible" else profile.catechism_enabled


class LoginIn(Schema):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=256)


class CompleteIn(Schema):
    completed: bool


class CompletedAtIn(Schema):
    completed_on: calendar_date


class PositionIn(Schema):
    position: float = Field(ge=0, le=86400, allow_inf_nan=False)


class NoteIn(Schema):
    body: str = Field(min_length=1, max_length=50000)
    kind: Literal["note", "journal"] = "note"
    shared: bool = False
    audio_time: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)
    quote: str = Field(default="", max_length=10000)
    citation: str = Field(default="", max_length=500)
    source_url: str = Field(default="", max_length=1000)


class AccountIn(Schema):
    username: str = Field(min_length=1, max_length=150)
    first_name: str = Field(default="", max_length=150)
    last_name: str = Field(default="", max_length=150)
    email: str = Field(default="", max_length=254)


class AdminUserCreateIn(AccountIn):
    password: str = Field(min_length=8, max_length=256)
    is_active: bool = True
    is_admin: bool = False
    leaderboard_visible: bool = True
    email_notifications: bool = True
    progress_basis: Literal["first-completion", "leaderboard", "january-1"] = "first-completion"


class AdminUserUpdateIn(AccountIn):
    password: str | None = Field(default=None, min_length=8, max_length=256)
    is_active: bool
    is_admin: bool
    leaderboard_visible: bool
    email_notifications: bool
    progress_basis: Literal["first-completion", "leaderboard", "january-1"]


def community_settings():
    return CommunitySettings.objects.get_or_create(
        pk=1, defaults={"start_date": calendar_date.fromisoformat(settings.LEADERBOARD_START_DATE)}
    )[0]


def edition_start_date(state, edition):
    return (
        state.start_date if edition == "bible" else (state.catechism_start_date or state.start_date)
    )


def require_admin(request):
    if not request.user.is_staff:
        raise HttpError(403, "Administrator access is required.")


def clean_account_fields(payload, *, excluding_user=None):
    username = payload.username.strip()
    email = payload.email.strip()
    if not username:
        raise HttpError(422, "Choose a user name.")
    if email:
        try:
            validate_email(email)
        except ValidationError:
            raise HttpError(422, "Enter a valid email address.")
    users = get_user_model().objects.all()
    if excluding_user is not None:
        users = users.exclude(pk=excluding_user.pk)
    if users.filter(username__iexact=username).exists():
        raise HttpError(422, "That user name is already taken.")
    return {
        "username": username,
        "first_name": payload.first_name.strip(),
        "last_name": payload.last_name.strip(),
        "email": email,
    }


def admin_user_data(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "is_active": user.is_active,
        "is_admin": user.is_staff,
        "has_usable_password": user.has_usable_password(),
        "date_joined": user.date_joined,
        "last_login": user.last_login,
        "leaderboard_visible": profile.leaderboard_visible,
        "email_notifications": profile.email_notifications,
        "progress_basis": profile.progress_basis,
        "completed_days": DayProgress.objects.filter(user=user, completed_at__isnull=False).count(),
        "journal_entries": Note.objects.filter(user=user, kind="journal").count(),
    }


class CommunitySettingsIn(Schema):
    start_date: calendar_date
    confirm_affects_everyone: Literal[True]


@api.put("/community-settings")
def update_community_settings(request, payload: CommunitySettingsIn):
    state = community_settings()
    edition = requested_edition(request)
    field = "start_date" if edition == "bible" else "catechism_start_date"
    setattr(state, field, payload.start_date)
    state.save(update_fields=[field])
    return {"leaderboard_start_date": edition_start_date(state, edition)}


class PreferencesIn(Schema):
    progress_basis: Literal["first-completion", "leaderboard", "january-1"] | None = None
    leaderboard_visible: bool | None = None
    email_notifications: bool | None = None
    bible_enabled: bool | None = None
    catechism_enabled: bool | None = None
    notification_timezone: str | None = Field(default=None, min_length=1, max_length=64)
    reminder_condition: Literal["incomplete", "always", "never"] | None = None
    morning_reminder_enabled: bool | None = None
    morning_reminder_time: time | None = None
    evening_reminder_enabled: bool | None = None
    evening_reminder_time: time | None = None
    shared_push_notifications: bool | None = None
    notification_setup_completed: bool | None = None


class PushSubscriptionIn(Schema):
    endpoint: str = Field(min_length=1, max_length=4096)
    p256dh: str = Field(min_length=1, max_length=1024)
    auth: str = Field(min_length=1, max_length=1024)
    device_name: str = Field(default="Browser", min_length=1, max_length=120)


class PushSubscriptionDeleteIn(Schema):
    endpoint: str = Field(min_length=1, max_length=4096)


@api.get("/preferences")
def preferences(request):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    edition = requested_edition(request)
    return {
        "edition": edition,
        "progress_basis": (
            profile.progress_basis if edition == "bible" else profile.catechism_progress_basis
        ),
        "leaderboard_visible": profile.leaderboard_visible,
        "email_notifications": profile.email_notifications,
        "bible_enabled": profile.bible_enabled,
        "catechism_enabled": profile.catechism_enabled,
        "notification_timezone": profile.notification_timezone,
        "reminder_condition": profile.reminder_condition,
        "morning_reminder_enabled": profile.morning_reminder_enabled,
        "morning_reminder_time": profile.morning_reminder_time.strftime("%H:%M"),
        "evening_reminder_enabled": profile.evening_reminder_enabled,
        "evening_reminder_time": profile.evening_reminder_time.strftime("%H:%M"),
        "shared_push_notifications": profile.shared_push_notifications,
        "notification_setup_completed": profile.notification_setup_completed,
        "leaderboard_start_date": edition_start_date(community_settings(), edition),
    }


@api.patch("/preferences")
def update_preferences(request, payload: PreferencesIn):
    profile, _ = Profile.objects.get_or_create(user=request.user)
    changes = payload.dict(exclude_none=True)
    if "notification_timezone" in changes:
        try:
            ZoneInfo(changes["notification_timezone"])
        except ZoneInfoNotFoundError as exc:
            raise HttpError(422, "Choose a valid time zone.") from exc
    edition = requested_edition(request)
    if "progress_basis" in changes and edition == "catechism":
        changes["catechism_progress_basis"] = changes.pop("progress_basis")
    bible_enabled = changes.get("bible_enabled", profile.bible_enabled)
    catechism_enabled = changes.get("catechism_enabled", profile.catechism_enabled)
    if not bible_enabled and not catechism_enabled:
        raise HttpError(422, "Keep at least one edition enabled.")
    for key, value in changes.items():
        setattr(profile, key, value)
    if changes:
        profile.save(update_fields=list(changes))
    return preferences(request)


@api.get("/push/public-key")
def push_public_key(request):
    if not settings.WEB_PUSH_VAPID_PUBLIC_KEY:
        raise HttpError(503, "Push notifications are not configured yet.")
    return {"public_key": settings.WEB_PUSH_VAPID_PUBLIC_KEY}


@api.post("/push/subscriptions")
def save_push_subscription(request, payload: PushSubscriptionIn):
    subscription, _ = PushSubscription.objects.update_or_create(
        endpoint=payload.endpoint,
        defaults={
            "user": request.user,
            "p256dh": payload.p256dh,
            "auth": payload.auth,
            "device_name": payload.device_name.strip(),
            "last_seen_at": timezone.now(),
        },
    )
    return {"subscribed": True, "id": subscription.pk}


@api.get("/push/subscriptions")
def push_subscriptions(request):
    return [
        {
            "id": subscription.pk,
            "endpoint": subscription.endpoint,
            "device_name": subscription.device_name,
            "created_at": subscription.created_at,
            "last_seen_at": subscription.last_seen_at,
        }
        for subscription in PushSubscription.objects.filter(user=request.user).order_by(
            "-last_seen_at"
        )
    ]


@api.put("/push/subscriptions/current")
def touch_push_subscription(request, payload: PushSubscriptionDeleteIn):
    subscription = get_object_or_404(PushSubscription, user=request.user, endpoint=payload.endpoint)
    subscription.last_seen_at = timezone.now()
    subscription.save(update_fields=["last_seen_at"])
    return {"last_seen_at": subscription.last_seen_at}


@api.delete("/push/subscriptions")
def delete_push_subscription(request, payload: PushSubscriptionDeleteIn):
    PushSubscription.objects.filter(user=request.user, endpoint=payload.endpoint).delete()
    return {"subscribed": False}


@api.delete("/push/subscriptions/{subscription_id}")
def delete_push_subscription_by_id(request, subscription_id: int):
    get_object_or_404(PushSubscription, user=request.user, pk=subscription_id).delete()
    return {"subscribed": False}


@api.get("/leaderboard")
def leaderboard(request):
    edition = requested_edition(request)
    rows = []
    progress = {}
    progress_model = DayProgress if edition == "bible" else CatechismDayProgress
    for state in progress_model.objects.filter(completed_at__isnull=False):
        progress.setdefault(state.user_id, []).append(state)
    for user in (
        get_user_model().objects.filter(is_active=True).exclude(profile__leaderboard_visible=False)
    ):
        profile = getattr(user, "profile", None)
        if profile is not None and not edition_enabled(profile, edition):
            continue
        states = progress.get(user.pk, [])
        completed = {state.day_id for state in states}
        rows.append(
            {
                "id": user.pk,
                "name": user.get_full_name() or user.username,
                "completed": len(completed),
                "current_day": next((day for day in range(1, 366) if day not in completed), None),
                "first_completed": min((state.completed_at for state in states), default=None),
            }
        )
    return sorted(rows, key=lambda row: (-row["completed"], row["name"].casefold(), row["id"]))


class PasswordIn(Schema):
    new_password: str = Field(min_length=8, max_length=256)


@api.get("/session", auth=None)
def session(request):
    return {
        "user": (
            {"username": request.user.username, "is_admin": request.user.is_staff}
            if request.user.is_authenticated
            else None
        ),
        "csrf": get_token(request),
    }


@api.post("/login", auth=None)
@csrf_protect
def sign_in(request, payload: LoginIn):
    address = request.META.get("REMOTE_ADDR", "127.0.0.1")
    cutoff = timezone.now() - timedelta(minutes=15)
    if LoginAttempt.objects.filter(address=address, attempted_at__gte=cutoff).count() >= 10:
        raise HttpError(429, "Too many sign-in attempts. Please try again in 15 minutes.")
    LoginAttempt.objects.create(address=address)
    user = authenticate(request, username=payload.username, password=payload.password)
    if user is None:
        raise HttpError(401, "Username or password is incorrect.")
    login(request, user)
    LoginAttempt.objects.filter(address=address).delete()
    LoginAttempt.objects.filter(attempted_at__lt=cutoff).delete()
    return JsonResponse(
        {
            "user": {"username": user.username, "is_admin": user.is_staff},
            "csrf": get_token(request),
        }
    )


@api.post("/logout")
def sign_out(request):
    logout(request)
    return {"ok": True}


@api.get("/account")
def account(request):
    return {
        "username": request.user.username,
        "first_name": request.user.first_name,
        "last_name": request.user.last_name,
        "email": request.user.email,
    }


@api.put("/account")
def update_account(request, payload: AccountIn):
    changes = clean_account_fields(payload, excluding_user=request.user)
    for field, value in changes.items():
        setattr(request.user, field, value)
    request.user.save(update_fields=list(changes))
    return account(request)


@api.put("/account/password")
def update_password(request, payload: PasswordIn):
    try:
        validate_password(payload.new_password, request.user)
    except ValidationError as exc:
        raise HttpError(422, "; ".join(exc.messages)) from exc
    request.user.set_password(payload.new_password)
    request.user.save(update_fields=["password"])
    return {"ok": True}


@api.get("/admin/users")
def admin_users(request):
    require_admin(request)
    return [
        admin_user_data(user)
        for user in get_user_model().objects.order_by("first_name", "last_name", "username")
    ]


@api.post("/admin/users")
@transaction.atomic
def create_admin_user(request, payload: AdminUserCreateIn):
    require_admin(request)
    fields = clean_account_fields(payload)
    User = get_user_model()
    user = User(**fields, is_active=payload.is_active, is_staff=payload.is_admin)
    try:
        validate_password(payload.password, user)
    except ValidationError as exc:
        raise HttpError(422, "; ".join(exc.messages)) from exc
    user.set_password(payload.password)
    user.save()
    Profile.objects.create(
        user=user,
        leaderboard_visible=payload.leaderboard_visible,
        email_notifications=payload.email_notifications,
        progress_basis=payload.progress_basis,
    )
    return admin_user_data(user)


@api.get("/admin/users/{user_id}")
def admin_user(request, user_id: int):
    require_admin(request)
    user = get_object_or_404(get_user_model(), pk=user_id)
    return admin_user_data(user)


@api.put("/admin/users/{user_id}")
@transaction.atomic
def update_admin_user(request, user_id: int, payload: AdminUserUpdateIn):
    require_admin(request)
    User = get_user_model()
    user = get_object_or_404(User.objects.select_for_update(), pk=user_id)
    fields = clean_account_fields(payload, excluding_user=user)
    remains_active_admin = payload.is_active and payload.is_admin
    if user.is_active and user.is_staff and not remains_active_admin:
        other_admins = User.objects.filter(is_active=True, is_staff=True).exclude(pk=user.pk)
        if not other_admins.exists():
            raise HttpError(422, "Keep at least one active administrator.")
    for field, value in fields.items():
        setattr(user, field, value)
    user.is_active = payload.is_active
    user.is_staff = payload.is_admin
    update_fields = [*fields, "is_active", "is_staff"]
    if payload.password:
        try:
            validate_password(payload.password, user)
        except ValidationError as exc:
            raise HttpError(422, "; ".join(exc.messages)) from exc
        user.set_password(payload.password)
        update_fields.append("password")
    user.save(update_fields=update_fields)
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.leaderboard_visible = payload.leaderboard_visible
    profile.email_notifications = payload.email_notifications
    profile.progress_basis = payload.progress_basis
    profile.save(update_fields=["leaderboard_visible", "email_notifications", "progress_basis"])
    return admin_user_data(user)


def episode_card(ep):
    catechism_day = ep.catechism_day
    return {
        "id": ep.id,
        "title": ep.title,
        "day": ep.day_id or ep.catechism_day_id,
        "edition": ep.edition,
        "published_at": ep.published_at,
        "source_date": ep.source_date,
        "duration": ep.duration,
        "status": ep.status,
        "has_audio": bool(ep.audio_file),
        "era": (ep.era.name if ep.era else (catechism_day.part if catechism_day else None)),
        "color": (
            ep.era.color if ep.era else (catechism_day.color if catechism_day else "#64b6bd")
        ),
    }


@api.get("/library")
def library(request):
    edition = requested_edition(request)
    profile, _ = Profile.objects.get_or_create(user=request.user)
    if not edition_enabled(profile, edition):
        raise HttpError(404, "This edition is hidden in your account settings.")
    progress_model = DayProgress if edition == "bible" else CatechismDayProgress
    progress = dict(
        progress_model.objects.filter(user=request.user).values_list("day_id", "completed_at")
    )
    episode_progress = dict(
        EpisodeProgress.objects.filter(user=request.user).values_list("episode_id", "completed_at")
    )
    episodes = list(
        Episode.objects.filter(edition=edition)
        .select_related("era", "catechism_day")
        .only(
            "id",
            "edition",
            "day_id",
            "catechism_day_id",
            "era_id",
            "title",
            "published_at",
            "source_date",
            "duration",
            "status",
            "audio_file",
            "era__name",
            "era__color",
            "catechism_day__part",
            "catechism_day__color",
        )
    )
    if edition == "bible":
        by_day = {e.day_id: e for e in episodes if e.day_id}
        days = [
            {
                "number": d.number,
                "readings": d.readings,
                "era": d.era.name,
                "color": d.era.color,
                "completed_at": progress.get(d.number),
                "episode": episode_card(by_day[d.number]) if d.number in by_day else None,
            }
            for d in Day.objects.select_related("era")
        ]
    else:
        by_day = {e.catechism_day_id: e for e in episodes if e.catechism_day_id}
        days = [
            {
                "number": d.number,
                "readings": d.readings,
                "era": d.part,
                "section": d.section,
                "chapter": d.chapter,
                "color": d.color,
                "completed_at": progress.get(d.number),
                "episode": episode_card(by_day[d.number]) if d.number in by_day else None,
            }
            for d in CatechismDay.objects.all()
        ]
    extras = [
        {**episode_card(ep), "completed_at": episode_progress.get(ep.id)}
        for ep in episodes
        if not ep.day_id and not ep.catechism_day_id
    ]
    return {
        "edition": edition,
        "days": days,
        "extras": extras,
        "completed": sum(bool(v) for v in progress.values()),
        "next_day": next((d["number"] for d in days if not d["completed_at"]), None),
    }


def episode_detail(ep, user):
    data = episode_card(ep)
    if ep.formatted_commentary:
        commentary = ep.formatted_commentary
    else:
        labels = {item["id"]: item for item in ep.classification}
        commentary = []
        for seg in ep.transcript:
            label = labels.get(seg["id"], {})
            if label.get("kind") in ("commentary", "prayer"):
                commentary.append(seg)
            elif label.get("kind") == "mixed" and label.get("commentary_text"):
                commentary.append({**seg, "text": label["commentary_text"], "partial": True})
    state = EpisodeProgress.objects.filter(user=user, episode=ep).first()
    data.update(
        {
            "description": ep.description,
            "source_url": ep.source_url,
            "transcript": ep.formatted_transcript or ep.transcript,
            "commentary": commentary,
            "edited_commentary": ep.edited_commentary,
            "summary": ep.summary,
            "key_points": ep.key_points,
            "outline": ep.outline,
            "audio": f"/api/episodes/{ep.id}/audio" if ep.audio_file else None,
            "position": state.position if state else 0,
            "completed_at": state.completed_at if state else None,
            "processed_at": ep.processed_at,
            "provenance": ep.provenance,
        }
    )
    return data


@api.get("/catechism/paragraphs/{number}")
def catechism_reference(request, number: int):
    paragraph = get_object_or_404(CatechismParagraph, pk=number)
    day = CatechismDay.objects.filter(
        paragraph_start__lte=number, paragraph_end__gte=number
    ).first()
    return {
        "paragraph": paragraph_data(paragraph),
        "context_url": f"/catechism/day/{day.number}/reader?tab=catechism#ccc-{number}"
        if day
        else None,
    }


@api.get("/catechism/bible-reference")
def catechism_bible_reference(request, reference: str):
    if not 1 <= len(reference) <= 240:
        raise HttpError(422, "Choose a shorter Bible reference.")
    try:
        ranges = list(reference_ranges(reference))
    except ValueError as exc:
        raise HttpError(422, "This Bible reference could not be resolved.") from exc
    descending_verses = any(
        int(end) < int(start) for start, end in re.findall(r":(\d+)-(\d+)(?=,|$)", reference)
    )
    if (
        not ranges
        or len(ranges) > 12
        or descending_verses
        or sum(lc - fc + 1 for _, fc, _, lc, _ in ranges) > 24
        or any(
            not 1 <= fc <= lc <= 150
            or lc - fc > 10
            or not 1 <= fv <= 176
            or not (1 <= lv <= 176 or lv == 999)
            or (fc, fv) > (lc, lv)
            for _, fc, fv, lc, lv in ranges
        )
    ):
        raise HttpError(422, "This Bible reference is outside the supported range.")
    passage = reading_text(reference)
    for group, (_, fc, fv, lc, lv) in zip(passage["groups"], ranges, strict=True):
        present = {(v["chapter"], v["verse"]) for v in group["verses"]}
        # Never present a partial imported passage as the whole citation.
        group["missing"] = (
            group["missing"] or (fc, fv) not in present or (lv != 999 and (lc, lv) not in present)
        )
        for chapter in range(fc, lc + 1):
            numbers = {verse for ch, verse in present if ch == chapter}
            if not numbers or numbers != set(range(min(numbers), max(numbers) + 1)):
                group["missing"] = True
    bible, _ = reading_locations()
    book, fc, fv, _, _ = ranges[0]
    day = next(
        (day for b, start, end, day in bible if b == book and start <= (fc, fv) <= end), None
    )
    slug = re.sub(r"[^a-z0-9]+", "-", book.lower())
    return {
        "passage": passage,
        "translation": "RSV-2CE",
        "context_url": f"/bible/day/{day}/reader?tab=scripture#verse-{slug}-{fc}-{fv}"
        if day
        else None,
    }


@api.get("/days/{number}")
def day_detail(request, number: int):
    edition = requested_edition(request)
    if edition == "catechism":
        day = get_object_or_404(CatechismDay, pk=number)
        ep = (
            Episode.objects.select_related("era", "catechism_day").filter(catechism_day=day).first()
        )
        progress = CatechismDayProgress.objects.filter(user=request.user, day=day).first()
        paragraphs = list(
            CatechismParagraph.objects.filter(
                number__range=(day.paragraph_start, day.paragraph_end)
            )
            if day.paragraph_start is not None
            else []
        )
        paragraph_rows = [paragraph_data(paragraph) for paragraph in paragraphs]
        cues = (
            align_catechism_audio(paragraph_rows, ep.transcript, ep.classification)
            if ep and ep.audio_file
            else []
        )
        cues_by_paragraph = {cue["paragraph_number"]: cue for cue in cues}
        return {
            "edition": edition,
            "number": number,
            "readings": day.readings,
            "era": day.part,
            "section": day.section,
            "chapter": day.chapter,
            "color": day.color,
            "completed_at": progress.completed_at if progress else None,
            "scripture": [],
            "catechism": [
                {**paragraph, "audio": cues_by_paragraph.get(paragraph["number"])}
                for paragraph in paragraph_rows
            ],
            "episode": episode_detail(ep, request.user) if ep else None,
        }
    day = get_object_or_404(Day.objects.select_related("era"), pk=number)
    ep = Episode.objects.select_related("era").filter(day=day).first()
    progress = DayProgress.objects.filter(user=request.user, day=day).first()
    scripture = [reading_text(ref) for ref in day.readings]
    cues = (
        align_scripture_audio(scripture, ep.transcript, ep.classification)
        if ep and ep.audio_file
        else []
    )
    cues_by_passage = {cue["passage_index"]: cue for cue in cues}
    return {
        "edition": edition,
        "number": number,
        "readings": day.readings,
        "era": day.era.name,
        "color": day.era.color,
        "completed_at": progress.completed_at if progress else None,
        "scripture": [
            {**passage, "audio": cues_by_passage.get(index)}
            for index, passage in enumerate(scripture)
        ],
        "episode": episode_detail(ep, request.user) if ep else None,
    }


def commentary_author_data(author):
    return {
        "name": author.name,
        "category": author.category,
        "default_year": author.default_year,
        "year_label": year_label(author.default_year),
        "wiki_url": author.wiki_url,
        "condemned_by_council": author.condemned_by_council,
    }


def commentary_data(commentary, ranges: list[CommentaryRange]):
    return {
        "id": commentary.external_id,
        "database_id": commentary.pk,
        "author": commentary.author.name + commentary.append_to_author_name,
        "author_metadata": commentary_author_data(commentary.author),
        "year": commentary.year,
        "year_label": year_label(commentary.year),
        "source_title": commentary.source_title,
        "source_url": commentary.source_url,
        "text": commentary.text,
        "book": commentary.book_key,
        "location_start": commentary.location_start,
        "location_end": commentary.location_end,
        "matched_readings": matching_references(commentary, ranges),
    }


@api.get("/commentaries")
def commentaries(
    request,
    day: int,
    from_year: int | None = None,
    to_year: int | None = None,
    category: str | None = None,
    page: int = 1,
    page_size: int = 36,
    focus: int | None = None,
):
    """Return historical commentary overlapping a day's RSV-2CE readings."""

    if page < 1 or page_size < 1 or page_size > 100:
        raise HttpError(422, "Invalid commentary page.")
    if from_year is not None and to_year is not None and from_year > to_year:
        raise HttpError(422, "The starting year must be before the ending year.")
    day_record = get_object_or_404(Day, pk=day)
    ranges = commentary_ranges_for_readings(day_record.readings)
    passage_query = Q()
    for passage_range in ranges:
        passage_query |= Q(
            book_key=passage_range.book_key,
            location_end__gte=passage_range.start,
            location_start__lte=passage_range.end,
        )
    entries = Commentary.objects.filter(passage_query)
    if from_year is not None:
        entries = entries.filter(year__gte=from_year)
    if to_year is not None:
        entries = entries.filter(year__lte=to_year)
    if category:
        entries = entries.filter(author__category=category)
    ordered_ids = ordered_commentary_ids(entries)
    total = len(ordered_ids)
    focused_page = False
    if focus is not None and page == 1:
        try:
            position = ordered_ids.index(focus) + 1
        except ValueError:
            pass
        else:
            page = ((position - 1) // page_size) + 1
            focused_page = True
    if focused_page:
        offset = 0
        page_ids = ordered_ids[: page * page_size]
    else:
        offset = (page - 1) * page_size
        page_ids = ordered_ids[offset : offset + page_size]
    rows = commentary_rows(page_ids)
    year_bounds = Commentary.objects.aggregate(min_year=Min("year"), max_year=Max("year"))
    return {
        "day": day_record.number,
        "readings": day_record.readings,
        "edition": "RSV-2CE",
        "commentaries": [commentary_data(row, ranges) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": offset + len(rows) < total,
        "filters": {
            "categories": list(
                CommentaryAuthor.objects.order_by("category")
                .values_list("category", flat=True)
                .distinct()
            ),
            "min_year": year_bounds["min_year"],
            "max_year": year_bounds["max_year"],
        },
        "matching_notes": [
            "Passages are matched by RSV-2CE book and verse span. Psalms use modern numbering in this historical index.",
            "Some deuterocanonical source traditions use different chapter layouts; the displayed readings remain the RSV-2CE references.",
        ],
    }


@api.get("/episodes/{episode_id}")
def extra_detail(request, episode_id: int):
    ep = get_object_or_404(Episode.objects.select_related("era"), pk=episode_id)
    return episode_detail(ep, request.user)


@api.put("/days/{number}/completion")
@transaction.atomic
def day_completion(request, number: int, payload: CompleteIn):
    edition = requested_edition(request)
    day_model = Day if edition == "bible" else CatechismDay
    progress_model = DayProgress if edition == "bible" else CatechismDayProgress
    day = get_object_or_404(day_model, pk=number)
    state, _ = progress_model.objects.get_or_create(user=request.user, day=day)
    state = progress_model.objects.select_for_update().get(pk=state.pk)
    state.completed_at = (state.completed_at or timezone.now()) if payload.completed else None
    state.save(update_fields=["completed_at"])
    return {"completed_at": state.completed_at}


@api.put("/days/{number}/completed-at")
@transaction.atomic
def day_completed_at(request, number: int, payload: CompletedAtIn):
    edition = requested_edition(request)
    day_model = Day if edition == "bible" else CatechismDay
    progress_model = DayProgress if edition == "bible" else CatechismDayProgress
    day = get_object_or_404(day_model, pk=number)
    state = progress_model.objects.filter(user=request.user, day=day).first()
    if state is None or state.completed_at is None:
        raise HttpError(400, "Mark this day complete before changing its date.")
    state = progress_model.objects.select_for_update().get(pk=state.pk)
    state.completed_at = timezone.make_aware(
        datetime.combine(payload.completed_on, time.min), timezone.get_current_timezone()
    )
    state.save(update_fields=["completed_at"])
    return {"completed_at": state.completed_at}


@api.put("/episodes/{episode_id}/completion")
@transaction.atomic
def episode_completion(request, episode_id: int, payload: CompleteIn):
    ep = get_object_or_404(Episode, pk=episode_id)
    if ep.day_id:
        return day_completion(request, ep.day_id, payload)
    if ep.catechism_day_id:
        request.GET = request.GET.copy()
        request.GET["edition"] = "catechism"
        return day_completion(request, ep.catechism_day_id, payload)
    state, _ = EpisodeProgress.objects.get_or_create(user=request.user, episode=ep)
    state = EpisodeProgress.objects.select_for_update().get(pk=state.pk)
    state.completed_at = (state.completed_at or timezone.now()) if payload.completed else None
    state.save(update_fields=["completed_at"])
    return {"completed_at": state.completed_at}


@api.put("/episodes/{episode_id}/completed-at")
@transaction.atomic
def episode_completed_at(request, episode_id: int, payload: CompletedAtIn):
    ep = get_object_or_404(Episode, pk=episode_id)
    if ep.day_id:
        return day_completed_at(request, ep.day_id, payload)
    if ep.catechism_day_id:
        request.GET = request.GET.copy()
        request.GET["edition"] = "catechism"
        return day_completed_at(request, ep.catechism_day_id, payload)
    state = EpisodeProgress.objects.filter(user=request.user, episode=ep).first()
    if state is None or state.completed_at is None:
        raise HttpError(400, "Mark this episode complete before changing its date.")
    state = EpisodeProgress.objects.select_for_update().get(pk=state.pk)
    state.completed_at = timezone.make_aware(
        datetime.combine(payload.completed_on, time.min), timezone.get_current_timezone()
    )
    state.save(update_fields=["completed_at"])
    return {"completed_at": state.completed_at}


@api.put("/episodes/{episode_id}/position")
def position(request, episode_id: int, payload: PositionIn):
    ep = get_object_or_404(Episode, pk=episode_id)
    value = min(payload.position, ep.duration) if ep.duration else payload.position
    EpisodeProgress.objects.update_or_create(
        user=request.user, episode=ep, defaults={"position": value}
    )
    return {"position": value}


def note_target(kind, target_id, edition="bible"):
    if kind == "days":
        if edition == "catechism":
            return {"catechism_day": get_object_or_404(CatechismDay, pk=target_id)}
        return {"day": get_object_or_404(Day, pk=target_id)}
    if kind == "episodes":
        ep = get_object_or_404(Episode, pk=target_id)
        if ep.day_id:
            return {"day": ep.day}
        if ep.catechism_day_id:
            return {"catechism_day": ep.catechism_day}
        return {"episode": ep}
    raise HttpError(404, "Not found")


def note_data(n):
    return {
        "id": n.id,
        "shared": n.shared,
        "author": {"id": n.user_id, "name": n.user.get_full_name() or n.user.username},
        "body": n.body,
        "quote": n.quote,
        "citation": n.citation,
        "source_url": n.source_url,
        "kind": n.kind,
        "audio_time": n.audio_time,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
        "day": n.day_id,
        "catechism_day": n.catechism_day_id,
        "edition": "catechism"
        if n.catechism_day_id or (n.episode_id and n.episode.edition == "catechism")
        else "bible",
        "episode": n.episode_id,
    }


@api.get("/shared-notes")
def shared_notes(
    request, person: int | None = None, day: int | None = None, episode: int | None = None
):
    entries = (
        Note.objects.filter(shared=True, user__is_active=True)
        .exclude(user=request.user)
        .select_related("user")
    )
    if person is not None:
        entries = entries.filter(user_id=person)
    if day is not None:
        target = note_target("days", day, requested_edition(request))
        entries = entries.filter(**target)
    if episode is not None:
        target = note_target("episodes", episode, requested_edition(request))
        entries = entries.filter(**target)
    return [note_data(n) for n in entries]


@api.get("/notes")
def all_notes(request):
    return [note_data(n) for n in Note.objects.filter(user=request.user).select_related("episode")]


@api.get("/{kind}/{target_id}/notes")
def notes(request, kind: str, target_id: int):
    return [
        note_data(n)
        for n in Note.objects.filter(
            user=request.user,
            **note_target(kind, target_id, requested_edition(request)),
        ).select_related("episode")
    ]


@api.post("/{kind}/{target_id}/notes")
def add_note(request, kind: str, target_id: int, payload: NoteIn):
    if not payload.body.strip():
        raise HttpError(422, "Write something before saving.")
    if payload.source_url and (
        not payload.source_url.startswith("/")
        or payload.source_url.startswith("//")
        or "\\" in payload.source_url
    ):
        raise HttpError(422, "Note links must point inside this site.")
    with transaction.atomic():
        note = Note.objects.create(
            user=request.user,
            **note_target(kind, target_id, requested_edition(request)),
            **payload.dict(),
        )
        schedule_notification(note)
    return note_data(note)


def schedule_notification(note):
    if note.shared and note.shared_notified_at is None:
        note.shared_notified_at = timezone.now()
        note.save(update_fields=["shared_notified_at"])
        from .notifications import notify_shared_note

        transaction.on_commit(lambda: notify_shared_note(note.pk), robust=True)


@api.put("/notes/{note_id}")
@transaction.atomic
def edit_note(request, note_id: int, payload: NoteIn):
    note = get_object_or_404(Note.objects.select_for_update(), user=request.user, pk=note_id)
    if not payload.body.strip():
        raise HttpError(422, "Write something before saving.")
    if payload.source_url and (
        not payload.source_url.startswith("/")
        or payload.source_url.startswith("//")
        or "\\" in payload.source_url
    ):
        raise HttpError(422, "Note links must point inside this site.")
    for key, value in payload.dict().items():
        setattr(note, key, value)
    note.save()
    schedule_notification(note)
    return note_data(note)


@api.delete("/notes/{note_id}")
def delete_note(request, note_id: int):
    get_object_or_404(Note, user=request.user, pk=note_id).delete()
    return {"ok": True}


@api.get("/episodes/{episode_id}/audio")
def audio(request, episode_id: int):
    """Authenticated byte ranges support seeking in local dev; nginx accelerates production."""
    import re

    ep = get_object_or_404(Episode, pk=episode_id)
    if not ep.audio_file:
        raise HttpError(404, "Audio has not been imported.")
    path = (settings.MEDIA_ROOT / ep.audio_file).resolve()
    if not path.is_relative_to(settings.MEDIA_ROOT.resolve()) or not path.is_file():
        raise HttpError(404, "Audio file unavailable.")
    if not settings.DEBUG:
        response = HttpResponse(content_type="audio/mpeg")
        response["X-Accel-Redirect"] = "/protected-media/" + ep.audio_file
        return response
    size = path.stat().st_size
    start, end, status = 0, size - 1, 200
    byte_range = request.headers.get("Range")
    if byte_range:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", byte_range)
        if not match or not any(match.groups()):
            return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}"})
        a, b = match.groups()
        if a:
            start, end = int(a), min(int(b), size - 1) if b else size - 1
        else:
            start = max(0, size - int(b))
        if start > end or start >= size:
            return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}"})
        status = 206

    def chunks():
        with path.open("rb") as source:
            source.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    response = StreamingHttpResponse(chunks(), status=status, content_type="audio/mpeg")
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = str(end - start + 1)
    response["Cache-Control"] = "private, no-store"
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


# Auth and CSRF protection are inherited from the session-authenticated API.
api.add_router("/chat", chat_router)
