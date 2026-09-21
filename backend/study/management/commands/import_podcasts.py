import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections, connection
from openai import OpenAI

from study.importing import (
    FEED_URLS,
    catalog_entry,
    download_audio,
    generate_study,
    parse_feed,
    transcribe,
)
from study.models import Episode


class Command(BaseCommand):
    help = "Import a canonical 2025 podcast edition. Selection is mandatory."

    def add_arguments(self, parser):
        parser.add_argument("--edition", choices=["bible", "catechism"], default="bible")
        selection = parser.add_mutually_exclusive_group(required=True)
        selection.add_argument("--day", type=int)
        selection.add_argument("--guid")
        selection.add_argument(
            "--all",
            action="store_true",
            help="Explicitly opt into the complete 2025 catalog, including extras.",
        )
        parser.add_argument(
            "--feed-file", type=Path, help="Use a previously downloaded publisher feed."
        )
        stage = parser.add_mutually_exclusive_group()
        stage.add_argument("--catalog-only", action="store_true")
        stage.add_argument("--download-only", action="store_true")
        parser.add_argument(
            "--force-study",
            action="store_true",
            help="Regenerate study content while reusing existing audio and transcription.",
        )
        parser.add_argument(
            "--workers",
            type=int,
            default=1,
            help="Number of episodes to process concurrently (1-8; default: 1).",
        )

    def process_episode(self, episode_id, download_only, force_study):
        """Process one independently locked episode in a worker thread."""
        close_old_connections()
        ep = None
        locked = False
        try:
            ep = Episode.objects.get(pk=episode_id)
            # This lock is session-scoped, so acquisition and release must stay on this thread.
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(2025, %s)", [ep.id])
                locked = cursor.fetchone()[0]
            if not locked:
                raise CommandError(f"Episode {ep.id} is being processed by another importer.")
            download_audio(ep)
            if download_only or (ep.status == "ready" and not force_study):
                return f"Audio ready: {ep.title}"
            if not os.getenv("OPENAI_API_KEY"):
                raise CommandError(
                    "Audio downloaded. Set OPENAI_API_KEY in the ignored .env, then rerun this same single-episode command. No AI requests were made."
                )
            try:
                timeout = float(os.getenv("OPENAI_IMPORT_TIMEOUT_SECONDS", "900"))
            except ValueError:
                raise CommandError("OPENAI_IMPORT_TIMEOUT_SECONDS must be a number of seconds.")
            if timeout < 600:
                raise CommandError("OPENAI_IMPORT_TIMEOUT_SECONDS must be at least 600 seconds.")
            client = OpenAI(timeout=timeout, max_retries=2)
            if not ep.transcript:
                if force_study:
                    raise CommandError(
                        "--force-study requires an existing transcript; run the episode normally first."
                    )
                transcribe(ep, client)
            generate_study(ep, client, force_study=force_study)
            return f"Ready: {ep.title}"
        except Exception as exc:
            # Avoid persisting API error payloads or credentials. Checkpoints remain resumable.
            if ep is not None:
                ep.status = "failed"
                ep.error = (
                    f"{type(exc).__name__}: processing did not finish; rerun the selected episode."
                )
                ep.save(update_fields=["status", "error"])
            if isinstance(exc, CommandError):
                raise
            raise CommandError(
                f"{type(exc).__name__}: episode {episode_id} failed. Check local configuration and resume; completed checkpoints were preserved."
            ) from None
        finally:
            if locked:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(2025, %s)", [episode_id])
            close_old_connections()

    def handle(self, **options):
        if not 1 <= options["workers"] <= 8:
            raise CommandError("--workers must be between 1 and 8.")
        if options["force_study"] and (options["catalog_only"] or options["download_only"]):
            raise CommandError(
                "--force-study cannot be combined with a catalog/download-only stage."
            )
        if options["feed_file"]:
            xml = options["feed_file"].read_bytes()
        else:
            response = httpx.get(
                FEED_URLS[options["edition"]],
                timeout=120,
                follow_redirects=True,
                headers={"User-Agent": "BIY-CIY private study importer"},
            )
            response.raise_for_status()
            xml = response.content
        rows = parse_feed(xml, options["edition"])
        if options["day"] is not None:
            rows = [row for row in rows if row["day"] == options["day"]]
        if options["guid"]:
            rows = [row for row in rows if row["guid"] == options["guid"]]
        if not rows:
            raise CommandError("No matching 2025 episodes found.")
        if options["day"] is not None and len(rows) != 1:
            raise CommandError("Ambiguous day: expected exactly one 2025 episode.")
        self.stdout.write(f"Selected {len(rows)} episode(s), all published in 2025.")
        episodes = [catalog_entry(row, options["edition"]) for row in rows]
        if options["catalog_only"]:
            for ep in episodes:
                self.stdout.write(f"Cataloged: {ep.title}")
            return

        if options["workers"] > 1:
            self.stdout.write(f"Processing with {options['workers']} concurrent episode workers.")
        failures = []
        with ThreadPoolExecutor(max_workers=options["workers"]) as executor:
            futures = {
                executor.submit(
                    self.process_episode,
                    ep.id,
                    options["download_only"],
                    options["force_study"],
                ): ep
                for ep in episodes
            }
            for future in as_completed(futures):
                try:
                    self.stdout.write(future.result())
                except CommandError as exc:
                    failures.append(str(exc))
        if failures:
            raise CommandError(
                f"{len(failures)} episode(s) did not finish; completed checkpoints were preserved. First failure: {failures[0]}"
            )
