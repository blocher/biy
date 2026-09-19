import os
from pathlib import Path
import httpx
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from openai import OpenAI
from study.importing import FEED_URL, parse_feed, catalog_entry, download_audio, transcribe, generate_study

class Command(BaseCommand):
    help = 'Import only episodes dated in 2025. Selection is mandatory; --day 1 is the acceptance test.'
    def add_arguments(self, parser):
        selection = parser.add_mutually_exclusive_group(required=True)
        selection.add_argument('--day',type=int)
        selection.add_argument('--guid')
        selection.add_argument('--all',action='store_true',help='Explicitly opt into the complete 2025 catalog, including extras.')
        parser.add_argument('--feed-file',type=Path,help='Use a previously downloaded publisher feed.')
        stage = parser.add_mutually_exclusive_group()
        stage.add_argument('--catalog-only',action='store_true')
        stage.add_argument('--download-only',action='store_true')
    def handle(self, **options):
        if options['feed_file']:
            xml = options['feed_file'].read_bytes()
        else:
            response = httpx.get(FEED_URL,timeout=120,follow_redirects=True)
            response.raise_for_status()
            xml = response.content
        rows = parse_feed(xml)
        if options['day'] is not None:
            rows = [row for row in rows if row['day']==options['day']]
        if options['guid']:
            rows = [row for row in rows if row['guid']==options['guid']]
        if not rows:
            raise CommandError('No matching 2025 episodes found.')
        if options['day'] is not None and len(rows)!=1:
            raise CommandError('Ambiguous day: expected exactly one 2025 episode.')
        self.stdout.write(f'Selected {len(rows)} episode(s), all published in 2025.')
        for row in rows:
            ep = catalog_entry(row)
            if options['catalog_only']:
                self.stdout.write(f'Cataloged: {ep.title}')
                continue
            # Session advisory lock prevents overlapping CLI runs from duplicating paid calls.
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_try_advisory_lock(2025, %s)',[ep.id])
                locked = cursor.fetchone()[0]
            if not locked:
                raise CommandError(f'Episode {ep.id} is being processed by another importer.')
            try:
                download_audio(ep)
                self.stdout.write(f'Audio ready: {ep.title}')
                if options['download_only'] or ep.status=='ready':
                    continue
                if not os.getenv('OPENAI_API_KEY'):
                    raise CommandError('Audio downloaded. Set OPENAI_API_KEY in the ignored .env, then rerun this same single-episode command. No AI requests were made.')
                client = OpenAI(timeout=180,max_retries=2)
                if not ep.transcript:
                    self.stdout.write('Transcribing (three-minute checkpoints)…')
                    transcribe(ep,client)
                self.stdout.write('Separating Scripture and generating study views…')
                generate_study(ep,client)
                self.stdout.write(f'Ready: {ep.title}')
            except Exception as exc:
                # Avoid persisting API error payloads or credentials. Checkpoints remain resumable.
                ep.status='failed'
                ep.error=f'{type(exc).__name__}: processing did not finish; rerun the selected episode.'
                ep.save(update_fields=['status','error'])
                if isinstance(exc,CommandError): raise
                raise CommandError(f'{type(exc).__name__}: episode {ep.id} failed. Check local configuration and resume; completed checkpoints were preserved.') from None
            finally:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_advisory_unlock(2025, %s)',[ep.id])
