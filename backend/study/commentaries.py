"""Translate RSV-2CE references to the commentary export's passage keys."""

from dataclasses import dataclass

from django.db.models import Q

from .models import Commentary, Day
from .scripture import reference_ranges


COMMENTARY_BOOK_ALIASES = {
    "Psalm": "psalms",
}


@dataclass(frozen=True)
class CommentaryRange:
    reference: str
    book_key: str
    start: int
    end: int


def encode_location(chapter: int, verse: int) -> int:
    return (chapter * 1_000_000) + verse


def commentary_book_key(book: str) -> str:
    return COMMENTARY_BOOK_ALIASES.get(book, book.lower().replace(" ", ""))


def commentary_ranges(reference: str) -> list[CommentaryRange]:
    """Return chapter-sized inclusive ranges for one reading reference.

    The source database stores cross-chapter passages as one numeric interval,
    so splitting a reading into chapter-sized ranges also matches those rows.
    """

    ranges = []
    for book, first_ch, first_v, last_ch, last_v in reference_ranges(reference):
        book_key = commentary_book_key(book)
        for chapter in range(first_ch, last_ch + 1):
            start_verse = first_v if chapter == first_ch else 1
            end_verse = last_v if chapter == last_ch else 999_999
            ranges.append(
                CommentaryRange(
                    reference=reference,
                    book_key=book_key,
                    start=encode_location(chapter, start_verse),
                    end=encode_location(chapter, end_verse),
                )
            )
    return ranges


def commentary_ranges_for_readings(readings: list[str]) -> list[CommentaryRange]:
    ranges = []
    for reference in readings:
        ranges.extend(commentary_ranges(reference))
    return ranges


def range_overlaps(row, passage_range: CommentaryRange) -> bool:
    return (
        row.book_key == passage_range.book_key
        and row.location_end >= passage_range.start
        and row.location_start <= passage_range.end
    )


def matching_references(row, ranges: list[CommentaryRange]) -> list[str]:
    """Return the user-facing readings touched by an imported commentary."""

    return list(dict.fromkeys(r.reference for r in ranges if range_overlaps(row, r)))


def year_label(year: int) -> str:
    if year == 9_999:
        return "Date unknown"
    if year < 0:
        return f"c. {abs(year)} BC"
    return f"c. AD {year}"


def historical_commentaries(
    reference: str | None = None,
    day: int | None = None,
    offset: int = 0,
    limit: int = 6,
):
    """Return bounded historical sources matched to an RSV-2CE passage or day."""

    if reference:
        try:
            ranges = commentary_ranges(reference)
        except (TypeError, ValueError):
            return {
                "sources": [],
                "error": "Use a full Bible reference, such as Genesis 1:1-5.",
            }
    elif day is not None:
        reading_day = Day.objects.filter(pk=day).first()
        if not reading_day:
            return {"sources": [], "error": "Reading day not found."}
        ranges = commentary_ranges_for_readings(reading_day.readings)
    else:
        return {"sources": [], "error": "Provide a passage reference or reading day."}

    if not ranges:
        return {"sources": [], "total": 0, "next_offset": None}

    overlap = Q()
    for passage_range in ranges:
        overlap |= Q(
            book_key=passage_range.book_key,
            location_end__gte=passage_range.start,
            location_start__lte=passage_range.end,
        )
    queryset = Commentary.objects.select_related("author").filter(overlap).order_by(
        "year", "pk"
    )
    total = queryset.count()
    rows = list(queryset[offset : offset + limit])
    sources = []
    for row in rows:
        author = row.author
        sources.append(
            {
                "id": f"H{row.pk}",
                "kind": "historical_commentary",
                "title": f"{author.name} · {row.source_title}",
                "text": row.text[:5000],
                "url": row.source_url,
                "metadata": {
                    "author": author.name,
                    "year": row.year,
                    "year_label": year_label(row.year),
                    "category": author.category,
                    "condemned_by_council": author.condemned_by_council,
                    "matched_references": matching_references(row, ranges),
                    "truncated": len(row.text) > 5000,
                },
            }
        )
    return {
        "sources": sources,
        "total": total,
        "next_offset": offset + limit if offset + limit < total else None,
        "scope": {"reference": reference, "day": day},
        "notice": (
            "Historical excerpts are ordered oldest to newest; use pagination for additional witnesses."
            if total > len(rows)
            else None
        ),
    }
