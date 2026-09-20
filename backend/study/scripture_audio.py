"""Align imported Scripture text with timestamped Scripture audio segments."""

import re
import unicodedata
from difflib import SequenceMatcher

MIN_ALIGNMENT_SCORE = 0.48
ANCHOR_TOKENS = 36


def _tokens(value):
    normalized = unicodedata.normalize("NFKD", value or "").casefold()
    return re.findall(r"[a-z0-9]+", normalized)


def _passage_tokens(passage):
    return _tokens(
        " ".join(
            verse["text"]
            for group in passage.get("groups", [])
            for verse in group.get("verses", [])
        )
    )


def _candidate_tokens(segments, start, length):
    result = []
    for segment in segments[start : start + 12]:
        result.extend(_tokens(segment.get("text", "")))
        if len(result) >= length + 8:
            break
    return result[: length + 8]


def _score(anchor, candidate):
    if not anchor or not candidate:
        return 0.0
    return SequenceMatcher(None, anchor, candidate[: len(anchor)]).ratio()


def _heading_start(segments, match_index, cursor, passage):
    books = {
        token
        for group in passage.get("groups", [])
        for token in _tokens(group.get("book", ""))
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
    matching; unmatched passages are omitted instead of guessed.
    """

    labels = {item["id"]: item for item in classification}
    segments = sorted(
        (
            segment
            for segment in transcript
            if labels.get(segment.get("id"), {}).get("kind")
            in {"scripture", "mixed"}
        ),
        key=lambda segment: (float(segment["start"]), segment.get("id", 0)),
    )
    if not segments:
        return []

    matches = []
    cursor = 0
    for passage_index, passage in enumerate(passages):
        passage_words = _passage_tokens(passage)
        anchor = passage_words[:ANCHOR_TOKENS]
        if len(anchor) < 4:
            continue

        candidates = []
        for segment_index in range(cursor, len(segments)):
            candidate = _candidate_tokens(segments, segment_index, len(anchor))
            candidates.append((_score(anchor, candidate), segment_index))
        if not candidates:
            break

        confidence, match_index = max(candidates)
        if confidence < MIN_ALIGNMENT_SCORE:
            continue
        start_index = _heading_start(segments, match_index, cursor, passage)
        matches.append(
            {
                "passage_index": passage_index,
                "reference": passage["reference"],
                "start_index": start_index,
                "confidence": round(confidence, 3),
            }
        )
        cursor = match_index + 1

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
