"""Local evidence retrieval and a durable, revision-safe embedding queue."""

import hashlib
import json
from datetime import timedelta

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from openai import OpenAI
from pgvector.django import CosineDistance

from .models import CatechismDay, CatechismParagraph, Day, Episode, Note, SearchChunk, Verse


def client():
    return OpenAI(api_key=settings.OPENAI_API_KEY, timeout=45, max_retries=0)


def pieces(text, size=1800):
    words = text.split()
    part, length = [], 0
    for word in words:
        if length + len(word) > size and part:
            yield " ".join(part)
            part, length = [], 0
        part.append(word)
        length += len(word) + 1
    if part:
        yield " ".join(part)


@transaction.atomic
def replace_source(source, rows):
    # Serializes rebuilds from imports, edits, and the backfill command.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [source])
    existing = {c.key: c for c in SearchChunk.objects.filter(source=source)}
    keys = []
    for index, row in enumerate(rows):
        key = f"{source}:{index}"
        keys.append(key)
        digest = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
        old = existing.get(key)
        if old and old.digest == digest:
            continue
        SearchChunk.objects.update_or_create(
            key=key,
            defaults={
                **row,
                "source": source,
                "digest": digest,
                "embedding": None,
                "embedding_model": "",
                "attempts": 0,
                "error": "",
                "leased_until": None,
                "available_at": timezone.now(),
            },
        )
    SearchChunk.objects.filter(source=source).exclude(key__in=keys).delete()


def index_note(note):
    edition = (
        "catechism"
        if note.catechism_day_id or (note.episode_id and note.episode.edition == "catechism")
        else "bible"
    )
    day = (
        note.day
        if note.day_id
        else (
            note.catechism_day
            if note.catechism_day_id
            else (note.episode.day or note.episode.catechism_day)
        )
    )
    target = (
        f"/episode/{note.episode_id}"
        if note.episode_id and edition == "bible"
        else (
            f"/episode/{note.episode_id}?edition={edition}"
            if note.episode_id
            else (f"/day/{day.pk}" if edition == "bible" else f"/day/{day.pk}?edition={edition}")
        )
    )
    context = f"Day {day.pk} · {', '.join(day.readings)}" if day else note.episode.title
    replace_source(
        f"note:{note.pk}",
        [
            {
                "kind": "journal",
                "note_id": note.pk,
                "episode_id": None,
                "title": f"{note.user.username} · {note.get_kind_display()} · {context}"[:600],
                "text": text,
                "metadata": {
                    "url": f"{target}#note-{note.pk}",
                    "day": day.pk if day else None,
                    "readings": day.readings if day else [],
                    "attachment": "reading day" if day else "episode",
                    "episode": note.episode_id,
                    "audio_time": note.audio_time,
                    "updated_at": note.updated_at.isoformat(),
                    "edition": edition,
                },
            }
            for text in pieces(note.body)
        ],
    )


def index_episode(ep):
    rows = []
    if ep.status == "ready":
        labels = {label["id"]: label for label in ep.classification}
        day_id = ep.day_id or ep.catechism_day_id
        base = (
            f"/day/{day_id}?edition={ep.edition}"
            if day_id
            else f"/episode/{ep.pk}?edition={ep.edition}"
        )
        # Original retained commentary, not summaries of generated summaries.
        for seg in ep.transcript:
            label = labels.get(seg["id"], {})
            text = (
                seg["text"]
                if label.get("kind") == "commentary"
                else (label.get("commentary_text", "") if label.get("kind") == "mixed" else "")
            )
            if not text:
                continue
            for part in pieces(text):
                if rows and len(rows[-1]["text"]) + len(part) < 1800:
                    rows[-1]["text"] += "\n" + part
                    rows[-1]["metadata"]["segments"].append(seg["id"])
                else:
                    rows.append(
                        {
                            "kind": "commentary",
                            "note_id": None,
                            "episode_id": ep.pk,
                            "title": ep.title,
                            "text": part,
                            "metadata": {
                                "day": day_id,
                                "edition": ep.edition,
                                "segment": seg["id"],
                                "segments": [seg["id"]],
                                "audio_time": seg.get("start", 0),
                                "url": f"{base}&tab=commentary#segment-{seg['id']}",
                            },
                        }
                    )
    replace_source(f"episode:{ep.pk}", rows)


def index_chapter(book, chapter):
    verses = list(Verse.objects.filter(book=book, chapter=chapter).order_by("number"))
    rows = []
    for start in range(0, len(verses), 8):
        group = verses[start : start + 8]
        title = f"{book} {chapter}:{group[0].number}-{group[-1].number}"
        rows.append(
            {
                "kind": "scripture",
                "note_id": None,
                "episode_id": None,
                "title": title,
                "text": "\n".join(f"{v.number}. {v.text}" for v in group),
                "metadata": {
                    "book": book,
                    "chapter": chapter,
                    "first_verse": group[0].number,
                    "last_verse": group[-1].number,
                    "url": "",
                },
            }
        )
    replace_source(f"bible:{book}:{chapter}", rows)


def index_catechism():
    for day in CatechismDay.objects.order_by("number"):
        if day.paragraph_start is None:
            replace_source(f"catechism-day:{day.number}", [])
            continue
        paragraphs = list(
            CatechismParagraph.objects.filter(
                number__range=(day.paragraph_start, day.paragraph_end)
            )
        )
        text = "\n\n".join(f"{row.number}. {row.text}" for row in paragraphs)
        rows = []
        for index, part in enumerate(pieces(text)):
            rows.append(
                {
                    "kind": "catechism",
                    "note_id": None,
                    "episode_id": None,
                    "title": f"Catechism Day {day.number} · CCC {day.paragraph_start}-{day.paragraph_end}",
                    "text": part,
                    "metadata": {
                        "edition": "catechism",
                        "day": day.number,
                        "paragraph_start": day.paragraph_start,
                        "paragraph_end": day.paragraph_end,
                        "url": f"/day/{day.number}?edition=catechism",
                        "source_url": paragraphs[0].source_url if paragraphs else "",
                        "part": day.part,
                        "section": day.section,
                        "chapter": day.chapter,
                        "chunk": index,
                    },
                }
            )
        replace_source(f"catechism-day:{day.number}", rows)


def accessible_chunks(user):
    return SearchChunk.objects.filter(
        Q(note__isnull=True) | Q(note__user=user) | Q(note__shared=True, note__user__is_active=True)
    ).filter(Q(episode__isnull=True) | Q(episode__status="ready"))


def evidence(chunk):
    return {
        "id": f"S{chunk.pk}",
        "kind": chunk.kind,
        "title": chunk.title,
        "text": chunk.text,
        "url": chunk.metadata.get("url", ""),
        "metadata": chunk.metadata,
        "key": chunk.key,
        "digest": chunk.digest,
    }


def find_reading_days(query, limit=6):
    """Find reading-plan days directly from episode titles and descriptions."""

    vector = SearchVector("title", weight="A", config="english") + SearchVector(
        "description", weight="B", config="english"
    )
    query_obj = SearchQuery(query, search_type="websearch", config="english")
    episodes = (
        Episode.objects.filter(Q(day__isnull=False) | Q(catechism_day__isnull=False))
        .select_related("day", "catechism_day")
        .annotate(document=vector, rank=SearchRank(vector, query_obj))
        .filter(document=query_obj)
        .order_by("-rank", "id")[:limit]
    )
    return {
        "sources": [
            {
                "id": (
                    f"D{episode.day_id}"
                    if episode.edition == "bible"
                    else f"C{episode.catechism_day_id}"
                ),
                "kind": "reading_day",
                "title": episode.title,
                "text": (
                    f"{episode.get_edition_display()} Day {episode.day_id or episode.catechism_day_id} readings: "
                    + " · ".join((episode.day or episode.catechism_day).readings)
                ),
                "url": (
                    f"/day/{episode.day_id}?tab=commentary"
                    if episode.edition == "bible"
                    else f"/day/{episode.catechism_day_id}?edition=catechism&tab=commentary"
                ),
                "metadata": {
                    "day": episode.day_id or episode.catechism_day_id,
                    "edition": episode.edition,
                    "readings": (episode.day or episode.catechism_day).readings,
                    "historical_commentaries_url": (f"/commentaries?day={episode.day_id}")
                    if episode.edition == "bible"
                    else None,
                },
            }
            for episode in episodes
        ],
        "notice": None,
    }


def reading_notes(user, reference=None, day=None, episode=None, audience="all", offset=0):
    """Enumerate permitted notes by their parent reading, without semantic ranking."""
    from .scripture import reference_ranges

    notes = Note.objects.filter(Q(user=user) | Q(shared=True, user__is_active=True))
    if audience == "community":
        notes = notes.filter(shared=True)
    elif audience == "mine":
        notes = notes.filter(user=user)
    matched_days = []
    if reference:
        try:
            requested = list(reference_ranges(reference))
        except (ValueError, TypeError):
            return {"error": "Use a full Bible reference, e.g. Genesis 1 or 1 Kings 12:1-10."}
        for candidate in Day.objects.order_by("pk"):
            for ref in candidate.readings:
                if any(
                    book == rb and (a, av) <= (re, rev) and (rs, rsv) <= (b, bv)
                    for book, a, av, b, bv in reference_ranges(ref)
                    for rb, rs, rsv, re, rev in requested
                ):
                    matched_days.append(candidate.pk)
                    break
        notes = notes.filter(Q(day_id__in=matched_days) | Q(episode__day_id__in=matched_days))
    if day:
        notes = notes.filter(
            Q(day_id=day)
            | Q(catechism_day_id=day)
            | Q(episode__day_id=day)
            | Q(episode__catechism_day_id=day)
        )
    if episode:
        notes = notes.filter(episode_id=episode)
    chunks = accessible_chunks(user).filter(note__in=notes).order_by("note_id", "pk")
    offset = max(0, offset)
    total = chunks.count()
    return {
        "sources": [evidence(c) for c in chunks[offset : offset + 20]],
        "matching_days": matched_days,
        "accessible_note_count": notes.count(),
        "missing_index_count": notes.exclude(pk__in=chunks.values("note_id")).count(),
        "next_offset": offset + 20 if offset + 20 < total else None,
        "scope": {
            "reference": reference,
            "day": day,
            "episode": episode,
            "audience": audience,
        },
        "attachment_context": "These notes are attached to the matching reading days or episode; they may discuss any reading on that day. Counts cover only notes you can access.",
    }


def search_site(
    user,
    query,
    kind="all",
    day=None,
    limit=8,
    semantic=True,
    preferred_edition=None,
):
    qs = accessible_chunks(user)
    if kind in {"scripture", "catechism", "commentary", "journal"}:
        qs = qs.filter(kind=kind)
    elif kind == "community":
        qs = qs.filter(note__shared=True)
    elif kind == "mine":
        qs = qs.filter(note__user=user)
    if day:
        from .scripture import reference_ranges

        scope = Q(metadata__day=day) | Q(note__day_id=day)
        reading_day = Day.objects.filter(pk=day).first()
        for ref in reading_day.readings if reading_day else []:
            for book, first_ch, first_v, last_ch, last_v in reference_ranges(ref):
                scope |= (
                    Q(kind="scripture", metadata__book=book)
                    & (
                        Q(metadata__chapter__gt=first_ch)
                        | Q(
                            metadata__chapter=first_ch,
                            metadata__last_verse__gte=first_v,
                        )
                    )
                    & (
                        Q(metadata__chapter__lt=last_ch)
                        | Q(metadata__chapter=last_ch, metadata__first_verse__lte=last_v)
                    )
                )
        qs = qs.filter(scope)
    vector = SearchVector("title", weight="A", config="english") + SearchVector(
        "text", weight="B", config="english"
    )
    query_obj = SearchQuery(query, search_type="websearch", config="english")
    lexical = list(
        qs.annotate(document=vector, rank=SearchRank(vector, query_obj))
        .filter(document=query_obj)
        .order_by("-rank", "pk")[:30]
    )
    rankings = [lexical]
    warning = None
    if (
        semantic
        and settings.OPENAI_API_KEY
        and qs.filter(
            embedding__isnull=False, embedding_model=settings.STUDY_EMBEDDING_MODEL
        ).exists()
    ):
        try:
            embedding = (
                client()
                .embeddings.create(
                    model=settings.STUDY_EMBEDDING_MODEL,
                    input=query[:2000],
                    dimensions=1536,
                )
                .data[0]
                .embedding
            )
            rankings.append(
                list(
                    qs.filter(
                        embedding__isnull=False,
                        embedding_model=settings.STUDY_EMBEDDING_MODEL,
                    )
                    .annotate(distance=CosineDistance("embedding", embedding))
                    .order_by("distance", "pk")[:30]
                )
            )
        except Exception:
            warning = "Semantic search is unavailable; keyword search was used."
    elif semantic:
        warning = "Semantic indexing is pending; keyword search was used."
    scores, chunks = {}, {}
    for ranked in rankings:
        for rank, chunk in enumerate(ranked):
            scores[chunk.pk] = scores.get(chunk.pk, 0) + 1 / (60 + rank)
            chunks[chunk.pk] = chunk
    if preferred_edition in {"bible", "catechism"}:
        for pk, chunk in chunks.items():
            chunk_edition = chunk.metadata.get("edition")
            if chunk_edition is None and chunk.kind == "scripture":
                chunk_edition = "bible"
            if chunk_edition == preferred_edition:
                scores[pk] += 0.004
    selected = sorted(scores, key=scores.get, reverse=True)[:limit]
    return {"sources": [evidence(chunks[pk]) for pk in selected], "notice": warning}


def sources_current(user, sources):
    local = {s["key"]: s["digest"] for s in sources if s.get("key")}
    current = dict(accessible_chunks(user).filter(key__in=local).values_list("key", "digest"))
    return all(current.get(key) == digest for key, digest in local.items())


def embed_batch():
    """Claim with a lease; revision/lease checks prevent a late response overwriting edits."""
    if not settings.OPENAI_API_KEY:
        return False
    now = timezone.now()
    lease = now + timedelta(minutes=3)
    with transaction.atomic():
        chunks = list(
            SearchChunk.objects.select_for_update(skip_locked=True)
            .filter(
                Q(embedding__isnull=True) | ~Q(embedding_model=settings.STUDY_EMBEDDING_MODEL),
                Q(leased_until__isnull=True) | Q(leased_until__lt=now),
                available_at__lte=now,
                attempts__lt=8,
            )
            .order_by("pk")[:32]
        )
        if not chunks:
            return False
        SearchChunk.objects.filter(pk__in=[c.pk for c in chunks]).update(leased_until=lease)
    try:
        response = client().embeddings.create(
            model=settings.STUDY_EMBEDDING_MODEL,
            input=[f"{c.title}\n{c.text}" for c in chunks],
            dimensions=1536,
        )
        embeddings = {item.index: item.embedding for item in response.data}
        if len(embeddings) != len(chunks):
            raise ValueError("Incomplete embedding response")
        for i, chunk in enumerate(chunks):
            SearchChunk.objects.filter(pk=chunk.pk, digest=chunk.digest, leased_until=lease).update(
                embedding=embeddings[i],
                embedding_model=settings.STUDY_EMBEDDING_MODEL,
                leased_until=None,
                error="",
                attempts=0,
            )
    except Exception as exc:
        # Never persist provider error bodies: they can contain request material or credentials.
        for chunk in chunks:
            SearchChunk.objects.filter(pk=chunk.pk, digest=chunk.digest, leased_until=lease).update(
                leased_until=None,
                attempts=chunk.attempts + 1,
                error=type(exc).__name__[:100],
                available_at=now + timedelta(seconds=min(3600, 30 * 2**chunk.attempts)),
            )
    return True
