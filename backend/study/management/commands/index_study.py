from django.core.management.base import BaseCommand
from django.utils import timezone

from study.models import Episode, Note, SearchChunk, Verse
from study.search import index_catechism, index_chapter, index_episode, index_note


class Command(BaseCommand):
    help = "Reconcile local searchable excerpts and queue changed embeddings. Makes no AI calls."

    def add_arguments(self, parser):
        parser.add_argument("--retry-failed", action="store_true")

    def handle(self, retry_failed, **options):
        for book, chapter in (
            Verse.objects.order_by("book", "chapter")
            .values_list("book", "chapter")
            .distinct()
            .iterator()
        ):
            index_chapter(book, chapter)
        index_catechism()
        for episode in Episode.objects.iterator():
            index_episode(episode)
        for note in Note.objects.select_related("user").iterator():
            index_note(note)
        if retry_failed:
            SearchChunk.objects.filter(attempts__gt=0).update(
                attempts=0, available_at=timezone.now(), leased_until=None, error=""
            )
        self.stdout.write(f"Reconciled {SearchChunk.objects.count()} source excerpts.")
