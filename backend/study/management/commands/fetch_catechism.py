"""Snapshot the structured public Ascension source without executing its scripts."""

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from django.core.management.base import BaseCommand, CommandError

from study.catechism_content import SOURCE_URL, extract_dataset, normalize_dataset, source_digest


class Command(BaseCommand):
    help = "Save a reproducible Ascension Catechism snapshot. No database or AI work."

    def add_arguments(self, parser):
        parser.add_argument("--output", type=Path, required=True)

    def handle(self, **options):
        output = options["output"]
        if output.exists():
            raise CommandError("Choose a new output path; source snapshots are immutable.")
        page_url = SOURCE_URL + "/one/2/2/4"
        with httpx.Client(timeout=90, follow_redirects=False) as client:
            response = client.get(page_url)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, "lxml")
            urls = list(
                dict.fromkeys(
                    urljoin(page_url, el["src"])
                    for el in soup.select("script[src]")
                    if el["src"].startswith("/_next/static/")
                )
            )
            for url in urls[:50]:
                response = client.get(url)
                response.raise_for_status()
                if len(response.content) > 60_000_000:
                    raise CommandError("Unexpected source bundle size.")
                try:
                    data = extract_dataset(response.text)
                except ValueError:
                    continue
                _, report = normalize_dataset(data)
                snapshot = {
                    "schema": 1,
                    "provenance": {
                        "source": "Ascension",
                        "source_url": SOURCE_URL,
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                        "bundle_url": url,
                        "sha256": source_digest(data),
                    },
                    "data": data,
                    "validation": report,
                }
                output.parent.mkdir(parents=True, exist_ok=True)
                with output.open("x") as stream:
                    json.dump(snapshot, stream, ensure_ascii=False, indent=2)
                self.stdout.write(
                    f"Saved {report['paragraphs']} paragraphs and {report['notes']} notes to {output}."
                )
                return
        raise CommandError(
            "The public page no longer exposes the expected dataset; nothing was saved."
        )
