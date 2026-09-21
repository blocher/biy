import sqlite3
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from study.models import Commentary, CommentaryAuthor


class Command(BaseCommand):
    help = "Import the HistoricalChristianFaith commentary SQLite export."

    def add_arguments(self, parser):
        parser.add_argument("sqlite_path", type=Path)
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete the existing imported commentary catalog before importing.",
        )

    def handle(self, *args, **options):
        sqlite_path = options["sqlite_path"]
        if not sqlite_path.is_file():
            raise CommandError(f"SQLite file not found: {sqlite_path}")
        with sqlite3.connect(sqlite_path) as source:
            source.row_factory = sqlite3.Row
            authors = list(source.execute("SELECT * FROM father_meta ORDER BY name"))
            commentaries = list(source.execute("SELECT * FROM commentary ORDER BY id"))

        with transaction.atomic():
            if options["replace"]:
                Commentary.objects.all().delete()
                CommentaryAuthor.objects.all().delete()
            author_by_name = {}
            for row in authors:
                author, _ = CommentaryAuthor.objects.update_or_create(
                    name=row["name"],
                    defaults={
                        "default_year": int(row["default_year"]),
                        "wiki_url": row["wiki_url"] or "",
                        "category": row["father_category"],
                        "condemned_by_council": bool(row["condemned_by_council"]),
                    },
                )
                author_by_name[author.name] = author

            rows = []
            for row in commentaries:
                author = author_by_name.get(row["father_name"])
                if author is None:
                    raise CommandError(f"Missing author metadata for {row['father_name']}")
                rows.append(
                    Commentary(
                        external_id=row["id"],
                        author=author,
                        file_name=row["file_name"],
                        append_to_author_name=row["append_to_author_name"] or "",
                        year=int(row["ts"]),
                        book_key=row["book"],
                        location_start=int(row["location_start"]),
                        location_end=int(row["location_end"]),
                        text=row["txt"],
                        source_url=row["source_url"] or "",
                        source_title=row["source_title"] or "Untitled source",
                    )
                )
            Commentary.objects.bulk_create(rows, batch_size=2000, ignore_conflicts=True)

        self.stdout.write(
            self.style.SUCCESS(
                f"Imported {len(authors):,} authors and {len(commentaries):,} commentaries."
            )
        )
