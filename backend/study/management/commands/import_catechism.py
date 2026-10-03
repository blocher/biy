import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from study.catechism_content import normalize_dataset, paragraph_data, source_digest
from study.models import CatechismParagraph
from study.search import index_catechism

# Preserve the parser import used by the existing Vatican regression fixtures.
from .import_catechism_vatican import parse_page  # noqa: F401


class Command(BaseCommand):
    help = "Validate an Ascension snapshot and report changes. Write only with --apply --backup."

    def add_arguments(self, parser):
        parser.add_argument("--source", type=Path, required=True)
        parser.add_argument("--report", type=Path, required=True)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--backup", type=Path)
        parser.add_argument(
            "--restore", action="store_true", help="Restore a backup created by this command."
        )
        parser.add_argument("--index-for-ask", action="store_true")

    def handle(self, **options):
        if options["index_for_ask"] and not options["apply"]:
            raise CommandError("--index-for-ask requires --apply.")
        if options["apply"] and not options["backup"]:
            raise CommandError("--apply requires a new --backup path for rollback.")
        paths = [options[k].resolve() for k in ("source", "report", "backup") if options[k]]
        if len(set(paths)) != len(paths):
            raise CommandError("Source, report, and backup must be separate files.")
        try:
            snapshot = json.loads(options["source"].read_text())
            if options["restore"]:
                if snapshot.get("format") != "biy-catechism-backup-v1":
                    raise ValueError("Not a Catechism backup.")
                rows = snapshot["paragraphs"]
                numbers = [r["number"] for r in rows]
                if len(set(numbers)) != len(numbers) or any(not 1 <= n <= 2865 for n in numbers):
                    raise ValueError("Backup has duplicate or invalid CCC numbers.")
                report = {"restoring": True, "paragraphs": len(rows)}
            else:
                digest = source_digest(snapshot["data"])
                if snapshot["provenance"]["sha256"] != digest:
                    raise ValueError("Snapshot checksum does not match its data.")
                rows, report = normalize_dataset(snapshot["data"])
                for row in rows:
                    row["provenance"] = snapshot["provenance"]
        except (ValueError, KeyError, TypeError, OSError) as exc:
            raise CommandError(f"Invalid Catechism source: {exc}") from exc
        # Serialize imports and preserve a consistent rollback image of every
        # paragraph. Network work happens in fetch_catechism, outside this lock.
        with transaction.atomic():
            old = {
                r.number: paragraph_data(r) for r in CatechismParagraph.objects.select_for_update()
            }
            report["changes"] = [
                {
                    "number": r["number"],
                    "old_text": old.get(r["number"], {}).get("text"),
                    "new_text": r["text"],
                    "structure_changed": old.get(r["number"], {}).get("content") != r["content"],
                }
                for r in rows
                if old.get(r["number"]) != r
            ]
            report["applied"] = bool(options["apply"])
            report["removed_paragraphs"] = (
                sorted(set(old) - {r["number"] for r in rows}) if options["restore"] else []
            )
            if options["apply"]:
                backup = options["backup"]
                backup.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with backup.open("x") as stream:
                        json.dump(
                            {"format": "biy-catechism-backup-v1", "paragraphs": list(old.values())},
                            stream,
                            ensure_ascii=False,
                        )
                except FileExistsError as exc:
                    raise CommandError("Backup already exists; choose a new path.") from exc
                if options["restore"]:
                    CatechismParagraph.objects.exclude(
                        number__in=[r["number"] for r in rows]
                    ).delete()
                CatechismParagraph.objects.bulk_create(
                    [CatechismParagraph(**r) for r in rows],
                    update_conflicts=True,
                    update_fields=["text", "source_url", "content", "provenance"],
                    unique_fields=["number"],
                )
            options["report"].parent.mkdir(parents=True, exist_ok=True)
            options["report"].write_text(json.dumps(report, ensure_ascii=False, indent=2))
        if options["index_for_ask"]:
            index_catechism()
        self.stdout.write(
            f"{'Applied' if options['apply'] else 'Validated'} {len(rows)} paragraphs; {len(report['changes'])} changes. Report: {options['report']}"
        )
