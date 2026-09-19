from django.conf import settings
from django.db import models


class Era(models.Model):
    name = models.CharField(max_length=80, unique=True)
    color = models.CharField(max_length=7)
    order = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["order"]


class Day(models.Model):
    number = models.PositiveSmallIntegerField(primary_key=True)
    era = models.ForeignKey(Era, on_delete=models.PROTECT)
    readings = models.JSONField(default=list)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(number__gte=1, number__lte=365), name="day_1_to_365"
            )
        ]


class Episode(models.Model):
    guid = models.CharField(max_length=512, unique=True)
    day = models.OneToOneField(
        Day, null=True, blank=True, on_delete=models.PROTECT, related_name="episode"
    )
    era = models.ForeignKey(Era, null=True, blank=True, on_delete=models.PROTECT)
    title = models.CharField(max_length=500)
    published_at = models.DateTimeField()
    source_date = models.DateField()  # Publisher's date before timezone normalization.
    audio_url = models.URLField(max_length=2000)
    source_url = models.URLField(max_length=2000, blank=True)
    description = models.TextField(blank=True)
    duration = models.FloatField(default=0)
    audio_file = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=24, default="pending")
    error = models.TextField(blank=True)
    transcript = models.JSONField(default=list)
    classification = models.JSONField(default=list)
    edited_commentary = models.JSONField(default=list)
    summary = models.TextField(blank=True)
    outline = models.JSONField(default=list)
    provenance = models.JSONField(default=dict)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["published_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(source_date__gte="2025-01-01", source_date__lt="2026-01-01"),
                name="episode_published_in_2025",
            )
        ]


class Verse(models.Model):
    book = models.CharField(max_length=40)
    chapter = models.PositiveSmallIntegerField()
    number = models.PositiveSmallIntegerField()
    text = models.TextField()
    paragraph = models.BooleanField(default=False)

    class Meta:
        ordering = ["chapter", "number"]
        constraints = [
            models.UniqueConstraint(fields=["book", "chapter", "number"], name="unique_verse")
        ]


class DayProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    day = models.ForeignKey(Day, on_delete=models.CASCADE)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "day"], name="unique_day_progress")]


class EpisodeProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE)
    completed_at = models.DateTimeField(null=True, blank=True)
    position = models.FloatField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="unique_episode_progress")
        ]


class Note(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    day = models.ForeignKey(Day, null=True, blank=True, on_delete=models.CASCADE)
    episode = models.ForeignKey(Episode, null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=12, choices=[("note", "Note"), ("journal", "Journal")])
    body = models.TextField()
    audio_time = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(day__isnull=False, episode__isnull=True)
                    | models.Q(day__isnull=True, episode__isnull=False)
                ),
                name="note_exactly_one_target",
            )
        ]


class LoginAttempt(models.Model):
    address = models.GenericIPAddressField()
    attempted_at = models.DateTimeField(auto_now_add=True, db_index=True)
