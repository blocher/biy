import json
from datetime import datetime
from datetime import timezone as dt_timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings

from .importing import _dedupe_transcript_segments, catalog_entry, parse_feed
from .models import Day, Episode, Era, SearchChunk, Verse
from .scripture import reading_text, reference_ranges


def item(title, date, guid="one"):
    return f'<item><title>{title}</title><guid>{guid}</guid><pubDate>{date}</pubDate><enclosure url="https://example.org/audio.mp3"/></item>'


class FeedTests(TestCase):
    def test_uses_original_calendar_date_not_title_or_utc(self):
        feed = (
            "<rss><channel>"
            + "".join(
                [
                    item("Day 1: Begin (2024)", "Wed, 01 Jan 2025 00:05:00 +1400", "a"),
                    item("BONUS: Prepare for 2026", "Wed, 31 Dec 2025 23:55:00 -1200", "b"),
                    item("Day 1: Begin (2025)", "Tue, 31 Dec 2024 23:55:00 -1200", "c"),
                    item("Day 1: Begin (2025)", "Thu, 01 Jan 2026 00:05:00 +1400", "d"),
                    item(" Day 148: Wealth (2025)", "Wed, 28 May 2025 03:15:00 -0400", "e"),
                ]
            )
            + "</channel></rss>"
        )
        rows = parse_feed(feed)
        self.assertEqual({r["guid"] for r in rows}, {"a", "b", "e"})
        self.assertEqual(next(r for r in rows if r["guid"] == "e")["day"], 148)
        self.assertIsNone(next(r for r in rows if r["guid"] == "b")["day"])

    def test_duplicate_day_prefers_the_entry_on_its_plan_date(self):
        feed = (
            "<rss><channel>"
            + item("Day 324: The Name of Jesus (2025)", "Mon, 20 Oct 2025 03:15:00 -0400", "wrong")
            + item("Day 324: The Name of Jesus (2025)", "Thu, 20 Nov 2025 03:15:00 -0500", "correct")
            + "</channel></rss>"
        )

        rows = parse_feed(feed)

        self.assertEqual([row["guid"] for row in rows], ["correct"])

    def test_catalog_refresh_preserves_supplement_launch_order(self):
        supplements = [
            (
                "f9086903-d1d0-4655-9ed5-d4707df1b966",
                "Bringing the Bible Back to Catholics",
                datetime(2025, 12, 19, 8, 15, tzinfo=dt_timezone.utc),
            ),
            (
                "fdc979e0-1a40-443a-8eac-3c97e02f4f56",
                "How to Hear God's Voice in Scripture",
                datetime(2025, 12, 26, 8, 15, tzinfo=dt_timezone.utc),
            ),
            (
                "1f2c7d37-4db7-4d40-953e-5988b5692e0f",
                "Preparing for the Bible in a Year Journey",
                datetime(2025, 12, 22, 8, 15, tzinfo=dt_timezone.utc),
            ),
        ]
        for guid, title, published_at in supplements:
            row = {
                "guid": guid,
                "day": None,
                "title": title,
                "published_at": published_at,
                "source_date": published_at.date(),
                "audio_url": "https://example.org/audio.mp3",
                "source_url": "",
                "description": "",
                "duration": 60,
            }
            catalog_entry(row)
            catalog_entry(row)

        ordered = list(
            Episode.objects.order_by("published_at").values_list(
                "title", "published_at", "source_date"
            )
        )
        self.assertEqual(
            [title for title, _, _ in ordered],
            [
                "Bringing the Bible Back to Catholics",
                "How to Hear God's Voice in Scripture",
                "Preparing for the Bible in a Year Journey",
            ],
        )
        self.assertEqual([published.year for _, published, _ in ordered], [2024, 2024, 2024])
        self.assertEqual([source.year for _, _, source in ordered], [2025, 2025, 2025])


class TranscriptionTests(TestCase):
    def test_dedupes_identical_segments_from_overlap_window(self):
        segments = [
            {"start": 898.4, "end": 901.2, "speaker": "Voice A · part 1", "text": "In the beginning."},
            {"start": 898.8, "end": 901.5, "speaker": "Voice A · part 2", "text": " in the beginning. "},
            {"start": 902.0, "end": 904.0, "speaker": "Voice A · part 2", "text": "God created."},
        ]

        result = _dedupe_transcript_segments(segments)

        self.assertEqual([segment["text"] for segment in result], ["In the beginning.", "God created."])
        self.assertEqual(result[0]["end"], 901.5)
        self.assertEqual([segment["id"] for segment in result], [0, 1])

    def test_day_plan_exact_and_idempotent(self):
        call_command("seed_plan", verbosity=0)
        call_command("seed_plan", verbosity=0)
        self.assertEqual(Day.objects.count(), 365)
        self.assertEqual(Day.objects.get(pk=1).readings, ["Genesis 1-2", "Psalm 19"])
        self.assertEqual(Day.objects.get(pk=1).era.color, "#64b6bd")
        self.assertEqual(Day.objects.get(pk=275).readings[1], "Esther 3, 13")
        self.assertEqual(Day.objects.get(pk=321).readings[0], "Luke 22:39-24")


class ScriptureTests(TestCase):
    def test_import_restores_missing_sentence_space_in_source(self):
        with TemporaryDirectory() as directory:
            Path(directory, "01_gen_text_5.html").write_text(
                '<verse id="v01005001"><verse_body><ver>1</ver>'
                'This is the book of the generations of Adam.When God created man, '
                'he made him in the likeness of God.</verse_body></verse>'
            )
            call_command("import_bible", source=directory)
        self.assertIn(
            "Adam. When God",
            Verse.objects.get(book="Genesis", chapter=5, number=1).text,
        )

    def test_import_preserves_punctuation_next_to_inline_markup(self):
        with TemporaryDirectory() as directory:
            Path(directory, "01_gen_text_1.html").write_text(
                '<verse id="v01001003"><verse_body><ver>3</ver>'
                'And <a class="cnote">God said</a>, "Let there be light";'
                ' he saw the <a class="cnote">year</a>,'
                ' and it was <a class="cnote">good</a>.'
                '</verse_body></verse>'
            )
            call_command("import_bible", source=directory)
        self.assertEqual(
            Verse.objects.get(book="Genesis", chapter=1, number=3).text,
            'And God said, "Let there be light"; he saw the year, and it was good.',
        )

    def test_complex_references(self):
        self.assertEqual(list(reference_ranges("Luke 20-22:38")), [("Luke", 20, 1, 22, 38)])
        self.assertEqual(list(reference_ranges("Luke 22:39-24")), [("Luke", 22, 39, 24, 999)])
        self.assertEqual(list(reference_ranges("Proverbs 1:1-7")), [("Proverbs", 1, 1, 1, 7)])
        self.assertEqual(
            list(reference_ranges("Esther 15, 6-7")),
            [("Esther", 15, 1, 15, 999), ("Esther", 6, 1, 7, 999)],
        )
        self.assertEqual(
            list(reference_ranges("2 John, 3 John")),
            [("2 John", 1, 1, 1, 999), ("3 John", 1, 1, 1, 999)],
        )
        self.assertEqual(list(reference_ranges("Jude")), [("Jude", 1, 1, 1, 999)])

    def test_source_book_order_and_note_removal(self):
        with TemporaryDirectory() as directory:
            Path(directory, "21_psa_text_19.html").write_text(
                '<verse id="v21019001"><verse_body><ver>1</ver>The <a class="cnote">heavens</a><a class="enote"><sup>a</sup></a> proclaim.</verse_body></verse>'
            )
            Path(directory, "45_1ma_text_1.html").write_text(
                '<verse id="v45001001"><verse_body><ver>1</ver>Test Maccabees</verse_body></verse>'
            )
            call_command("import_bible", source=directory)
        self.assertEqual(Verse.objects.get(book="Psalm").text, "The heavens proclaim.")
        self.assertEqual(Verse.objects.get(book="1 Maccabees").text, "Test Maccabees")
        self.assertFalse(reading_text("Psalm 19")["groups"][0]["missing"])

    def test_poetic_hang_lines_are_preserved(self):
        with TemporaryDirectory() as directory:
            Path(directory, "21_psa_text_19.html").write_text(
                '<verse id="v21019001"><verse_body><ver>1</ver>'
                "The heavens are telling the glory of God;\n"
                '\t\t\t<p class="hang2"><verse_body>and the firmament proclaims his handiwork.</verse_body></p>'
                "</verse_body></verse>"
                '<verse id="v21019002"><verse_body><ver>2</ver>'
                "Day to day pours forth speech,"
                '<p class="hang2"><verse_body>and night to night declares knowledge.</verse_body></p>'
                "</verse_body></verse>"
            )
            call_command("import_bible", source=directory)
        self.assertEqual(
            Verse.objects.get(book="Psalm", chapter=19, number=1).text,
            "The heavens are telling the glory of God;\nand the firmament proclaims his handiwork.",
        )
        self.assertEqual(
            Verse.objects.get(book="Psalm", chapter=19, number=2).text,
            "Day to day pours forth speech,\nand night to night declares knowledge.",
        )


class APITests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.ben = User.objects.create_user("ben", password="test-long-password")
        self.other = User.objects.create_user("other", password="other-long-password")
        self.era = Era.objects.create(name="Early World", color="#64b6bd", order=1)
        self.day = Day.objects.create(number=1, era=self.era, readings=["Genesis 1"])
        self.episode = Episode.objects.create(
            guid="daily",
            day=self.day,
            era=self.era,
            title="Day 1",
            published_at=datetime(2025, 1, 1, tzinfo=dt_timezone.utc),
            source_date="2025-01-01",
            audio_url="https://example.org/day.mp3",
        )
        self.extra = Episode.objects.create(
            guid="extra",
            era=self.era,
            title="Introduction",
            published_at=datetime(2025, 1, 1, tzinfo=dt_timezone.utc),
            source_date="2025-01-01",
            audio_url="https://example.org/extra.mp3",
        )
        self.client.force_login(self.ben)

    def put(self, url, payload):
        return self.client.put(url, data=json.dumps(payload), content_type="application/json")

    def test_completion_timestamp_is_idempotent_and_user_scoped(self):
        url = "/api/days/1/completion"
        first = self.put(url, {"completed": True}).json()["completed_at"]
        self.assertEqual(self.put(url, {"completed": True}).json()["completed_at"], first)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get("/api/library").json()["completed"], 0)
        self.client.force_login(self.ben)
        self.assertEqual(self.client.get("/api/library").json()["completed"], 1)
        self.assertIsNone(self.put(url, {"completed": False}).json()["completed_at"])

    def test_extra_completion_does_not_inflate_day_progress(self):
        self.assertEqual(
            self.put(f"/api/episodes/{self.extra.id}/completion", {"completed": True}).status_code,
            200,
        )
        data = self.client.get("/api/library").json()
        self.assertEqual(data["completed"], 0)
        self.assertIsNotNone(data["extras"][0]["completed_at"])

    def test_day_detail_exposes_aligned_scripture_audio(self):
        Verse.objects.create(
            book="Genesis",
            chapter=1,
            number=1,
            text="In the beginning God created the heavens and the earth.",
        )
        self.episode.audio_file = "episodes/day-1/audio.mp3"
        self.episode.transcript = [
            {
                "id": 1,
                "start": 12.5,
                "end": 17.25,
                "speaker": "Voice A",
                "text": "In the beginning God created the heavens and the earth.",
            }
        ]
        self.episode.classification = [
            {"id": 1, "kind": "scripture", "commentary_text": None}
        ]
        self.episode.save(
            update_fields=["audio_file", "transcript", "classification"]
        )

        scripture = self.client.get("/api/days/1").json()["scripture"]

        self.assertEqual(
            scripture[0]["audio"],
            {
                "passage_index": 0,
                "reference": "Genesis 1",
                "start": 12.5,
                "end": 17.25,
                "confidence": 1.0,
            },
        )

    def test_episode_detail_prefers_word_faithful_formatted_transcripts(self):
        self.episode.transcript = [
            {"id": 1, "start": 0, "end": 3, "speaker": "Voice A", "text": "hello there"}
        ]
        self.episode.classification = [
            {"id": 1, "kind": "commentary", "commentary_text": None}
        ]
        formatted = [
            {
                "id": 1,
                "start": 0,
                "end": 3,
                "speaker": "Voice A",
                "text": "Hello there.",
                "paragraph_break_before": True,
            }
        ]
        self.episode.formatted_transcript = formatted
        self.episode.formatted_commentary = formatted
        self.episode.save()

        episode = self.client.get("/api/days/1").json()["episode"]

        self.assertEqual(episode["transcript"], formatted)
        self.assertEqual(episode["commentary"], formatted)

    def test_completion_date_can_be_overridden_after_completion(self):
        self.assertEqual(
            self.put("/api/days/1/completed-at", {"completed_on": "2025-01-02"}).status_code,
            400,
        )
        self.put("/api/days/1/completion", {"completed": True})
        response = self.put(
            "/api/days/1/completed-at", {"completed_on": "2025-01-02"}
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["completed_at"].startswith("2025-01-02"))

        self.put(f"/api/episodes/{self.extra.id}/completion", {"completed": True})
        response = self.put(
            f"/api/episodes/{self.extra.id}/completed-at",
            {"completed_on": "2025-01-03"},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["completed_at"].startswith("2025-01-03"))

    def test_notes_are_private_and_daily_episode_notes_use_day(self):
        response = self.client.post(
            f"/api/episodes/{self.episode.id}/notes",
            data=json.dumps({"body": "Private journal", "kind": "journal"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        note = response.json()
        self.assertEqual(note["day"], 1)
        self.assertEqual(len(self.client.get("/api/days/1/notes").json()), 1)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get("/api/days/1/notes").json(), [])
        self.assertEqual(self.put(f"/api/notes/{note['id']}", {"body": "steal"}).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/notes/{note['id']}").status_code, 404)

    def test_note_can_link_a_quote_to_an_internal_reading_section(self):
        response = self.client.post(
            "/api/days/1/notes",
            data=json.dumps(
                {
                    "body": "The light is active, not abstract.",
                    "quote": "The light shines in the darkness.",
                    "citation": "John 1:5",
                    "source_url": "/day/1/reader?tab=scripture#verse-john-1-5",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        note = response.json()
        self.assertEqual(note["quote"], "The light shines in the darkness.")
        self.assertEqual(note["citation"], "John 1:5")
        self.assertEqual(
            note["source_url"],
            "/day/1/reader?tab=scripture#verse-john-1-5",
        )
        indexed = SearchChunk.objects.get(note_id=note["id"])
        self.assertIn(note["quote"], indexed.text)
        self.assertEqual(indexed.metadata["citation"], "John 1:5")
        self.assertEqual(indexed.metadata["url"], note["source_url"])

        response = self.put(
            f"/api/notes/{note['id']}",
            {
                "body": "Updated",
                "quote": note["quote"],
                "citation": note["citation"],
                "source_url": "https://example.com/not-local",
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_auth_and_csrf_required(self):
        c = Client(enforce_csrf_checks=True)
        self.assertEqual(c.get("/api/library").status_code, 401)
        self.assertEqual(
            c.post(
                "/api/login",
                data=json.dumps({"username": "ben", "password": "test-long-password"}),
                content_type="application/json",
            ).status_code,
            403,
        )
        c.force_login(self.ben)
        self.assertEqual(
            c.put(
                "/api/days/1/completion",
                data=json.dumps({"completed": True}),
                content_type="application/json",
            ).status_code,
            403,
        )
        token = c.get("/api/session").json()["csrf"]
        self.assertEqual(
            c.put(
                "/api/days/1/completion",
                data=json.dumps({"completed": True}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=token,
            ).status_code,
            200,
        )

    def test_login_with_csrf(self):
        c = Client(enforce_csrf_checks=True)
        token = c.get("/api/session").json()["csrf"]
        response = c.post(
            "/api/login",
            data=json.dumps({"username": "ben", "password": "test-long-password"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(c.get("/api/library").status_code, 200)

    def test_account_details_and_password_can_be_updated(self):
        response = self.put(
            "/api/account",
            {
                "username": "benjamin",
                "first_name": "Benjamin",
                "last_name": "Locher",
                "email": "benjamin@example.com",
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["username"], "benjamin")
        self.assertEqual(response.json()["email"], "benjamin@example.com")
        self.assertEqual(
            self.put(
                "/api/account/password",
                {"new_password": "a-new-long-password"},
            ).status_code,
            200,
        )
        self.client.logout()
        self.assertTrue(self.client.login(username="benjamin", password="a-new-long-password"))

    def test_account_rejects_duplicate_username(self):
        self.assertEqual(
            self.put(
                "/api/account",
                {"username": "other", "first_name": "", "last_name": "", "email": ""},
            ).status_code,
            422,
        )

    def test_account_rejects_invalid_email(self):
        self.assertEqual(
            self.put(
                "/api/account",
                {"username": "ben", "first_name": "", "last_name": "", "email": "not-an-email"},
            ).status_code,
            422,
        )

    @override_settings(DEBUG=True)
    def test_private_audio_supports_seek_ranges(self):
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "test.mp3").write_bytes(b"0123456789")
            self.episode.audio_file = "test.mp3"
            self.episode.save()
            url = f"/api/episodes/{self.episode.id}/audio"
            response = self.client.get(url, HTTP_RANGE="bytes=3-5")
            self.assertEqual(response.status_code, 206)
            self.assertEqual(b"".join(response.streaming_content), b"345")
            response = self.client.get(url, HTTP_RANGE="bytes=-2")
            self.assertEqual(b"".join(response.streaming_content), b"89")
            self.assertEqual(self.client.get(url, HTTP_RANGE="bytes=20-").status_code, 416)
            self.client.logout()
            self.assertEqual(self.client.get(url).status_code, 401)

    def test_out_of_year_database_constraint(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Episode.objects.filter(pk=self.episode.pk).update(source_date="2026-01-01")


class GenerationTests(TestCase):
    def setUp(self):
        self.era = Era.objects.create(name="Early World", color="#64b6bd", order=1)
        self.ep = Episode.objects.create(
            guid="ai-test",
            era=self.era,
            title="Introduction",
            published_at=datetime(2025, 1, 1, tzinfo=dt_timezone.utc),
            source_date="2025-01-01",
            audio_url="https://example.org/test.mp3",
            audio_file="episodes/1/audio.mp3",
            transcript=[
                {
                    "id": 0,
                    "start": 0,
                    "end": 10,
                    "speaker": "A",
                    "text": "In the beginning God created the heavens and the earth.",
                },
                {
                    "id": 1,
                    "start": 10,
                    "end": 20,
                    "speaker": "A",
                    "text": "This teaches us that creation is a gift.",
                },
                {"id": 2, "start": 20, "end": 25, "speaker": "A", "text": "Let us pray together."},
            ],
        )

    def test_transcription_retries_and_accepts_an_empty_trailing_chunk(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import transcribe

        self.ep.duration = 21

        def response(segments):
            return SimpleNamespace(model_dump=lambda: {"segments": segments})

        client = Mock()
        client.audio.transcriptions.create.side_effect = [
            response([{"start": 0, "end": 3, "speaker": "A", "text": "First."}]),
            response([{"start": 0, "end": 3, "speaker": "A", "text": "Second."}]),
            response([]),
            response([]),
            response([]),
        ]

        def create_clip(args, **kwargs):
            Path(args[-1]).write_bytes(b"clip")

        with (
            TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
            patch("study.importing.TRANSCRIBE_CHUNK_SECONDS", 10),
            patch("study.importing.TRANSCRIBE_OVERLAP_SECONDS", 2),
            patch("study.importing.subprocess.run", side_effect=create_clip),
            patch("study.importing.time.sleep"),
        ):
            audio = Path(directory, self.ep.audio_file)
            audio.parent.mkdir(parents=True)
            audio.write_bytes(b"audio")
            transcribe(self.ep, client)

        self.assertEqual(client.audio.transcriptions.create.call_count, 5)
        self.assertEqual([segment["text"] for segment in self.ep.transcript], ["First.", "Second."])

    def test_repairs_reading_outline_link_to_an_assigned_reading_segment(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        from .importing import Classifications, StudyContent, generate_study

        labels = Classifications.model_validate(
            {
                "segments": [
                    {"id": 0, "kind": "scripture", "commentary_text": None},
                    {"id": 1, "kind": "commentary", "commentary_text": None},
                    {"id": 2, "kind": "prayer", "commentary_text": None},
                ]
            }
        )
        content = StudyContent.model_validate(
            {
                "summary": "Fr. Mike reflects on creation as a gift.",
                "key_points": [{"text": "Creation is a gift from God."}],
                "paragraphs": [
                    {
                        "heading": "Creation as gift",
                        "text": "Creation is a gift.",
                        "segment_ids": [1],
                    }
                ],
                "outline": [
                    {
                        "heading": "Reading",
                        "title": "Bible reading",
                        "segment_id": 1,
                        "speaker": "Fr. Mike Schmitz",
                    }
                ],
            }
        )
        client = Mock()
        client.responses.parse.side_effect = [
            SimpleNamespace(output_parsed=labels),
            SimpleNamespace(output_parsed=content),
        ]

        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "episodes/1").mkdir(parents=True)
            generate_study(self.ep, client)

        self.assertEqual(self.ep.outline[0]["heading"], "Reading")
        self.assertEqual(self.ep.outline[0]["segment_id"], 0)
        self.assertEqual(self.ep.outline[0]["start"], 0)

    def test_commentary_is_source_preserving_and_outline_uses_real_offsets(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        from .importing import Classifications, StudyContent, generate_study

        labels = Classifications.model_validate(
            {
                "segments": [
                    {"id": 0, "kind": "scripture", "commentary_text": None},
                    {"id": 1, "kind": "commentary", "commentary_text": None},
                    {"id": 2, "kind": "prayer", "commentary_text": None},
                ]
            }
        )
        content = StudyContent.model_validate(
            {
                "summary": "The episode reflects on creation as a gift.",
                "key_points": [
                    {"text": "Creation is received as a gift from God."},
                ],
                "paragraphs": [
                    {
                        "heading": "Creation as gift",
                        "text": "Creation is a gift.",
                        "segment_ids": [1],
                    }
                ],
                "outline": [
                    {
                        "heading": "Reading",
                        "title": "Bible reading",
                        "segment_id": 0,
                        "speaker": "Fr. Mike Schmitz",
                    },
                    {
                        "heading": "Commentary",
                        "title": "Creation as gift",
                        "segment_id": 1,
                        "speaker": "Fr. Mike Schmitz",
                    },
                ],
            }
        )
        client = Mock()
        client.responses.parse.side_effect = [
            SimpleNamespace(output_parsed=labels),
            SimpleNamespace(output_parsed=content),
        ]
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "episodes/1").mkdir(parents=True)
            generate_study(self.ep, client)
            generated_input = json.loads(
                client.responses.parse.call_args_list[1].kwargs["input"][1]["content"]
            )
            self.assertEqual([s["id"] for s in generated_input["scripture"]], [0])
            self.assertEqual([s["id"] for s in generated_input["commentary"]], [1, 2])
            prompt = client.responses.parse.call_args_list[1].kwargs["input"][0]["content"]
            self.assertIn("Fr. Mike", prompt)
            self.assertIn("Every outline item must have heading Reading or Commentary", prompt)
            self.assertIn("key points", prompt)
            self.assertEqual(self.ep.outline[0]["start"], 0)
            self.assertEqual(self.ep.outline[1]["start"], 10)
            self.assertEqual(self.ep.key_points[0]["text"], "Creation is received as a gift from God.")
            self.assertEqual(len(self.ep.transcript), 3)
            self.assertEqual(self.ep.status, "ready")
            # Checkpoints prevent repeated paid generation on retry.
            client.responses.parse.reset_mock()
            generate_study(self.ep, client)
            client.responses.parse.assert_not_called()

    def test_rejects_rewritten_mixed_commentary(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import Classifications, generate_study

        labels = Classifications.model_validate(
            {
                "segments": [
                    {"id": 0, "kind": "scripture", "commentary_text": None},
                    {"id": 1, "kind": "mixed", "commentary_text": "An invented paraphrase."},
                    {"id": 2, "kind": "prayer", "commentary_text": None},
                ]
            }
        )
        client = Mock()
        client.responses.parse.return_value = SimpleNamespace(output_parsed=labels)
        with (
            TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
            patch("study.importing.time.sleep"),
        ):
            Path(directory, "episodes/1").mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "exact source excerpt"):
                generate_study(self.ep, client)

    def test_retries_missing_structured_classification_with_backoff(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import Classifications, StudyContent, generate_study

        labels = Classifications.model_validate(
            {
                "segments": [
                    {"id": 0, "kind": "scripture", "commentary_text": None},
                    {"id": 1, "kind": "commentary", "commentary_text": None},
                    {"id": 2, "kind": "prayer", "commentary_text": None},
                ]
            }
        )
        content = StudyContent.model_validate(
            {
                "summary": "Fr. Mike reflects on creation as a gift.",
                "key_points": [{"text": "Creation is a gift from God."}],
                "paragraphs": [
                    {
                        "heading": "Creation as gift",
                        "text": "Creation is a gift.",
                        "segment_ids": [1],
                    }
                ],
                "outline": [
                    {
                        "heading": "Reading",
                        "title": "Bible reading",
                        "segment_id": 0,
                        "speaker": "Fr. Mike Schmitz",
                    },
                    {
                        "heading": "Commentary",
                        "title": "Creation as gift",
                        "segment_id": 1,
                        "speaker": "Fr. Mike Schmitz",
                    },
                ],
            }
        )
        client = Mock()
        client.responses.parse.side_effect = [
            SimpleNamespace(output_parsed=None),
            SimpleNamespace(output_parsed=None),
            SimpleNamespace(output_parsed=labels),
            SimpleNamespace(output_parsed=content),
        ]

        with (
            TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
            patch("study.importing.time.sleep") as sleep,
        ):
            Path(directory, "episodes/1").mkdir(parents=True)
            generate_study(self.ep, client)

        self.assertEqual(client.responses.parse.call_count, 4)
        self.assertEqual([call.args for call in sleep.call_args_list], [(2,), (4,)])

    def test_force_study_regenerates_content_but_reuses_classification(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import Classifications, StudyContent, generate_study

        labels = Classifications.model_validate(
            {
                "segments": [
                    {"id": 0, "kind": "scripture", "commentary_text": None},
                    {"id": 1, "kind": "commentary", "commentary_text": None},
                    {"id": 2, "kind": "prayer", "commentary_text": None},
                ]
            }
        )

        def content(summary):
            return StudyContent.model_validate(
                {
                    "summary": summary,
                    "key_points": [{"text": "Creation is a gift from God."}],
                    "paragraphs": [
                        {
                            "heading": "Creation as gift",
                            "text": "Creation is a gift.",
                            "segment_ids": [1],
                        }
                    ],
                    "outline": [
                        {
                            "heading": "Reading",
                            "title": "Bible reading",
                            "segment_id": 0,
                            "speaker": "Fr. Mike Schmitz",
                        },
                        {
                            "heading": "Commentary",
                            "title": "Creation as gift",
                            "segment_id": 1,
                            "speaker": "Fr. Mike Schmitz",
                        },
                    ],
                }
            )

        client = Mock()
        client.responses.parse.side_effect = [
            SimpleNamespace(output_parsed=labels),
            SimpleNamespace(output_parsed=content("Fr. Mike reflects on creation.")),
        ]
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "episodes/1").mkdir(parents=True)
            generate_study(self.ep, client)

            client.responses.parse.reset_mock()
            client.responses.parse.side_effect = [
                SimpleNamespace(output_parsed=content("The speaker revisits creation.")),
                SimpleNamespace(
                    output_parsed=content("Fr. Mike revisits creation with fresh emphasis.")
                ),
            ]
            with patch("study.importing.time.sleep") as sleep:
                generate_study(self.ep, client, force_study=True)

        self.assertEqual(client.responses.parse.call_count, 2)
        sleep.assert_called_once_with(2)
        self.assertEqual(self.ep.summary, "Fr. Mike revisits creation with fresh emphasis.")

    def test_formats_both_transcripts_with_exact_word_parity(self):
        from types import SimpleNamespace
        from unittest.mock import Mock

        from .importing import FormattedBatch, format_transcripts

        self.ep.classification = [
            {"id": 0, "kind": "scripture", "commentary_text": None},
            {"id": 1, "kind": "commentary", "commentary_text": None},
            {"id": 2, "kind": "prayer", "commentary_text": None},
        ]
        transcript_output = FormattedBatch.model_validate(
            {
                "segments": [
                    {
                        "id": 0,
                        "text": "In the beginning, God created the heavens and the earth.",
                        "paragraph_break_before": True,
                    },
                    {
                        "id": 1,
                        "text": "This teaches us that creation is a gift.",
                        "paragraph_break_before": True,
                    },
                    {
                        "id": 2,
                        "text": "Let us pray together.",
                        "paragraph_break_before": False,
                    },
                ]
            }
        )
        commentary_output = FormattedBatch.model_validate(
            {
                "segments": [
                    {
                        "id": 1,
                        "text": "This teaches us that creation is a gift.",
                        "paragraph_break_before": True,
                    },
                    {
                        "id": 2,
                        "text": "Let us pray together.",
                        "paragraph_break_before": True,
                    },
                ],
            }
        )
        client = Mock()
        client.responses.parse.side_effect = [
            SimpleNamespace(output_parsed=transcript_output),
            SimpleNamespace(output_parsed=commentary_output),
        ]

        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "episodes/1").mkdir(parents=True)
            format_transcripts(self.ep, client)

        self.assertEqual(client.responses.parse.call_count, 2)
        self.assertEqual(
            self.ep.formatted_transcript[0]["text"], transcript_output.segments[0].text
        )
        self.assertTrue(self.ep.formatted_transcript[1]["paragraph_break_before"])
        self.assertEqual([item["id"] for item in self.ep.formatted_commentary], [1, 2])
        self.assertIn("source-word parity validated", self.ep.provenance["transcript_formatting"])

    def test_formats_transcripts_in_bounded_batches(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import FormattedSegment, format_transcripts

        self.ep.classification = [
            {"id": 0, "kind": "scripture", "commentary_text": None},
            {"id": 1, "kind": "commentary", "commentary_text": None},
            {"id": 2, "kind": "prayer", "commentary_text": None},
        ]

        def parse_response(**kwargs):
            payload = json.loads(kwargs["input"][1]["content"])
            if "segments_to_format" in payload:
                segments = [
                    FormattedSegment(
                        id=item["id"],
                        text=item["text"],
                        paragraph_break_before=item["id"] in (0, 1),
                    )
                    for item in payload["segments_to_format"]
                ]
                return SimpleNamespace(
                    output_parsed=SimpleNamespace(
                        segments=segments,
                        model_dump=lambda: {
                            "segments": [segment.model_dump() for segment in segments]
                        },
                    )
                )
            raise AssertionError("Formatter did not use bounded batch input")

        client = Mock()
        client.responses.parse.side_effect = parse_response

        with (
            TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
            patch("study.importing.TRANSCRIPT_FORMAT_BATCH_SIZE", 2),
        ):
            Path(directory, "episodes/1").mkdir(parents=True)
            format_transcripts(self.ep, client)

        self.assertEqual(client.responses.parse.call_count, 3)
        payloads = [
            json.loads(call.kwargs["input"][1]["content"])
            for call in client.responses.parse.call_args_list
        ]
        self.assertTrue(all(len(payload["segments_to_format"]) <= 2 for payload in payloads))

    def test_failed_formatting_batch_is_split_and_completed(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import FormattedBatch, FormattedSegment, _format_segment_batches

        source = self.ep.transcript[:2]

        def parse_response(**kwargs):
            payload = json.loads(kwargs["input"][1]["content"])
            items = payload["segments_to_format"]
            if len(items) > 1:
                items = [{**items[0], "text": f'{items[0]["text"]} changed'}, *items[1:]]
            return SimpleNamespace(
                output_parsed=FormattedBatch(
                    segments=[
                        FormattedSegment(
                            id=item["id"],
                            text=item["text"],
                            paragraph_break_before=True,
                        )
                        for item in items
                    ]
                )
            )

        client = Mock()
        client.responses.parse.side_effect = parse_response

        with TemporaryDirectory() as directory, patch("study.importing.time.sleep"):
            formatted = _format_segment_batches(
                self.ep,
                client,
                source,
                "transcript",
                Path(directory),
                "test-model",
                False,
            )

        self.assertEqual([segment.id for segment in formatted], [0, 1])
        self.assertEqual([segment.text for segment in formatted], [item["text"] for item in source])
        self.assertEqual(client.responses.parse.call_count, 5)

    def test_skips_episodes_whose_transcripts_already_passed(self):
        from unittest.mock import Mock

        from .importing import format_transcripts

        self.ep.formatted_transcript = [{"id": 0, "text": "already done"}]
        self.ep.formatted_commentary = [{"id": 1, "text": "already done"}]
        client = Mock()

        format_transcripts(self.ep, client)

        client.responses.parse.assert_not_called()

    def test_retry_resumes_after_completed_formatting_batches(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import FormattedBatch, FormattedSegment, format_transcripts

        self.ep.classification = [
            {"id": 0, "kind": "scripture", "commentary_text": None},
            {"id": 1, "kind": "commentary", "commentary_text": None},
            {"id": 2, "kind": "prayer", "commentary_text": None},
        ]

        def parsed(segments):
            return SimpleNamespace(output_parsed=FormattedBatch(segments=segments))

        first_batch = [
            FormattedSegment(id=0, text=self.ep.transcript[0]["text"], paragraph_break_before=True),
            FormattedSegment(id=1, text=self.ep.transcript[1]["text"], paragraph_break_before=True),
        ]
        last_batch = [
            FormattedSegment(id=2, text=self.ep.transcript[2]["text"], paragraph_break_before=False)
        ]
        first_client = Mock()
        first_client.responses.parse.side_effect = [
            parsed(first_batch),
            parsed(last_batch),
            RuntimeError("temporary API failure"),
            RuntimeError("temporary API failure"),
            RuntimeError("temporary API failure"),
        ]

        def valid_response(**kwargs):
            payload = json.loads(kwargs["input"][1]["content"])
            segments = [
                FormattedSegment(
                    id=item["id"],
                    text=item["text"],
                    paragraph_break_before=True,
                )
                for item in payload["segments_to_format"]
            ]
            return parsed(segments)

        second_client = Mock()
        second_client.responses.parse.side_effect = valid_response

        with (
            TemporaryDirectory() as directory,
            override_settings(MEDIA_ROOT=Path(directory)),
            patch("study.importing.TRANSCRIPT_FORMAT_BATCH_SIZE", 2),
            patch("study.importing.time.sleep"),
        ):
            Path(directory, "episodes/1").mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "temporary API failure"):
                format_transcripts(self.ep, first_client)
            format_transcripts(self.ep, second_client)

        self.assertEqual(first_client.responses.parse.call_count, 5)
        self.assertEqual(second_client.responses.parse.call_count, 1)
        resumed_payloads = [
            json.loads(call.kwargs["input"][1]["content"])
            for call in second_client.responses.parse.call_args_list
        ]
        self.assertEqual(
            [
                [item["id"] for item in payload["segments_to_format"]]
                for payload in resumed_payloads
            ],
            [[1, 2]],
        )
        self.assertEqual(len(self.ep.formatted_transcript), 3)
        self.assertEqual(len(self.ep.formatted_commentary), 2)

    def test_single_segment_formatting_falls_back_to_exact_source_words(self):
        from types import SimpleNamespace
        from unittest.mock import Mock, patch

        from .importing import FormattedBatch, _format_segment_batches

        source = self.ep.transcript[:1]
        changed = FormattedBatch.model_validate(
            {
                "segments": [
                    {
                        "id": 0,
                        "text": f'{source[0]["text"]} changed',
                        "paragraph_break_before": True,
                    }
                ]
            }
        )
        client = Mock()
        client.responses.parse.return_value = SimpleNamespace(output_parsed=changed)

        with (
            TemporaryDirectory() as directory,
            patch("study.importing.time.sleep"),
        ):
            formatted = _format_segment_batches(
                self.ep,
                client,
                source,
                "transcript",
                Path(directory),
                "test-model",
                False,
            )

        self.assertEqual(client.responses.parse.call_count, 3)
        self.assertEqual(formatted[0].text, source[0]["text"])

    def test_word_parity_treats_typographic_apostrophes_as_punctuation(self):
        from .importing import _word_tokens

        self.assertEqual(_word_tokens("Don’t change words."), _word_tokens("don't change words"))


class ImportPodcastCommandTests(TestCase):
    def test_force_study_flag_is_available(self):
        from study.management.commands.import_podcasts import Command

        parser = Command().create_parser("manage.py", "import_podcasts")

        options = parser.parse_args(["--day", "1", "--force-study"])

        self.assertEqual(options.day, 1)
        self.assertTrue(options.force_study)

    def test_retroactive_format_command_requires_explicit_selection(self):
        from study.management.commands.format_transcripts import Command

        parser = Command().create_parser("manage.py", "format_transcripts")
        options = parser.parse_args(["--edition", "catechism", "--all"])

        self.assertEqual(options.edition, "catechism")
        self.assertTrue(options.all)

    def test_importer_does_not_rerun_ai_for_ready_formatted_episode(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock, patch

        from study.management.commands.import_podcasts import Command

        episode = SimpleNamespace(
            id=1,
            title="Day 1",
            status="ready",
            formatted_transcript=[{"id": 0}],
            formatted_commentary=[{"id": 1}],
        )
        cursor = MagicMock()
        cursor.fetchone.return_value = [True]
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        database = MagicMock()
        database.cursor.return_value = cursor_context

        with (
            patch(
                "study.management.commands.import_podcasts.Episode.objects.get",
                return_value=episode,
            ),
            patch("study.management.commands.import_podcasts.connection", database),
            patch("study.management.commands.import_podcasts.download_audio") as download,
            patch("study.management.commands.import_podcasts.transcribe") as transcribe,
            patch("study.management.commands.import_podcasts.generate_study") as generate,
            patch("study.management.commands.import_podcasts.format_transcripts") as format_text,
        ):
            result = Command().process_episode(1, download_only=False, force_study=False)

        self.assertEqual(result, "Audio ready: Day 1")
        download.assert_called_once_with(episode)
        transcribe.assert_not_called()
        generate.assert_not_called()
        format_text.assert_not_called()

    def test_bulk_import_reports_every_failed_episode_with_retry_commands(self):
        from types import SimpleNamespace
        from unittest.mock import patch

        from django.core.management.base import CommandError

        from study.management.commands.import_podcasts import Command

        episodes = [
            SimpleNamespace(
                id=279,
                title="Day 279: The New Covenant (2025)",
                day_id=279,
                catechism_day_id=None,
                guid="day-279",
                edition="bible",
            ),
            SimpleNamespace(
                id=301,
                title="Day 301: Faithful Witness (2025)",
                day_id=301,
                catechism_day_id=None,
                guid="day-301",
                edition="bible",
            ),
        ]
        failures = [
            CommandError("ValueError: summary omitted Fr. Mike"),
            CommandError("APITimeoutError: request timed out"),
        ]
        command = Command()

        with (
            patch("study.management.commands.import_podcasts.parse_feed", return_value=[{}, {}]),
            patch(
                "study.management.commands.import_podcasts.catalog_entry",
                side_effect=episodes,
            ),
            patch.object(command, "process_episode", side_effect=failures),
            self.assertRaises(CommandError) as raised,
        ):
            command.handle(
                edition="bible",
                day=None,
                guid=None,
                all=True,
                feed_file=SimpleNamespace(read_bytes=lambda: b"feed"),
                catalog_only=False,
                download_only=False,
                force_study=False,
                workers=1,
            )

        message = str(raised.exception)
        self.assertIn("2 episode(s) did not finish", message)
        self.assertIn("Episode 279 — Day 279: The New Covenant (2025)", message)
        self.assertIn("Episode 301 — Day 301: Faithful Witness (2025)", message)
        self.assertIn("summary omitted Fr. Mike", message)
        self.assertIn("request timed out", message)
        self.assertIn("import_podcasts --edition bible --day 279", message)
        self.assertIn("import_podcasts --edition bible --day 301", message)

    def test_episode_failure_reports_stage_and_persists_redacted_cause(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock, patch

        from django.core.management.base import CommandError

        from study.management.commands.import_podcasts import Command

        episode = SimpleNamespace(id=279, title="Day 279", status="ready", error="")
        episode.save = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.return_value = [True]
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        database = MagicMock()
        database.cursor.return_value = cursor_context

        with (
            patch(
                "study.management.commands.import_podcasts.Episode.objects.get",
                return_value=episode,
            ),
            patch("study.management.commands.import_podcasts.connection", database),
            patch(
                "study.management.commands.import_podcasts.download_audio",
                side_effect=ValueError(
                    "ffprobe rejected https://media.example/audio?token=private-value "
                    "with api_key=sk-secret-value"
                ),
            ),
            self.assertRaises(CommandError) as raised,
        ):
            Command().process_episode(279, download_only=False, force_study=False)

        message = str(raised.exception)
        self.assertIn("Failed while downloading or validating audio", message)
        self.assertIn("ValueError: ffprobe rejected", message)
        self.assertIn("?<REDACTED>", message)
        self.assertNotIn("private-value", message)
        self.assertNotIn("secret-value", message)
        self.assertEqual(episode.error, message)
        self.assertEqual(episode.status, "failed")
        episode.save.assert_called_once_with(update_fields=["status", "error"])
