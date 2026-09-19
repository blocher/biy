from datetime import timedelta
from typing import Literal

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError
from ninja.security import django_auth
from pydantic import Field

from .models import Day, DayProgress, Episode, EpisodeProgress, LoginAttempt, Note
from .scripture import reading_text

api = NinjaAPI(title="Bible in a Year", auth=django_auth, docs_url=None)


class LoginIn(Schema):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=256)


class CompleteIn(Schema):
    completed: bool


class PositionIn(Schema):
    position: float = Field(ge=0, le=86400, allow_inf_nan=False)


class NoteIn(Schema):
    body: str = Field(min_length=1, max_length=50000)
    kind: Literal["note", "journal"] = "note"
    audio_time: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)


@api.get("/session", auth=None)
def session(request):
    return {
        "user": {"username": request.user.username} if request.user.is_authenticated else None,
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
    return JsonResponse({"user": {"username": user.username}, "csrf": get_token(request)})


@api.post("/logout")
def sign_out(request):
    logout(request)
    return {"ok": True}


def episode_card(ep):
    return {
        "id": ep.id,
        "title": ep.title,
        "day": ep.day_id,
        "published_at": ep.published_at,
        "source_date": ep.source_date,
        "duration": ep.duration,
        "status": ep.status,
        "has_audio": bool(ep.audio_file),
        "era": ep.era.name if ep.era else None,
        "color": ep.era.color if ep.era else "#64b6bd",
    }


@api.get("/library")
def library(request):
    progress = dict(
        DayProgress.objects.filter(user=request.user).values_list("day_id", "completed_at")
    )
    episode_progress = dict(
        EpisodeProgress.objects.filter(user=request.user).values_list("episode_id", "completed_at")
    )
    episodes = list(Episode.objects.select_related("era"))
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
    extras = [
        {**episode_card(ep), "completed_at": episode_progress.get(ep.id)}
        for ep in episodes
        if not ep.day_id
    ]
    return {
        "days": days,
        "extras": extras,
        "completed": sum(bool(v) for v in progress.values()),
        "next_day": next((d["number"] for d in days if not d["completed_at"]), None),
    }


def episode_detail(ep, user):
    data = episode_card(ep)
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
            "transcript": ep.transcript,
            "commentary": commentary,
            "edited_commentary": ep.edited_commentary,
            "summary": ep.summary,
            "outline": ep.outline,
            "audio": f"/api/episodes/{ep.id}/audio" if ep.audio_file else None,
            "position": state.position if state else 0,
            "completed_at": state.completed_at if state else None,
            "processed_at": ep.processed_at,
            "provenance": ep.provenance,
        }
    )
    return data


@api.get("/days/{number}")
def day_detail(request, number: int):
    day = get_object_or_404(Day.objects.select_related("era"), pk=number)
    ep = Episode.objects.select_related("era").filter(day=day).first()
    progress = DayProgress.objects.filter(user=request.user, day=day).first()
    return {
        "number": number,
        "readings": day.readings,
        "era": day.era.name,
        "color": day.era.color,
        "completed_at": progress.completed_at if progress else None,
        "scripture": [reading_text(ref) for ref in day.readings],
        "episode": episode_detail(ep, request.user) if ep else None,
    }


@api.get("/episodes/{episode_id}")
def extra_detail(request, episode_id: int):
    ep = get_object_or_404(Episode.objects.select_related("era"), pk=episode_id)
    return episode_detail(ep, request.user)


@api.put("/days/{number}/completion")
@transaction.atomic
def day_completion(request, number: int, payload: CompleteIn):
    day = get_object_or_404(Day, pk=number)
    state, _ = DayProgress.objects.get_or_create(user=request.user, day=day)
    state = DayProgress.objects.select_for_update().get(pk=state.pk)
    state.completed_at = (state.completed_at or timezone.now()) if payload.completed else None
    state.save(update_fields=["completed_at"])
    return {"completed_at": state.completed_at}


@api.put("/episodes/{episode_id}/completion")
@transaction.atomic
def episode_completion(request, episode_id: int, payload: CompleteIn):
    ep = get_object_or_404(Episode, pk=episode_id)
    if ep.day_id:
        return day_completion(request, ep.day_id, payload)
    state, _ = EpisodeProgress.objects.get_or_create(user=request.user, episode=ep)
    state = EpisodeProgress.objects.select_for_update().get(pk=state.pk)
    state.completed_at = (state.completed_at or timezone.now()) if payload.completed else None
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


def note_target(kind, target_id):
    if kind == "days":
        return {"day": get_object_or_404(Day, pk=target_id)}
    if kind == "episodes":
        ep = get_object_or_404(Episode, pk=target_id)
        return {"day": ep.day} if ep.day_id else {"episode": ep}
    raise HttpError(404, "Not found")


def note_data(n):
    return {
        "id": n.id,
        "body": n.body,
        "kind": n.kind,
        "audio_time": n.audio_time,
        "created_at": n.created_at,
        "updated_at": n.updated_at,
        "day": n.day_id,
        "episode": n.episode_id,
    }


@api.get("/notes")
def all_notes(request):
    return [note_data(n) for n in Note.objects.filter(user=request.user)]


@api.get("/{kind}/{target_id}/notes")
def notes(request, kind: str, target_id: int):
    return [
        note_data(n) for n in Note.objects.filter(user=request.user, **note_target(kind, target_id))
    ]


@api.post("/{kind}/{target_id}/notes")
def add_note(request, kind: str, target_id: int, payload: NoteIn):
    if not payload.body.strip():
        raise HttpError(422, "Write something before saving.")
    return note_data(
        Note.objects.create(user=request.user, **note_target(kind, target_id), **payload.dict())
    )


@api.put("/notes/{note_id}")
def edit_note(request, note_id: int, payload: NoteIn):
    note = get_object_or_404(Note, user=request.user, pk=note_id)
    if not payload.body.strip():
        raise HttpError(422, "Write something before saving.")
    for key, value in payload.dict().items():
        setattr(note, key, value)
    note.save()
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
