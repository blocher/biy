"""Conservative paragraph cues from existing, classified podcast timestamps."""

import math
from difflib import SequenceMatcher

from .scripture_audio import _tokens


def _reading_runs(transcript, classification):
    labels = {item["id"]: item for item in classification}
    runs = []
    words, sources = [], []
    previous_end = None
    for segment in sorted(transcript, key=lambda item: float(item["start"])):
        start, end = float(segment["start"]), float(segment["end"])
        # Mixed segments have no word-level timestamps. Including them would
        # claim commentary as reading; keep these unavailable until re-aligned.
        reading = (
            labels.get(segment.get("id"), {}).get("kind") == "catechism"
            and math.isfinite(start)
            and math.isfinite(end)
            and 0 <= start < end
        )
        if not reading or (previous_end is not None and start - previous_end > 7):
            if words:
                runs.append((words, sources))
            words, sources = [], []
        if reading:
            tokens = _tokens(segment.get("text", ""))
            words.extend(tokens)
            sources.extend([segment] * len(tokens))
        previous_end = end if reading else None
    if words:
        runs.append((words, sources))
    return runs


def align_catechism_audio(paragraphs, transcript, classification):
    """Align both ends of each paragraph; never extend through an unmatched one.

    Cues have transcript-segment precision, so adjacent paragraphs may share a
    boundary segment. Consumers merge overlapping cues when playing a day.
    No audio is generated and no classification or source text is modified.
    """
    runs = _reading_runs(transcript, classification)
    cues = []
    cursor = (0, 0)
    for paragraph in paragraphs:
        anchor = _tokens(paragraph["text"])
        if len(anchor) < 4:
            continue
        candidates = []
        for run_index, (words, sources) in enumerate(runs):
            if run_index < cursor[0]:
                continue
            first = cursor[1] if run_index == cursor[0] else 0
            for offset in range(first, len(words)):
                if words[offset] != anchor[0]:
                    continue
                window = words[offset : offset + len(anchor) + max(8, len(anchor) // 5)]
                blocks = SequenceMatcher(None, anchor, window, autojunk=False).get_matching_blocks()
                blocks = [block for block in blocks if block.size]
                matched = sum(block.size for block in blocks)
                confidence = matched / len(anchor)
                # Both opening and closing phrases must match, not just a
                # quoted sentence or a fragment from an incomplete import.
                last = blocks[-1]
                if (
                    confidence < 0.75
                    or blocks[0].a != 0
                    or blocks[0].b != 0
                    or blocks[0].size < min(4, len(anchor))
                    or last.a + last.size != len(anchor)
                    or last.size < min(4, len(anchor))
                ):
                    continue
                finish = offset + last.b + last.size - 1
                candidates.append((confidence, run_index, offset, finish))
        if not candidates:
            continue
        confidence, run_index, offset, finish = max(
            candidates, key=lambda match: (match[0], -match[1], -match[2])
        )
        sources = runs[run_index][1]
        cues.append(
            {
                "paragraph_number": paragraph["number"],
                "reference": f"CCC {paragraph['number']}",
                "start": float(sources[offset]["start"]),
                "end": float(sources[finish]["end"]),
                "confidence": round(confidence, 3),
            }
        )
        cursor = (run_index, finish + 1)
    return cues
