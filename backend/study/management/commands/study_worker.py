import os
import signal
import socket
import threading

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from study.chat import process_chat
from study.models import StudyWorker
from study.search import embed_batch


class Command(BaseCommand):
    help = "Run the durable PostgreSQL chat/indexing worker (no Redis required)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once", action="store_true", help="Process one chat and one embedding batch."
        )

    def handle(self, once, **options):
        stopped = threading.Event()
        name = f"{socket.gethostname()}:{os.getpid()}"
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, lambda *_: stopped.set())
            signal.signal(signal.SIGINT, lambda *_: stopped.set())
        self.stdout.write("Study worker started: PostgreSQL queue, chat and embeddings.")
        try:
            while not stopped.is_set():
                close_old_connections()
                StudyWorker.objects.update_or_create(
                    name=name, defaults={"heartbeat_at": timezone.now()}
                )
                worked = process_chat()
                if not stopped.is_set():
                    worked = embed_batch() or worked
                StudyWorker.objects.update_or_create(
                    name=name, defaults={"heartbeat_at": timezone.now()}
                )
                if once:
                    break
                if not worked:
                    stopped.wait(2)
        finally:
            StudyWorker.objects.filter(name=name).delete()
