import re
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError
from pydantic import Field

from .models import (
    CatechismDay,
    Day,
    Episode,
    SearchChunk,
    StudyConversation,
    StudyTurn,
    StudyWorker,
)
from .search import sources_current

router = Router()


class AskIn(Schema):
    question: str = Field(min_length=1, max_length=4000)
    request_id: UUID
    conversation_id: int | None = None
    day: int | None = Field(default=None, ge=1, le=365)
    episode: int | None = Field(default=None, ge=1)
    web_enabled: bool = True
    edition: str = "bible"


def worker_online():
    return StudyWorker.objects.filter(
        heartbeat_at__gte=timezone.now() - timedelta(minutes=6)
    ).exists()


@router.get("/status")
def status(request):
    return {
        "configured": bool(settings.OPENAI_API_KEY),
        "magisterium_configured": bool(settings.MAGISTERIUM_API_KEY),
        "worker_online": worker_online(),
        # Only public indexing counts, never another member's private activity.
        "public_chunks": SearchChunk.objects.filter(note__isnull=True).count(),
        "public_pending": SearchChunk.objects.filter(
            note__isnull=True, embedding__isnull=True
        ).count(),
        "public_failed": SearchChunk.objects.filter(note__isnull=True, attempts__gte=8).count(),
    }


def turn_data(turn, user):
    current = sources_current(user, turn.sources)
    draft_ids = (
        set(re.findall(r"\[([DSMWH]\d+)\]", turn.answer))
        if turn.status == "running"
        else set()
    )
    progress_sources = []
    if current and turn.status in {"queued", "running"}:
        progress_sources = [
            {
                "id": source.get("id", ""),
                "kind": source.get("kind", ""),
                "title": source.get("title", "Source"),
                "url": source.get("url", ""),
                "day": source.get("metadata", {}).get("day"),
            }
            for source in turn.sources[:6]
        ]
    return {
        "id": turn.pk,
        "question": turn.question,
        "status": turn.status,
        "answer": turn.answer if current else (
            "" if turn.status in {"queued", "running", "failed"}
            else "This answer used a source that has changed or is no longer shared. Please ask again."
        ),
        "sources": (
            sorted(
                [s for s in turn.sources if s.get("used") or s.get("id") in draft_ids],
                key=lambda s: turn.answer.find(f"[{s['id']}]"),
            )
            if current
            else []
        ),
        "notices": turn.notices if current else [],
        "follow_ups": turn.follow_ups if current else [],
        "links": turn.links if current else [],
        "progress_sources": progress_sources,
        "stage": turn.stage,
        "error": turn.error,
        "created_at": turn.created_at.isoformat(),
        "external_query": turn.external_query,
        "web_enabled": turn.web_enabled,
    }


@router.get("/conversations")
def conversations(
    request,
    day: int | None = None,
    episode: int | None = None,
    edition: str = "bible",
):
    qs = StudyConversation.objects.filter(user=request.user, edition=edition)
    if day is not None:
        qs = qs.filter(day_id=day) if edition == "bible" else qs.filter(catechism_day_id=day)
    if episode is not None:
        qs = qs.filter(episode_id=episode)
    return [
        {
            "id": c.pk,
            "day": c.day_id,
            "catechism_day": c.catechism_day_id,
            "edition": c.edition,
            "episode": c.episode_id,
            "title": (
                c.turns.order_by("pk").values_list("question", flat=True).first()
                or "New conversation"
            )[:100],
        }
        for c in qs.annotate(last_turn=Max("turns__created_at")).order_by("-last_turn", "-pk")[:30]
    ]


@router.get("/conversations/{conversation_id}")
def conversation(request, conversation_id: int):
    c = get_object_or_404(StudyConversation, pk=conversation_id, user=request.user)
    return {
        "id": c.pk,
        "day": c.day_id,
        "catechism_day": c.catechism_day_id,
        "edition": c.edition,
        "episode": c.episode_id,
        "turns": [turn_data(t, request.user) for t in c.turns.order_by("pk")],
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(request, conversation_id: int):
    get_object_or_404(StudyConversation, pk=conversation_id, user=request.user).delete()
    return {"ok": True}


@router.post("/ask")
@transaction.atomic
def ask(request, payload: AskIn):
    question = payload.question.strip()
    if not question:
        raise HttpError(422, "Enter a question first.")
    if payload.edition not in {"bible", "catechism"}:
        raise HttpError(422, "Choose the Bible or Catechism edition.")
    # Lock per member to make request deduplication and spend limits race-safe.
    get_user_model().objects.select_for_update().get(pk=request.user.pk)
    previous = StudyTurn.objects.filter(request_id=payload.request_id).first()
    if previous:
        if previous.conversation.user_id != request.user.pk:
            raise HttpError(404, "Request not found.")
        return {"conversation_id": previous.conversation_id, "turn_id": previous.pk}
    if not settings.OPENAI_API_KEY:
        raise HttpError(503, "Study chat needs an OpenAI API key configured on the server.")
    if not worker_online():
        raise HttpError(503, "The study worker is offline. Please try again after it restarts.")
    recent = StudyTurn.objects.filter(conversation__user=request.user)
    if (
        recent.filter(created_at__gte=timezone.now() - timedelta(days=1)).count()
        >= settings.STUDY_CHAT_DAILY_LIMIT
    ):
        raise HttpError(
            429, "Your daily study chat limit has been reached. Please try again later."
        )
    if recent.filter(status__in=["queued", "running"]).exists():
        raise HttpError(409, "Please wait for your current answer to finish.")
    if payload.conversation_id:
        c = get_object_or_404(StudyConversation, pk=payload.conversation_id, user=request.user)
    else:
        if payload.day and payload.episode:
            raise HttpError(422, "Choose a day or an episode.")
        day = (
            get_object_or_404(Day, pk=payload.day)
            if payload.day and payload.edition == "bible"
            else None
        )
        catechism_day = (
            get_object_or_404(CatechismDay, pk=payload.day)
            if payload.day and payload.edition == "catechism"
            else None
        )
        episode = get_object_or_404(Episode, pk=payload.episode) if payload.episode else None
        c = StudyConversation.objects.create(
            user=request.user,
            edition=payload.edition,
            day=day,
            catechism_day=catechism_day,
            episode=episode,
        )
    turn = StudyTurn.objects.create(
        conversation=c,
        request_id=payload.request_id,
        question=question,
        web_enabled=payload.web_enabled,
    )
    return {"conversation_id": c.pk, "turn_id": turn.pk}
