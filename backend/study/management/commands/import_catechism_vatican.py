import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from study.models import CatechismParagraph
from study.search import index_catechism

BASE_URL = "https://www.vatican.va/archive/ENG0015/"
INDEX_NAME = "_INDEX.HTM"
PAGE_PATTERN = re.compile(r"^__P[0-9A-Z]+\.HTM$", re.I)
PARAGRAPH_PATTERN = re.compile(r"^(\d{1,4})\s+(.*)$", re.S)


def parse_page(content, source_url):
    soup = BeautifulSoup(content, "lxml")
    rows = []
    current = None
    for element in soup.select("p.MsoNormal"):
        for marker in element.select("sup"):
            marker.decompose()
        text = " ".join(element.get_text(" ", strip=True).split())
        match = PARAGRAPH_PATTERN.match(text)
        if not match:
            is_heading = bool(element.find("b")) or (
                text and text.upper() == text and len(text) < 180
            )
            if current is not None and text and not is_heading:
                current["text"] += " " + text
            elif is_heading:
                current = None
            continue
        number = int(match[1])
        if not 1 <= number <= 2865:
            continue
        body = match[2].strip()
        if not body:
            continue
        current = {"number": number, "text": body, "source_url": source_url}
        rows.append(current)
        # Two source pages merge the next numbered paragraph into this one.
        # Split only the exact sequential number so Scripture/footnote numerals
        # cannot accidentally become Catechism paragraph boundaries.
        next_marker = re.search(rf"\s{number + 1}\s+(?=[A-Z\"'])", current["text"])
        if next_marker:
            before = current["text"][: next_marker.start()].rstrip()
            after = current["text"][next_marker.end() :].strip()
            current["text"] = before
            current = {
                "number": number + 1,
                "text": after,
                "source_url": source_url,
            }
            rows.append(current)
    return rows


class Command(BaseCommand):
    help = "Import CCC 1-2865 from the English Catechism on vatican.va."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            type=Path,
            help="Read _INDEX.HTM and linked pages from a local mirror.",
        )
        parser.add_argument(
            "--index-for-ask",
            action="store_true",
            help="Queue Catechism search chunks for embedding after import.",
        )

    def read(self, name, source, client):
        if source:
            return (source / name).read_bytes(), urljoin(BASE_URL, name)
        url = urljoin(BASE_URL, name)
        response = client.get(url)
        response.raise_for_status()
        return response.content, url

    @transaction.atomic
    def handle(self, **options):
        if CatechismParagraph.objects.exclude(content={}).exists():
            raise CommandError(
                "Structured text is already installed. Use import_catechism --restore to roll back."
            )
        source = options["source"]
        if source and not (source / INDEX_NAME).exists():
            raise CommandError(f"Missing {source / INDEX_NAME}")
        headers = {"User-Agent": "BIY-CIY private study importer"}
        with httpx.Client(timeout=60, follow_redirects=True, headers=headers) as client:
            index, _ = self.read(INDEX_NAME, source, client)
            soup = BeautifulSoup(index, "lxml")
            names = []
            for link in soup.find_all("a", href=True):
                name = link["href"].split("#", 1)[0]
                if PAGE_PATTERN.match(name) and name.upper() not in {
                    item.upper() for item in names
                }:
                    names.append(name)
            if not names:
                raise CommandError("The Vatican index did not contain Catechism text pages.")
            parsed = {}

            def fetch(name):
                content, url = self.read(name, source, client)
                return parse_page(content, url)

            workers = 1 if source else 12
            with ThreadPoolExecutor(max_workers=workers) as executor:
                page_rows = executor.map(fetch, names)
                for rows in page_rows:
                    for row in rows:
                        previous = parsed.get(row["number"])
                        if previous and previous["text"] != row["text"]:
                            raise CommandError(f"Conflicting text found for CCC {row['number']}.")
                        parsed[row["number"]] = row
        if sorted(parsed) != list(range(1, 2866)):
            missing = sorted(set(range(1, 2866)) - set(parsed))
            raise CommandError(f"Expected CCC 1-2865 exactly once; missing {missing[:10]}.")
        CatechismParagraph.objects.bulk_create(
            [CatechismParagraph(**parsed[number]) for number in sorted(parsed)],
            update_conflicts=True,
            update_fields=["text", "source_url"],
            unique_fields=["number"],
        )
        if options["index_for_ask"]:
            index_catechism()
            self.stdout.write("Imported 2,865 Catechism paragraphs and queued Ask indexing.")
        else:
            self.stdout.write(
                "Imported 2,865 Catechism paragraphs from vatican.va. "
                "No Ask indexing or AI work was queued."
            )
