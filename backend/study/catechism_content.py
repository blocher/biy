"""Lossless Catechism structure and local citation targets. No AI or document lookup."""

import ast
import hashlib
import json
import re
from collections import Counter

from bs4 import BeautifulSoup, NavigableString

from .scripture import BOOKS, reference_ranges

SOURCE_URL = "https://app.ascensionpress.com/catechism"
BOOK_IDS = "Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Tob Jdt Esth 1Macc 2Macc Job Ps Prov Eccl Song Wis Sir Isa Jer Lam Bar Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev".split()
BOOK_NAMES = dict(zip(BOOK_IDS, BOOKS, strict=True))
ALIASES = {
    **{name: name for name in BOOKS},
    **BOOK_NAMES,
    "Mt": "Matthew",
    "Mk": "Mark",
    "Lk": "Luke",
    "Jn": "John",
    "Ex": "Exodus",
    "Dt": "Deuteronomy",
    "Ps": "Psalm",
    "Psalms": "Psalm",
    "Is": "Isaiah",
    "Ez": "Ezekiel",
    "Mic": "Micah",
    "Jon": "Jonah",
    "Am": "Amos",
    "Pss": "Psalm",
    "1 Jn": "1 John",
    "2 Jn": "2 John",
    "3 Jn": "3 John",
}
ALIASES.update({re.sub(r"^([123])", r"\1 ", key): value for key, value in BOOK_NAMES.items()})
CITATION = re.compile(
    r"(?<!\w)("
    + "|".join(re.escape(a) for a in sorted(ALIASES, key=len, reverse=True))
    + r")\.?\s+(\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?(?:[,;]\s*\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?)*)(?![\w:(])"
)
HEADINGS = {"subTitle", "richSubTitle", "articleTitle", "inBriefTitle"}
EDITORIAL = {"Sources from Scripture and the Church", "Words to Know"}
KINDS = {
    "paragraph": "paragraph",
    "smallParagraph": "paragraph",
    "inBriefParagraph": "paragraph",
    "text": "paragraph",
    "richText": "paragraph",
    "quoteParagraph": "quote",
    "numberedList": "ordered_list",
    "inBriefList": "list",
    "table": "table",
}


def clean(text):
    return re.sub(r"\s+", " ", text.replace("\u00ad", "")).strip()


def extract_dataset(script):
    """Decode a JSON string literal, never execute downloaded JavaScript."""
    for match in re.finditer(r"JSON\.parse\(('(?:[^'\\]|\\.)*')\)", script):
        if '"book":"prologue"' not in match[1][:200]:
            continue
        data = json.loads(ast.literal_eval(match[1]))
        if isinstance(data, list) and data and data[0].get("book") == "prologue":
            return data
    raise ValueError("No structured Catechism dataset found in this script.")


def bible_target(element):
    label = clean(element.get("data-text") or element.get_text())
    book = BOOK_NAMES.get(element.get("data-book"))
    # The source's location metadata identifies only the first verse. Parse the
    # displayed citation so a range is never silently truncated to that verse.
    match = CITATION.fullmatch(label)
    if not book or not match or ALIASES[match[1]] != book:
        return {"type": "bible", "text": label, "reference": None}
    tail = match[2].replace("–", "-").replace("—", "-")
    # Dual Psalm numbering needs a verified mapping; retain it as unresolved.
    if "(" in tail:
        return {"type": "bible", "text": label, "reference": None}
    parts = re.split(r"([,;])", tail)
    chapter = parts[0].split(":")[0]
    verse_context = ":" in parts[0]
    reference = f"{book} {parts[0]}"
    for separator, part in zip(parts[1::2], parts[2::2], strict=True):
        part = part.strip()
        if ":" in part:
            chapter = part.split(":")[0]
            verse_context = True
        elif separator == "," and verse_context:
            part = f"{chapter}:{part}"
        else:
            chapter = part.split("-")[0]
            verse_context = False
        reference += f", {part}"
    ranges = list(reference_ranges(reference))
    if any(
        not 1 <= fc <= lc <= 150
        or not 1 <= fv <= 176
        or not (1 <= lv <= 176 or lv == 999)
        or (fc, fv) > (lc, lv)
        for _, fc, fv, lc, lv in ranges
    ):
        reference = None
    return {"type": "bible", "text": label, "reference": reference}


def plain(nodes):
    return "".join(
        (
            ""
            if n["type"] == "note"
            else n.get("text", "")
            if "children" not in n
            else plain(n["children"])
        )
        + (" " if n["type"] in {"item", "row", "cell"} else "")
        for n in nodes
    )


def parse_inline(html, note_ids=None):
    note_ids = note_ids or {}

    def convert(node):
        if isinstance(node, NavigableString):
            text = re.sub(r"\s+", " ", str(node).replace("\u00ad", ""))
            result, last = [], 0
            for match in CITATION.finditer(text):
                result.append({"type": "text", "text": text[last : match.start()]})
                anchor = BeautifulSoup("<a></a>", "html.parser").a
                anchor["data-text"] = match[0]
                anchor["data-book"] = next(
                    key for key, value in BOOK_NAMES.items() if value == ALIASES[match[1]]
                )
                result.append(bible_target(anchor))
                last = match.end()
            result.append({"type": "text", "text": text[last:]})
            return result
        if node.name == "a":
            if node.has_attr("data-book"):
                return [bible_target(node)]
            label = clean(node.get_text())
            if label not in note_ids:
                raise ValueError(f"Footnote marker {label!r} has no source note.")
            return [{"type": "note", "id": note_ids[label], "text": label}]
        tags = {
            "i": "em",
            "em": "em",
            "strong": "strong",
            "b": "strong",
            "li": "item",
            "tr": "row",
            "td": "cell",
        }
        if node.name == "br":
            return [{"type": "text", "text": "\n"}]
        if node.name not in tags:
            raise ValueError(f"Unexpected source markup: {node.name}")
        return [
            {"type": tags[node.name], "children": [n for c in node.children for n in convert(c)]}
        ]

    soup = BeautifulSoup(html, "html.parser")
    # Ascension sometimes links only the beginning of a citation: e.g.
    # <a data-text="Rev 21:1-22"></a>:5. Include the literal continuation.
    for anchor in soup.select("a[data-book]"):
        sibling = anchor.next_sibling
        if isinstance(sibling, NavigableString):
            suffix = re.match(
                r"^(?::\d+)?(?:[,;]\s*\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?)*", str(sibling)
            )[0]
            if suffix:
                anchor["data-text"] = anchor.get("data-text", "") + suffix
                sibling.replace_with(str(sibling)[len(suffix) :])
    return [n for child in soup.contents for n in convert(child)]


def normalize_dataset(data):
    rows, pending, pending_notes, context = [], [], [], []
    current = None
    serial = 0
    report = {"excluded_editorial_blocks": 0, "unresolved_bible": [], "unplaced_notes": []}

    def heading(text, level):
        nonlocal context, current
        block = {"kind": "heading", "level": level, "children": parse_inline(text)}
        title = clean(plain(block["children"]))
        if context and context[-1]["text"] == title:
            return
        context = [h for h in context if h["level"] < level] + [{"text": title, "level": level}]
        pending.append(block)
        current = None

    def visit(node, path, level):
        nonlocal current, serial, context
        title = node.get("title") or (node.get("heading") if level == 1 else "")
        if title:
            heading(title, level)
        section_context = list(context)
        editorial = False
        for source in node.get("blocks", []):
            serial += 1
            kind = source["type"]
            label = clean(BeautifulSoup(source.get("text", ""), "html.parser").get_text())
            if kind in HEADINGS and label in EDITORIAL:
                editorial = True
            elif kind in HEADINGS or source.get("paragraphNumber"):
                editorial = False
            if editorial:
                report["excluded_editorial_blocks"] += 1
                continue
            if kind not in HEADINGS and kind not in KINDS:
                raise ValueError(f"Unsupported canonical block {kind!r} at {path}.")
            ids = {str(k): f"n{serial}-{k}" for k in source.get("crossLinks", {})}
            notes = [
                {"id": ids[str(k)], "label": str(k), "children": parse_inline(v["text"])}
                for k, v in source.get("crossLinks", {}).items()
            ]
            children = parse_inline(source.get("text", ""), ids)
            if kind in HEADINGS:
                level2 = 4 if kind == "articleTitle" else 5 if re.match(r"^[IVX]+\.", label) else 6
                # Rich headings can have their own footnote markers.
                context = [h for h in context if h["level"] < level2] + [
                    {"text": clean(plain(children)), "level": level2}
                ]
                pending.append({"kind": "heading", "level": level2, "children": children})
                pending_notes.extend(notes)
                current = None
                continue
            number = source.get("paragraphNumber")
            if number:
                current = {
                    "number": number,
                    "source_url": SOURCE_URL + path,
                    "content": {
                        "schema": 1,
                        "before": list(pending),
                        "blocks": [],
                        "notes": list(pending_notes),
                        "context": list(context),
                        "cross_references": [],
                    },
                }
                rows.append(current)
                pending.clear()
                pending_notes.clear()
            block = {"kind": KINDS[kind], "children": children}
            destination = current["content"]["blocks"] if current else pending
            destination.append(block)
            if source.get("appendedQuote"):
                destination.append(
                    {"kind": "quote", "children": parse_inline(source["appendedQuote"], ids)}
                )
            if current:
                current["content"]["notes"].extend(notes)
                current["content"]["cross_references"].extend(source.get("backLinks", []))
            else:
                pending_notes.extend(notes)
        for key, child_level in [("sections", 2), ("chapters", 3), ("articles", 4)]:
            for index, child in enumerate(node.get(key, []), 1):
                context = list(section_context)
                current = None
                number = child.get("sectionNumber", child.get("chapterNumber", index))
                visit(child, f"{path}/{number}", child_level)

    for book in data:
        if book.get("book") not in {"prologue", "one", "two", "three", "four"}:
            continue
        context = []
        current = None
        visit(book, f"/{book['book']}", 1)
    numbers = [r["number"] for r in rows]
    if sorted(numbers) != list(range(1, 2866)):
        counts = Counter(numbers)
        raise ValueError(
            f"Expected CCC 1–2865 exactly once; missing {sorted(set(range(1, 2866)) - set(numbers))[:10]}, duplicates {[n for n, c in counts.items() if c > 1][:10]}."
        )
    if pending or pending_notes:
        raise ValueError("Unattached content at the end of the Catechism.")

    def all_nodes(nodes):
        for n in nodes:
            yield n
            yield from all_nodes(n.get("children", []))

    for row in rows:
        content = row["content"]
        row["text"] = "\n\n".join(clean(plain(b["children"])) for b in content["blocks"])
        if not row["text"]:
            raise ValueError(f"Empty paragraph {row['number']}.")
        refs = content["cross_references"]
        if any(not isinstance(n, int) or not 1 <= n <= 2865 for n in refs):
            raise ValueError(f"Invalid CCC cross-reference at {row['number']}.")
        content["cross_references"] = list(dict.fromkeys(refs))
        nodes = [n for b in content["before"] + content["blocks"] for n in all_nodes(b["children"])]
        markers = {n["id"] for n in nodes if n["type"] == "note"}
        for note in content["notes"]:
            if note["id"] not in markers:
                report["unplaced_notes"].append(
                    {"paragraph": row["number"], "label": note["label"]}
                )
            nodes.extend(all_nodes(note["children"]))
        for n in nodes:
            if n["type"] == "bible" and not n["reference"]:
                report["unresolved_bible"].append({"paragraph": row["number"], "text": n["text"]})
    report.update(
        paragraphs=len(rows),
        notes=sum(len(r["content"]["notes"]) for r in rows),
        cross_references=sum(len(r["content"]["cross_references"]) for r in rows),
    )
    return rows, report


def source_digest(data):
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def paragraph_data(paragraph):
    return {
        "number": paragraph.number,
        "text": paragraph.text,
        "source_url": paragraph.source_url,
        "content": paragraph.content,
        "provenance": paragraph.provenance,
    }
