import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from study.models import Day, Era


class Command(BaseCommand):
    help = "Idempotently seed all 365 reading-plan days without importing any podcasts."

    @transaction.atomic
    def handle(self, **options):
        rows = json.loads((Path(__file__).parents[2] / "reading_plan.json").read_text())
        eras = {}
        for row in rows:
            name = row["era"]
            if name not in eras:
                eras[name], _ = Era.objects.update_or_create(
                    name=name, defaults={"color": row["color"], "order": len(eras)}
                )
            Day.objects.update_or_create(
                number=row["number"], defaults={"era": eras[name], "readings": row["readings"]}
            )
        self.stdout.write(f"Seeded {len(rows)} days. No podcast imports performed.")
