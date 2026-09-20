import os
import re
from pathlib import Path

from bs4 import BeautifulSoup
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from study.models import Verse
from study.scripture import BOOKS


class Command(BaseCommand):
    help = "Import structured verses from the supplied local RSV Catholic Study Bible HTML."

    def add_arguments(self, parser):
        parser.add_argument("--source", default=os.getenv("BIBLE_SOURCE_DIR"))
        parser.add_argument("--day", type=int, help="Import only chapters needed by this plan day.")

    @transaction.atomic
    def handle(self, source, day, **options):
        if not source or not Path(source).is_dir():
            raise CommandError("Set BIBLE_SOURCE_DIR or --source to the Bible text directory.")
        wanted = None
        if day:
            from study.models import Day
            from study.scripture import reference_ranges

            wanted = {
                (book, ch)
                for ref in Day.objects.get(pk=day).readings
                for book, a, _, b, _ in reference_ranges(ref)
                for ch in range(a, b + 1)
            }
        records = []
        for path in sorted(Path(source).glob("*_text_*.html")):
            m = re.match(r"(\d+)_.*_text_(\d+)\.html", path.name)
            if not m or not 1 <= int(m[1]) <= len(BOOKS):
                continue
            source_books = BOOKS[:19] + BOOKS[21:46] + BOOKS[19:21] + BOOKS[46:]
            book = source_books[int(m[1]) - 1]
            if wanted is not None and not any(b == book for b, _ in wanted):
                continue
            soup = BeautifulSoup(path.read_text(), "lxml")
            for verse in soup.select("verse[id]"):
                vid = verse.get("id", "")
                if not re.fullmatch(r"v\d{8}", vid):
                    continue
                # Esther files follow narrative order, not canonical chapter numbers.
                # Verse IDs preserve the actual chapter even across additions in one file.
                chapter, number = int(vid[3:6]), int(vid[-3:])
                if wanted is not None and (book, chapter) not in wanted:
                    continue
                body = verse.find("verse_body")
                if body is None:
                    continue
                for node in body.select("ver, .enote, .verse_xref_link"):
                    node.decompose()
                content = re.sub(r"\s+", " ", body.get_text()).strip()
                records.append(
                    Verse(
                        book=book,
                        chapter=chapter,
                        number=number,
                        text=content,
                        paragraph=bool(body.find("p")),
                    )
                )
        if not records:
            raise CommandError("No verses found; source format does not match.")
        Verse.objects.bulk_create(
            records,
            update_conflicts=True,
            unique_fields=["book", "chapter", "number"],
            update_fields=["text", "paragraph"],
        )
        from study.search import index_chapter

        for book, chapter in sorted({(v.book, v.chapter) for v in records}):
            index_chapter(book, chapter)
        self.stdout.write(f"Imported {len(records)} verses; search indexing queued.")
