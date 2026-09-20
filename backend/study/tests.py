import json
from datetime import datetime
from datetime import timezone as dt_timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings

from .importing import parse_feed
from .models import Day, Episode, Era, Verse
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

    def test_day_plan_exact_and_idempotent(self):
        call_command("seed_plan", verbosity=0)
        call_command("seed_plan", verbosity=0)
        self.assertEqual(Day.objects.count(), 365)
        self.assertEqual(Day.objects.get(pk=1).readings, ["Genesis 1-2", "Psalm 19"])
        self.assertEqual(Day.objects.get(pk=1).era.color, "#64b6bd")
        self.assertEqual(Day.objects.get(pk=275).readings[1], "Esther 3, 13")
        self.assertEqual(Day.objects.get(pk=321).readings[0], "Luke 22:39-24")


class ScriptureTests(TestCase):
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
        from unittest.mock import Mock

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
        with TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            Path(directory, "episodes/1").mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "exact source excerpt"):
                generate_study(self.ep, client)
