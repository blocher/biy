import os

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from openai import OpenAI

from study.importing import format_transcripts
from study.models import Episode


class Command(BaseCommand):
    help = "AI-format source-faithful full and commentary-only episode transcripts."

    def add_arguments(self, parser):
        parser.add_argument("--edition", choices=["bible", "catechism"], default="bible")
        selection = parser.add_mutually_exclusive_group(required=True)
        selection.add_argument("--day", type=int)
        selection.add_argument("--guid")
        selection.add_argument("--all", action="store_true")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Regenerate formatting even when both formatted transcripts exist.",
        )

    def handle(self, **options):
        if not os.getenv("OPENAI_API_KEY"):
            raise CommandError("Set OPENAI_API_KEY before formatting transcripts.")
        try:
            timeout = float(os.getenv("OPENAI_IMPORT_TIMEOUT_SECONDS", "900"))
        except ValueError:
            raise CommandError("OPENAI_IMPORT_TIMEOUT_SECONDS must be a number of seconds.")
        if timeout < 600:
            raise CommandError("OPENAI_IMPORT_TIMEOUT_SECONDS must be at least 600 seconds.")

        episodes = (
            Episode.objects.filter(edition=options["edition"], transcript__isnull=False)
            .exclude(transcript=[])
            .exclude(classification=[])
        )
        if options["day"] is not None:
            day_field = "catechism_day_id" if options["edition"] == "catechism" else "day_id"
            episodes = episodes.filter(**{day_field: options["day"]})
        elif options["guid"]:
            episodes = episodes.filter(guid=options["guid"])
        if not options["force"]:
            episodes = episodes.filter(Q(formatted_transcript=[]) | Q(formatted_commentary=[]))

        selected = list(episodes.order_by("published_at", "id"))
        if not selected:
            raise CommandError("No matching classified transcripts need formatting.")
        client = OpenAI(timeout=timeout, max_retries=2)
        self.stdout.write(f"Selected {len(selected)} episode(s) for transcript formatting.")
        for episode in selected:
            format_transcripts(episode, client, force=options["force"])
            self.stdout.write(f"Formatted: {episode.title}")
