import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from study.models import Day, Note


class Command(BaseCommand):
    help = (
        "Show (and with --apply, fix) days whose stored readings differ from "
        "reading_plan.json. Reading progress and notes are untouched."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write the corrected readings.")
        parser.add_argument(
            "--backup", help="With --apply: write the replaced readings to this JSON file first."
        )
        parser.add_argument(
            "--reindex-notes",
            action="store_true",
            help="With --apply: refresh search excerpts for notes on changed days (queues embeddings).",
        )

    def handle(self, apply, backup, reindex_notes, **options):
        rows = json.loads((Path(__file__).parents[2] / "reading_plan.json").read_text())
        wanted = {row["number"]: row["readings"] for row in rows}
        days = Day.objects.in_bulk(wanted.keys())
        if missing := sorted(set(wanted) - set(days)):
            raise CommandError(f"Days missing from the database (run seed_plan): {missing}")

        changes = {
            n: (days[n].readings, wanted[n])
            for n in sorted(wanted)
            if days[n].readings != wanted[n]
        }
        for n, (old, new) in changes.items():
            self.stdout.write(f"Day {n}: {' · '.join(old)}\n     -> {' · '.join(new)}")
        if not changes:
            self.stdout.write("All days already match reading_plan.json.")
            return
        if not apply:
            self.stdout.write(f"{len(changes)} days differ. Dry run; rerun with --apply to write.")
            return

        if backup:
            Path(backup).write_text(
                json.dumps({n: old for n, (old, _) in changes.items()}, indent=2)
            )
            self.stdout.write(f"Backed up previous readings to {backup}")
        with transaction.atomic():
            for n, (_, new) in changes.items():
                Day.objects.filter(pk=n).update(readings=new)
        self.stdout.write(f"Updated {len(changes)} days.")

        notes = Note.objects.filter(day_id__in=changes).select_related("user", "day", "episode")
        if reindex_notes:
            from study.search import index_note

            for note in notes:
                index_note(note)
            self.stdout.write(f"Reindexed {len(notes)} notes on changed days.")
        elif notes.exists():
            self.stdout.write(
                f"{notes.count()} notes on changed days still show the old readings in search; "
                "rerun with --reindex-notes or run index_study to refresh them."
            )
