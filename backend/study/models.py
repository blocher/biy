from datetime import time

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector
from django.db import models
from django.utils import timezone
from pgvector.django import VectorField

EDITION_CHOICES = [("bible", "Bible in a Year"), ("catechism", "Catechism in a Year")]

STUDY_SEARCH_VECTOR = SearchVector("title", weight="A", config="english") + SearchVector(
    "text", weight="B", config="english"
)


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


class CatechismDay(models.Model):
    number = models.PositiveSmallIntegerField(primary_key=True)
    part = models.CharField(max_length=120)
    section = models.CharField(max_length=120, blank=True)
    chapter = models.CharField(max_length=120, blank=True)
    paragraph_start = models.PositiveSmallIntegerField(null=True, blank=True)
    paragraph_end = models.PositiveSmallIntegerField(null=True, blank=True)
    color = models.CharField(max_length=7)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(number__gte=1, number__lte=365),
                name="catechism_day_1_to_365",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(paragraph_start__isnull=True, paragraph_end__isnull=True)
                    | models.Q(paragraph_start__isnull=False, paragraph_end__isnull=False)
                ),
                name="catechism_day_complete_paragraph_range",
            ),
        ]

    @property
    def readings(self):
        if self.paragraph_start is None:
            return []
        return [f"CCC {self.paragraph_start}-{self.paragraph_end}"]


class CatechismParagraph(models.Model):
    number = models.PositiveSmallIntegerField(primary_key=True)
    text = models.TextField()
    source_url = models.URLField(max_length=2000)

    class Meta:
        ordering = ["number"]


class Episode(models.Model):
    edition = models.CharField(max_length=16, choices=EDITION_CHOICES, default="bible")
    guid = models.CharField(max_length=512, unique=True)
    day = models.OneToOneField(
        Day, null=True, blank=True, on_delete=models.PROTECT, related_name="episode"
    )
    catechism_day = models.OneToOneField(
        CatechismDay,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="episode",
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
    formatted_transcript = models.JSONField(default=list)
    classification = models.JSONField(default=list)
    formatted_commentary = models.JSONField(default=list)
    edited_commentary = models.JSONField(default=list)
    summary = models.TextField(blank=True)
    key_points = models.JSONField(default=list)
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


class CommentaryAuthor(models.Model):
    name = models.CharField(max_length=200, unique=True)
    default_year = models.IntegerField()
    wiki_url = models.URLField(max_length=2000, blank=True)
    category = models.CharField(max_length=80)
    condemned_by_council = models.BooleanField(default=False)

    class Meta:
        ordering = ["default_year", "name"]


class Commentary(models.Model):
    external_id = models.CharField(max_length=36, unique=True)
    author = models.ForeignKey(
        CommentaryAuthor, on_delete=models.PROTECT, related_name="commentaries"
    )
    file_name = models.CharField(max_length=500)
    append_to_author_name = models.CharField(max_length=500, blank=True)
    year = models.IntegerField(db_index=True)
    book_key = models.CharField(max_length=40, db_index=True)
    location_start = models.PositiveIntegerField()
    location_end = models.PositiveIntegerField()
    text = models.TextField()
    source_url = models.URLField(max_length=2000, blank=True)
    source_title = models.CharField(max_length=1000)

    class Meta:
        ordering = ["year", "id"]
        indexes = [
            models.Index(
                fields=["book_key", "location_start", "location_end"],
                name="commentary_passage_idx",
            ),
        ]


class DayProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    day = models.ForeignKey(Day, on_delete=models.CASCADE)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "day"], name="unique_day_progress")]


class CatechismDayProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    day = models.ForeignKey(CatechismDay, on_delete=models.CASCADE)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "day"], name="unique_catechism_day_progress")
        ]


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
    catechism_day = models.ForeignKey(CatechismDay, null=True, blank=True, on_delete=models.CASCADE)
    episode = models.ForeignKey(Episode, null=True, blank=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=12, choices=[("note", "Note"), ("journal", "Journal")])
    body = models.TextField()
    quote = models.TextField(blank=True)
    citation = models.CharField(max_length=500, blank=True)
    source_url = models.CharField(max_length=1000, blank=True)
    shared = models.BooleanField(default=False)
    shared_notified_at = models.DateTimeField(null=True, blank=True)
    audio_time = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        day__isnull=False,
                        catechism_day__isnull=True,
                        episode__isnull=True,
                    )
                    | models.Q(
                        day__isnull=True,
                        catechism_day__isnull=False,
                        episode__isnull=True,
                    )
                    | models.Q(
                        day__isnull=True,
                        catechism_day__isnull=True,
                        episode__isnull=False,
                    )
                ),
                name="note_exactly_one_target",
            )
        ]


class LoginAttempt(models.Model):
    address = models.GenericIPAddressField()
    attempted_at = models.DateTimeField(auto_now_add=True, db_index=True)


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    leaderboard_visible = models.BooleanField(default=True)
    bible_enabled = models.BooleanField(default=True)
    catechism_enabled = models.BooleanField(default=True)
    email_notifications = models.BooleanField(default=True)
    progress_basis = models.CharField(
        max_length=24,
        default="first-completion",
        choices=[
            ("first-completion", "Personal start dates"),
            ("leaderboard", "Leaderboard start date"),
            ("january-1", "January 1"),
        ],
    )
    catechism_progress_basis = models.CharField(
        max_length=24,
        default="first-completion",
        choices=[
            ("first-completion", "Personal start dates"),
            ("leaderboard", "Leaderboard start date"),
            ("january-1", "January 1"),
        ],
    )
    notification_timezone = models.CharField(max_length=64, default="America/New_York")
    reminder_condition = models.CharField(
        max_length=16,
        default="incomplete",
        choices=[
            ("incomplete", "Only when today’s reading is incomplete"),
            ("always", "Always"),
            ("never", "Never"),
        ],
    )
    morning_reminder_enabled = models.BooleanField(default=True)
    morning_reminder_time = models.TimeField(default=time(8))
    evening_reminder_enabled = models.BooleanField(default=True)
    evening_reminder_time = models.TimeField(default=time(20))
    shared_push_notifications = models.BooleanField(default=True)
    notification_setup_completed = models.BooleanField(default=False)


class PushSubscription(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="push_subscriptions", on_delete=models.CASCADE
    )
    endpoint = models.TextField(unique=True)
    p256dh = models.TextField()
    auth = models.TextField()
    device_name = models.CharField(max_length=120, default="Browser")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_seen_at = models.DateTimeField(default=timezone.now)


class PushDelivery(models.Model):
    subscription = models.ForeignKey(
        PushSubscription, related_name="deliveries", on_delete=models.CASCADE
    )
    kind = models.CharField(max_length=24)
    dedupe_key = models.CharField(max_length=160)
    payload = models.JSONField(default=dict)
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["subscription", "kind", "dedupe_key"],
                name="unique_push_delivery",
            )
        ]


class CommunitySettings(models.Model):
    """One shared schedule for the small trusted group."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    start_date = models.DateField()
    catechism_start_date = models.DateField(null=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="single_community_settings")
        ]


class SearchChunk(models.Model):
    """Current source excerpts; the rows themselves form the durable embedding queue."""

    key = models.CharField(max_length=180, unique=True)
    kind = models.CharField(max_length=20)
    source = models.CharField(max_length=120, db_index=True)
    note = models.ForeignKey(Note, null=True, on_delete=models.CASCADE)
    episode = models.ForeignKey(Episode, null=True, on_delete=models.CASCADE)
    title = models.CharField(max_length=600)
    text = models.TextField()
    metadata = models.JSONField(default=dict)
    digest = models.CharField(max_length=64)
    # Exact vector search is sufficient for this small corpus and preserves filtered recall.
    embedding = VectorField(dimensions=1536, null=True)
    embedding_model = models.CharField(max_length=100, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now)
    leased_until = models.DateTimeField(null=True)
    error = models.CharField(max_length=100, blank=True)

    class Meta:
        indexes = [GinIndex(STUDY_SEARCH_VECTOR, name="study_chunk_fts_gin")]


class StudyConversation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    edition = models.CharField(max_length=16, choices=EDITION_CHOICES, default="bible")
    day = models.ForeignKey(Day, null=True, on_delete=models.CASCADE)
    catechism_day = models.ForeignKey(CatechismDay, null=True, on_delete=models.CASCADE)
    episode = models.ForeignKey(Episode, null=True, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)


class StudyTurn(models.Model):
    conversation = models.ForeignKey(
        StudyConversation, related_name="turns", on_delete=models.CASCADE
    )
    request_id = models.UUIDField(unique=True)
    question = models.TextField()
    external_query = models.CharField(max_length=500, blank=True)
    web_enabled = models.BooleanField(default=True)
    status = models.CharField(max_length=16, default="queued", db_index=True)
    answer = models.TextField(blank=True)
    follow_ups = models.JSONField(default=list, blank=True)
    links = models.JSONField(default=list, blank=True)
    sources = models.JSONField(default=list)
    notices = models.JSONField(default=list)
    stage = models.CharField(max_length=120, default="Waiting for the study worker")
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)


class StudyWorker(models.Model):
    name = models.CharField(max_length=120, primary_key=True)
    heartbeat_at = models.DateTimeField()
