"""Ranked, local-only navigation search. No embeddings or model calls."""

import re
from urllib.parse import parse_qsl, urlencode, urlsplit

from django.contrib.postgres.search import (
    SearchQuery,
    SearchRank,
    SearchVector,
    TrigramSimilarity,
    TrigramWordSimilarity,
)
from django.db.models import Q
from django.db.models.functions import Greatest

from .commentaries import commentary_ranges_for_readings, range_overlaps
from .models import STUDY_SEARCH_VECTOR, CatechismDay, Commentary, Day, Episode, Profile
from .scripture import reference_ranges
from .search import accessible_chunks

COMMENTARY_VECTOR = SearchVector("source_title", weight="A", config="english") + SearchVector(
    "text", weight="B", config="english"
)


def excerpt(text, query):
    text = re.sub(r"\s+", " ", text).strip()
    words = re.findall(r"\w+", query)
    positions = [text.casefold().find(word.casefold()) for word in words]
    start = max(0, min((p for p in positions if p >= 0), default=0) - 65)
    end = min(len(text), start + 210)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


def site_path(raw, fallback):
    """Only return navigable same-site paths from indexed metadata."""
    if not raw or not raw.startswith("/") or raw.startswith("//") or "\\" in raw:
        return fallback
    parsed = urlsplit(raw)
    parts = parsed.path.split("/")
    if len(parts) > 2 and parts[1] in {"day", "episode"}:
        params = dict(parse_qsl(parsed.query))
        edition = params.pop("edition", "bible")
        if edition not in {"bible", "catechism"}:
            edition = "bible"
        path = f"/{edition}{parsed.path}"
        query = urlencode(params)
        return path + (f"?{query}" if query else "") + (f"#{parsed.fragment}" if parsed.fragment else "")
    return raw


def reading_locations():
    """Map search excerpts to a day that actually displays that passage."""
    bible, commentary = [], []
    for day in Day.objects.order_by("number").values("number", "readings"):
        for reference in day["readings"]:
            for book, start_ch, start_v, end_ch, end_v in reference_ranges(reference):
                bible.append((book, (start_ch, start_v), (end_ch, end_v), day["number"]))
        for passage in commentary_ranges_for_readings(day["readings"]):
            commentary.append((passage, day["number"]))
    return bible, commentary


def scripture_url(chunk, bible):
    data = chunk.metadata
    location = (data.get("chapter"), data.get("first_verse"))
    for book, start, end, day in bible:
        if book == data.get("book") and start <= location <= end:
            slug = re.sub(r"[^a-z0-9]+", "-", book.lower())
            return f"/bible/day/{day}/reader?tab=scripture#verse-{slug}-{location[0]}-{location[1]}"
    return ""


def chunk_result(chunk, query, bible):
    data = chunk.metadata
    if chunk.kind == "scripture":
        url = scripture_url(chunk, bible)
    elif chunk.kind == "catechism":
        day = data.get("day")
        first = re.match(r"\s*(\d+)\.", chunk.text)
        paragraph = first.group(1) if first else data.get("paragraph_start")
        url = f"/catechism/day/{day}/reader?tab=catechism#ccc-{paragraph}" if day else ""
    elif chunk.kind == "journal":
        url = site_path(data.get("url", ""), "/journal")
    else:
        url = site_path(data.get("url", ""), "")
    if not url:
        return None
    return {
        "key": chunk.key,
        "kind": chunk.kind,
        "title": chunk.title,
        "excerpt": excerpt(chunk.text, query),
        "url": url,
    }


def ranked_results(matches, limit):
    """Keep the best excerpt for each source, then apply the result limit."""
    if limit <= 0:
        return []
    results, seen = [], set()
    for _, identity, result in sorted(matches, key=lambda pair: -pair[0]):
        if identity in seen:
            continue
        seen.add(identity)
        results.append(result)
        if len(results) >= limit:
            break
    return results


def site_search(user, query, limit=24):
    """Search what this member can open, without invoking an AI model."""
    query = query.strip()
    if len(query) < 2:
        return {"results": []}
    profile = Profile.objects.filter(user=user).first()
    bible_enabled = profile.bible_enabled if profile else True
    catechism_enabled = profile.catechism_enabled if profile else True
    if not bible_enabled and not catechism_enabled:
        return {"results": []}
    bible, commentary_ranges = reading_locations()
    search_query = SearchQuery(query, search_type="websearch", config="english")
    matches = []

    def add(result, score):
        if result:
            matches.append((score, ("result", result["key"]), result))

    def add_chunks(rows, score_field, boost, candidate_limit):
        # Chunk keys and anchors identify excerpts, not distinct search results.
        # Iterate the ranked rows until enough *openable sources* are found, so
        # one long episode cannot use up the candidate budget before Scripture
        # or other commentary is even considered.
        seen = set()
        for row in rows.iterator(chunk_size=200):
            identity = ("chunk", row.kind, row.source)
            if identity in seen:
                continue
            result = chunk_result(row, query, bible)
            if result is None:
                continue
            seen.add(identity)
            matches.append((boost + float(getattr(row, score_field)), identity, result))
            if len(seen) >= candidate_limit:
                break
        return len(seen)

    chunks = accessible_chunks(user)
    if not bible_enabled:
        chunks = chunks.exclude(kind="scripture").exclude(metadata__edition="bible")
    if not catechism_enabled:
        chunks = chunks.exclude(kind="catechism").exclude(metadata__edition="catechism")
    lexical = (
        chunks.annotate(document=STUDY_SEARCH_VECTOR)
        .filter(document=search_query)
        .annotate(rank=SearchRank(STUDY_SEARCH_VECTOR, search_query))
        .order_by("-rank", "pk")
    )
    lexical_count = add_chunks(lexical, "rank", 2, 45)

    # Whole-word trigrams recover useful near misses such as "eucharits".
    # This only supplements indexed full-text matches; it never calls embeddings.
    if len(query) >= 3 and lexical_count < 12:
        fuzzy = (
            chunks.filter(Q(title__trigram_similar=query) | Q(text__trigram_word_similar=query)).annotate(
                similarity=Greatest(
                    TrigramSimilarity("title", query),
                    TrigramWordSimilarity(query, "text"),
                )
            )
            .filter(similarity__gte=0.28)
            .order_by("-similarity", "pk")
        )
        add_chunks(fuzzy, "similarity", 1, 20)

    episode_scope = Q()
    if bible_enabled:
        episode_scope |= Q(day__isnull=False)
    if catechism_enabled:
        episode_scope |= Q(catechism_day__isnull=False)
    days = (
        Episode.objects.filter(episode_scope)
        .annotate(
            document=SearchVector("title", weight="A", config="english")
            + SearchVector("description", weight="B", config="english")
        )
        .filter(document=search_query)
        .annotate(rank=SearchRank("document", search_query))
        .order_by("-rank", "pk")[:8]
    )
    for row in days:
        edition = "catechism" if row.catechism_day_id else "bible"
        if (edition == "bible" and not bible_enabled) or (edition == "catechism" and not catechism_enabled):
            continue
        day_id = row.catechism_day_id or row.day_id
        add(
            {
                "key": f"day:{edition}:{day_id}",
                "kind": "reading_day",
                "title": row.title,
                "excerpt": excerpt(row.description or "Reading plan day", query),
                "url": f"/{edition}/day/{day_id}",
            },
            2.5 + float(row.rank),
        )

    if catechism_enabled:
        plan = (
            CatechismDay.objects.annotate(
                document=SearchVector("part", weight="A", config="english")
                + SearchVector("section", weight="B", config="english")
                + SearchVector("chapter", weight="B", config="english")
            )
            .filter(document=search_query)
            .annotate(rank=SearchRank("document", search_query))
            .order_by("-rank", "number")[:8]
        )
        for row in plan:
            add(
                {
                    "key": f"day:catechism:{row.number}",
                    "kind": "reading_day",
                    "title": f"Catechism Day {row.number} · {row.chapter or row.section or row.part}",
                    "excerpt": " · ".join(filter(None, [row.part, row.section, row.chapter])),
                    "url": f"/catechism/day/{row.number}",
                },
                2.3 + float(row.rank),
            )

    # Historical commentaries are a separate corpus. Only offer entries that
    # overlap an assigned reading, so every result has an in-app destination.
    historical = (
        Commentary.objects.select_related("author")
        .annotate(document=COMMENTARY_VECTOR)
        .filter(document=search_query)
        .annotate(rank=SearchRank(COMMENTARY_VECTOR, search_query))
        .order_by("-rank", "pk")[:120]
    )
    historical_count = 0
    for row in historical if bible_enabled else []:
        day = next(
            (number for passage, number in commentary_ranges if range_overlaps(row, passage)),
            None,
        )
        if day is None:
            continue
        add(
            {
                "key": f"historical:{row.pk}",
                "kind": "historical_commentary",
                "title": f"{row.author.name} · {row.source_title}",
                "excerpt": excerpt(row.text, query),
                "url": f"/commentaries?day={day}&focus={row.pk}#commentary-{row.pk}",
            },
            1.7 + float(row.rank),
        )
        historical_count += 1
        if historical_count >= 12:
            break

    return {"results": ranked_results(matches, limit)}
