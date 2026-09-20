from django.apps import AppConfig
from django.db.models.signals import post_save


class StudyConfig(AppConfig):
    name = "study"

    def ready(self):
        from .models import Day, Episode, Note
        from django.db.models import Q
        from .search import index_episode, index_note

        def note_saved(sender, instance, raw=False, update_fields=None, **kwargs):
            if not raw and update_fields != frozenset({"shared_notified_at"}):
                index_note(instance)

        def episode_saved(sender, instance, raw=False, **kwargs):
            if not raw:
                index_episode(instance)
                for note in Note.objects.filter(episode=instance).select_related(
                    "user", "episode__day"
                ):
                    index_note(note)

        def day_saved(sender, instance, raw=False, **kwargs):
            if not raw:
                for note in Note.objects.filter(
                    Q(day=instance) | Q(episode__day=instance)
                ).select_related("user", "day", "episode__day"):
                    index_note(note)

        post_save.connect(
            day_saved, sender=Day, weak=False, dispatch_uid="study.day_search"
        )

        post_save.connect(
            note_saved, sender=Note, weak=False, dispatch_uid="study.note_search"
        )
        post_save.connect(
            episode_saved,
            sender=Episode,
            weak=False,
            dispatch_uid="study.episode_search",
        )
