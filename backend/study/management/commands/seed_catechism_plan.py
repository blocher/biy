import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from study.models import CatechismDay


class Command(BaseCommand):
    help = "Idempotently seed all 365 Catechism reading-plan days."

    @transaction.atomic
    def handle(self, **options):
        rows = json.loads((Path(__file__).parents[2] / "catechism_reading_plan.json").read_text())
        for row in rows:
            number = row.pop("number")
            CatechismDay.objects.update_or_create(number=number, defaults=row)
        self.stdout.write(f"Seeded {len(rows)} Catechism days. No podcast imports performed.")
