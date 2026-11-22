"""Align imported Scripture text with timestamped Scripture audio segments."""

import re
import unicodedata
from difflib import SequenceMatcher

from .scripture import BOOKS

MIN_ALIGNMENT_SCORE = 0.48
ANCHOR_TOKENS = 36
# The audio sometimes skips a passage's first verse (e.g. Esther 11:1, a
# colophon read at the end of the book), so later verses may anchor it.
FALLBACK_VERSES = 3
# A spoken chapter heading this close before a later-verse match starts the cue.
HEADING_LOOKBACK_SECONDS = 60

_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_NUMBER_TOKENS = {*_ONES, *_TENS[2:], "hundred"}
_BOOK_TOKENS = {token for book in BOOKS for token in re.findall(r"[a-z]+", book.casefold())} - {
    "of",
    "the",
}


def _tokens(value):
    normalized = unicodedata.normalize("NFKD", value or "").casefold()
    return re.findall(r"[a-z0-9]+", normalized)


def _verses(passage):
    return [verse for group in passage.get("groups", []) for verse in group.get("verses", [])]


def _anchors(passage):
    """Yield opening-token anchors from the first verse, then a few later verses."""
    verses = _verses(passage)
    for skip in range(min(FALLBACK_VERSES, len(verses) - 1) + 1):
        yield skip, _tokens(" ".join(verse["text"] for verse in verses[skip:]))[:ANCHOR_TOKENS]


def _number_words(n):
    if n < 20:
        return [[_ONES[n]]]
    if n < 100:
        tens, ones = divmod(n, 10)
        return [[_TENS[tens]] + ([_ONES[ones]] if ones else [])]
    hundreds, rest = divmod(n, 100)
    if not rest:
        return [[_ONES[hundreds], "hundred"]]
    words = _number_words(rest)[0]
    return [[_ONES[hundreds], "hundred", *words], [_ONES[hundreds], "hundred", "and", *words]]


def _is_heading(tokens, limit, labels, chapter):
    """True when "<label> <chapter>" begins in tokens[:limit], as a whole number."""
    spoken = [[str(chapter)], *_number_words(chapter)]
    for index in range(min(limit, len(tokens))):
        if tokens[index] not in labels:
            continue
        for words in spoken:
            end = index + 1 + len(words)
            following = tokens[end] if end < len(tokens) else ""
            continues = (
                following in _NUMBER_TOKENS
                or following.isdigit()
                or (words[-1] == "hundred" and following == "and")
            )
            if tokens[index + 1 : end] == words and not continues:
                return True
    return False


def _names_other_book(tokens, own):
    """True when tokens say "book of <another book>", as in "The Book of Proverbs"."""
    for index in range(len(tokens) - 2):
        if tokens[index : index + 2] == ["book", "of"]:
            named = tokens[index + 2]
            if named in _BOOK_TOKENS and named not in own:
                return True
    return False


def _chapter_heading(segments, lo, hi, passage, last=False):
    """Index of the first (or last) segment in [lo, hi) announcing the passage's first chapter."""
    verses = _verses(passage)
    if not verses:
        return None
    own_book = {
        token for group in passage.get("groups", []) for token in _tokens(group.get("book"))
    }
    labels = {"chapter", "psalm", "psalms", *own_book}
    indexes = range(max(lo, 0), min(hi, len(segments)))
    for index in reversed(indexes) if last else indexes:
        own = _tokens(segments[index].get("text", ""))
        following = (
            _tokens(segments[index + 1].get("text", "")) if index + 1 < len(segments) else []
        )
        if _names_other_book(own, own_book):
            continue
        if _is_heading(own + following[:4], len(own), labels, verses[0]["chapter"]):
            return index
    return None


def _candidate_tokens(segments, start, length):
    result = []
    for segment in segments[start : start + 12]:
        result.extend(_tokens(segment.get("text", "")))
        if len(result) >= length + 8:
            break
    return result[: length + 8]


def _anchor_end(segments, start, length):
    """Index of the segment holding the last of `length` tokens read from `start`."""
    count = 0
    for index in range(start, len(segments)):
        count += len(_tokens(segments[index].get("text", "")))
        if count >= length:
            return index
    return len(segments) - 1


def _score(anchor, candidate):
    if not anchor or not candidate:
        return 0.0
    return SequenceMatcher(None, anchor, candidate[: len(anchor)]).ratio()


def _heading_start(segments, match_index, cursor, passage):
    books = {
        token for group in passage.get("groups", []) for token in _tokens(group.get("book", ""))
    }
    start = match_index
    while start > cursor:
        previous = segments[start - 1]
        current = segments[start]
        if float(current["start"]) - float(previous["end"]) > 7:
            break
        previous_tokens = _tokens(previous.get("text", ""))
        if not books.intersection(previous_tokens):
            break
        start -= 1
    return start


def align_scripture_audio(passages, transcript, classification):
    """Return reliable passage-level audio cues in canonical passage order.

    The interface deliberately exposes only verified ranges. Callers do not
    need to understand transcript segmentation, classification, or fuzzy
    matching. A passage is matched by its opening verses' text or, failing
    that, by its spoken chapter heading; otherwise it is omitted, not guessed.
    """

    labels = {item["id"]: item for item in classification}
    segments = sorted(
        (
            segment
            for segment in transcript
            if labels.get(segment.get("id"), {}).get("kind") in {"scripture", "mixed"}
        ),
        key=lambda segment: (float(segment["start"]), segment.get("id", 0)),
    )
    if not segments:
        return []

    matches = []
    unmatched = []
    cursor = 0
    for passage_index, passage in enumerate(passages):
        best = None
        for skip, anchor in _anchors(passage):
            if len(anchor) < 4:
                continue
            candidates = [
                (_score(anchor, _candidate_tokens(segments, index, len(anchor))), index)
                for index in range(cursor, len(segments))
            ]
            # On equal scores prefer the earliest segment: a reading comes before
            # any verbatim quotation of it in the commentary that follows.
            top = max(candidates, key=lambda item: (item[0], -item[1]), default=None)
            if top and top[0] >= MIN_ALIGNMENT_SCORE:
                best = (*top, skip, len(anchor))
                break
        if best is None:
            unmatched.append(passage_index)
            continue

        confidence, match_index, skip, anchor_length = best
        start_index = _heading_start(segments, match_index, cursor, passage)
        if skip:
            earliest = float(segments[match_index]["start"]) - HEADING_LOOKBACK_SECONDS
            heading = _chapter_heading(segments, cursor, start_index + 1, passage, last=True)
            if heading is not None and float(segments[heading]["start"]) >= earliest:
                start_index = _heading_start(segments, heading, cursor, passage)
        matches.append(
            {
                "passage_index": passage_index,
                "reference": passage["reference"],
                "start_index": start_index,
                "confidence": round(confidence, 3),
            }
        )
        # The next passage starts after this one's opening words, so a parallel
        # passage (Kings and Chronicles) cannot claim this one's audio.
        cursor = max(match_index + 1, _anchor_end(segments, match_index, anchor_length))

    # Passages whose text never matched (long name lists transcribe poorly) can
    # still be found by their spoken chapter heading, searched only between the
    # neighbouring matched passages so another reading's heading is never taken.
    for passage_index in unmatched:
        before = [m for m in matches if m["passage_index"] < passage_index]
        after = [m for m in matches if m["passage_index"] > passage_index]
        lo = before[-1]["start_index"] + 1 if before else 0
        hi = after[0]["start_index"] if after else len(segments)
        heading = _chapter_heading(segments, lo, hi, passages[passage_index])
        if heading is None:
            continue
        matches.insert(
            len(before),
            {
                "passage_index": passage_index,
                "reference": passages[passage_index]["reference"],
                "start_index": _heading_start(segments, heading, lo, passages[passage_index]),
                "confidence": MIN_ALIGNMENT_SCORE,
            },
        )

    cues = []
    for index, match in enumerate(matches):
        next_start = (
            matches[index + 1]["start_index"] if index + 1 < len(matches) else len(segments)
        )
        end_index = max(match["start_index"], next_start - 1)
        start_segment = segments[match["start_index"]]
        end_segment = segments[end_index]
        cues.append(
            {
                "passage_index": match["passage_index"],
                "reference": match["reference"],
                "start": float(start_segment["start"]),
                "end": float(end_segment["end"]),
                "confidence": match["confidence"],
            }
        )
    return cues
