"""Extract the official Catechism in a Year plan into application seed data."""

import argparse
import json
import re
from pathlib import Path

import pdfplumber

PART_COLORS = {
    1: "#00798c",
    2: "#952d53",
    3: "#489678",
    4: "#7e5a89",
}
PART_NAMES = {
    1: "Part One: What We Believe",
    2: "Part Two: How We Worship",
    3: "Part Three: How We Live",
    4: "Part Four: How We Pray",
}
INTRO_DAYS = {3: 1, 144: 2, 230: 3, 328: 4}


def clean(value):
    return " ".join((value or "").split())


def title_case(value):
    minor_words = {"a", "an", "and", "for", "in", "of", "on", "the", "to"}
    words = value.lower().split()
    return " ".join(
        word if index and word in minor_words else word.capitalize()
        for index, word in enumerate(words)
    )


def normalize_heading(value, level):
    value = clean(value)
    if not value:
        return ""
    match = re.match(rf"^(.*?)\s+{level}\s+(\w+)$", value, re.I)
    if not match:
        raise ValueError(f"Unexpected {level.lower()} heading: {value!r}")
    return f"{level} {match[2].title()}: {title_case(match[1])}"


def part_number(day):
    if day < 144:
        return 1
    if day < 230:
        return 2
    if day < 328:
        return 3
    return 4


def extract(pdf):
    rows = []
    current = {"part": "", "section": "", "chapter": ""}
    with pdfplumber.open(pdf) as document:
        for page in document.pages[2:]:
            tables = page.extract_tables()
            if len(tables) != 1:
                raise ValueError(f"Expected one plan table on page {page.page_number}.")
            for source in tables[0][1:]:
                if len(source) != 6 or not clean(source[1]).isdigit():
                    continue
                day = int(clean(source[1]))
                values = {
                    "part": clean(source[2]),
                    "section": normalize_heading(source[3], "Section"),
                    "chapter": normalize_heading(source[4], "Chapter"),
                }
                if day in INTRO_DAYS:
                    part = INTRO_DAYS[day]
                    rows.append(
                        {
                            "number": day,
                            # Introduction episodes belong to the pillar they
                            # introduce; only the Prologue remains separate.
                            "part": PART_NAMES[part],
                            "section": "",
                            "chapter": "",
                            "paragraph_start": None,
                            "paragraph_end": None,
                            "color": PART_COLORS[part],
                        }
                    )
                    continue
                for key, value in values.items():
                    if value:
                        if key == "part":
                            current[key] = (
                                "Prologue"
                                if value.casefold() == "prologue"
                                else PART_NAMES[part_number(day)]
                            )
                        else:
                            current[key] = value
                paragraph_match = re.search(r"(\d+)-(\d+)\s*$", clean(source[5]))
                if not paragraph_match:
                    raise ValueError(f"Day {day} has no paragraph range: {source[5]!r}")
                rows.append(
                    {
                        "number": day,
                        **current,
                        "paragraph_start": int(paragraph_match[1]),
                        "paragraph_end": int(paragraph_match[2]),
                        "color": PART_COLORS[part_number(day)],
                    }
                )
    if [row["number"] for row in rows] != list(range(1, 366)):
        raise ValueError("The extracted plan does not contain Days 1-365 exactly once.")
    covered = [
        number
        for row in rows
        if row["paragraph_start"] is not None
        for number in range(row["paragraph_start"], row["paragraph_end"] + 1)
    ]
    if covered != list(range(1, 2866)):
        raise ValueError("The extracted paragraph ranges do not cover CCC 1-2865 exactly once.")
    return rows


parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("--output", default="backend/study/catechism_reading_plan.json")
args = parser.parse_args()
result = extract(args.pdf)
Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
print(f"Extracted {len(result)} days through CCC 2865.")
