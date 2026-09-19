"""Parse reading references, including lists and cross-chapter verse boundaries."""

import re

from .models import Verse

BOOKS = [
    "Genesis",
    "Exodus",
    "Leviticus",
    "Numbers",
    "Deuteronomy",
    "Joshua",
    "Judges",
    "Ruth",
    "1 Samuel",
    "2 Samuel",
    "1 Kings",
    "2 Kings",
    "1 Chronicles",
    "2 Chronicles",
    "Ezra",
    "Nehemiah",
    "Tobit",
    "Judith",
    "Esther",
    "1 Maccabees",
    "2 Maccabees",
    "Job",
    "Psalm",
    "Proverbs",
    "Ecclesiastes",
    "Song of Solomon",
    "Wisdom",
    "Sirach",
    "Isaiah",
    "Jeremiah",
    "Lamentations",
    "Baruch",
    "Ezekiel",
    "Daniel",
    "Hosea",
    "Joel",
    "Amos",
    "Obadiah",
    "Jonah",
    "Micah",
    "Nahum",
    "Habakkuk",
    "Zephaniah",
    "Haggai",
    "Zechariah",
    "Malachi",
    "Matthew",
    "Mark",
    "Luke",
    "John",
    "Acts",
    "Romans",
    "1 Corinthians",
    "2 Corinthians",
    "Galatians",
    "Ephesians",
    "Philippians",
    "Colossians",
    "1 Thessalonians",
    "2 Thessalonians",
    "1 Timothy",
    "2 Timothy",
    "Titus",
    "Philemon",
    "Hebrews",
    "James",
    "1 Peter",
    "2 Peter",
    "1 John",
    "2 John",
    "3 John",
    "Jude",
    "Revelation",
]


def reference_ranges(reference):
    book = None
    for part in reference.replace("–", "-").split(","):
        part = part.strip()
        found = next(
            (
                b
                for b in sorted(BOOKS, key=len, reverse=True)
                if part == b or part.startswith(b + " ")
            ),
            None,
        )
        if found:
            book = found
            part = part[len(book) :].strip() or "1"
        if not book:
            raise ValueError(f"Unknown Bible book: {reference}")
        if not re.fullmatch(r"\d+(?::\d+)?(?:-\d+(?::\d+)?)?", part):
            raise ValueError(f"Unsupported reference: {reference}")
        first, _, last = part.partition("-")
        fc, _, fv = first.partition(":")
        if not last:
            lc, lv = fc, fv or "999"
        elif ":" in last:
            lc, lv = last.split(":")
        elif fv and int(last) >= int(fv):
            lc, lv = fc, last
        else:
            lc, lv = last, "999"
        yield book, int(fc), int(fv or 1), int(lc), int(lv)


def reading_text(reference):
    groups = []
    for book, first_ch, first_v, last_ch, last_v in reference_ranges(reference):
        verses = Verse.objects.filter(book=book, chapter__gte=first_ch, chapter__lte=last_ch)
        selected = [
            v
            for v in verses
            if (v.chapter, v.number) >= (first_ch, first_v)
            and (v.chapter, v.number) <= (last_ch, last_v)
        ]
        groups.append(
            {
                "book": book,
                "verses": [
                    {
                        "chapter": v.chapter,
                        "verse": v.number,
                        "text": v.text,
                        "paragraph": v.paragraph,
                    }
                    for v in selected
                ],
                "missing": not selected,
            }
        )
    return {"reference": reference, "groups": groups}
