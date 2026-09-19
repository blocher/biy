import json
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from study.models import Episode


class Command(BaseCommand):
    help = "Review Scripture-removal labels and AI provenance without making API calls."

    def add_arguments(self, parser):
        parser.add_argument("--day", type=int, default=1)
        parser.add_argument("--episode", type=int)
        parser.add_argument("--output", type=Path)

    def handle(self, day, episode, output, **options):
        ep = (
            Episode.objects.filter(pk=episode).first()
            if episode
            else Episode.objects.filter(day_id=day).first()
        )
        if not ep:
            raise CommandError("Episode not imported.")
        self.stdout.write(f"{ep.title}: {ep.status}; {len(ep.transcript)} transcript segments")
        self.stdout.write(json.dumps(Counter(x["kind"] for x in ep.classification), indent=2))
        if output:
            labels = {x["id"]: x for x in ep.classification}
            data = {
                "title": ep.title,
                "provenance": ep.provenance,
                "segments": [{**s, "classification": labels.get(s["id"])} for s in ep.transcript],
                "summary": ep.summary,
                "edited_commentary": ep.edited_commentary,
                "outline": ep.outline,
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(data, ensure_ascii=False, indent=2))
            output.chmod(0o600)
            self.stdout.write(f"Wrote review file: {output}")
