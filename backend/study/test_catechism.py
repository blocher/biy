import json
from datetime import datetime
from datetime import timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from .importing import parse_feed
from .management.commands.import_catechism import parse_page
from .models import (
    CatechismDay,
    CatechismDayProgress,
    CatechismParagraph,
    Day,
    Episode,
    Era,
    Profile,
)


def feed_item(title, date, guid):
    return (
        f"<item><title>{title}</title><guid>{guid}</guid><pubDate>{date}</pubDate>"
        '<enclosure url="https://example.org/audio.mp3"/></item>'
    )


class CatechismImportTests(TestCase):
    def test_plan_covers_all_days_and_paragraphs(self):
        call_command("seed_catechism_plan", verbosity=0)
        days = list(CatechismDay.objects.order_by("number"))
        self.assertEqual([day.number for day in days], list(range(1, 366)))
        self.assertEqual(
            [day.number for day in days if day.paragraph_start is None],
            [3, 144, 230, 328],
        )
        covered = [
            number
            for day in days
            if day.paragraph_start is not None
            for number in range(day.paragraph_start, day.paragraph_end + 1)
        ]
        self.assertEqual(covered, list(range(1, 2866)))
        self.assertEqual(days[0].color, "#00798c")
        self.assertEqual(days[-1].color, "#7e5a89")
        self.assertEqual(days[0].part, "Prologue")
        self.assertEqual(days[2].part, "Part One: What We Believe")
        self.assertEqual(days[143].part, "Part Two: How We Worship")
        self.assertEqual(days[229].part, "Part Three: How We Live")
        self.assertEqual(days[327].part, "Part Four: How We Pray")
        self.assertEqual(days[3].section, "Section One: Divine Revelation")
        self.assertEqual(days[3].chapter, "Chapter One: The Search")

    def test_vatican_parser_repairs_merged_and_continued_paragraphs(self):
        rows = parse_page(
            b"""
            <p class='MsoNormal'>2076 First paragraph. 2077 The</p>
            <p class='MsoNormal'>gift continues here.</p>
            <p class='MsoNormal'>2078 Next paragraph.</p>
            """,
            "https://www.vatican.va/example",
        )
        self.assertEqual([row["number"] for row in rows], [2076, 2077, 2078])
        self.assertEqual(rows[1]["text"], "The gift continues here.")

    def test_2025_feed_selects_labeled_duplicate_and_keeps_two_bonuses(self):
        xml = (
            "<rss><channel>"
            + feed_item(
                "Day 19: Summary of Sacred Scripture (2025)",
                "Sun, 19 Jan 2025 03:15:00 -0500",
                "2025",
            )
            + feed_item(
                "Day 19: Summary of Sacred Scripture (2026)",
                "Sun, 19 Jan 2025 03:15:00 -0500",
                "2026",
            )
            + feed_item(
                "BONUS: Why Scripture and Tradition?",
                "Tue, 30 Dec 2025 03:15:00 -0500",
                "bonus-1",
            )
            + feed_item(
                "BONUS: Church Authority",
                "Wed, 31 Dec 2025 03:15:00 -0500",
                "bonus-2",
            )
            + "</channel></rss>"
        )
        rows = parse_feed(xml, "catechism")
        self.assertEqual([row["guid"] for row in rows], ["2025", "bonus-1", "bonus-2"])


class CatechismAPITests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user("reader", password="long-test-password")
        self.other = User.objects.create_user("other-reader", password="long-test-password")
        self.era = Era.objects.create(name="Early World", color="#64b6bd", order=1)
        self.bible_day = Day.objects.create(number=1, era=self.era, readings=["Genesis 1"])
        self.catechism_day = CatechismDay.objects.create(
            number=1,
            part="WHAT WE BELIEVE Part One",
            section="DIVINE REVELATION Section One",
            chapter="THE SEARCH Chapter One",
            paragraph_start=1,
            paragraph_end=2,
            color="#00798c",
        )
        CatechismParagraph.objects.bulk_create(
            [
                CatechismParagraph(
                    number=number,
                    text=f"Catechism paragraph {number}.",
                    source_url="https://www.vatican.va/archive/ENG0015/example",
                )
                for number in (1, 2)
            ]
        )
        self.episode = Episode.objects.create(
            guid="catechism-day-1",
            edition="catechism",
            catechism_day=self.catechism_day,
            title="Day 1: To Know and Love God (2025)",
            published_at=datetime(2025, 1, 1, tzinfo=dt_timezone.utc),
            source_date="2025-01-01",
            audio_url="https://example.org/catechism.mp3",
        )
        self.client.force_login(self.user)

    def put(self, url, payload):
        return self.client.put(url, json.dumps(payload), content_type="application/json")

    def test_catechism_library_and_completion_are_independent(self):
        detail = self.client.get("/api/days/1?edition=catechism").json()
        self.assertEqual(detail["readings"], ["CCC 1-2"])
        self.assertEqual([row["number"] for row in detail["catechism"]], [1, 2])
        self.assertEqual(detail["episode"]["edition"], "catechism")

        response = self.put("/api/days/1/completion?edition=catechism", {"completed": True})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.get("/api/library?edition=catechism").json()["completed"], 1)
        self.assertEqual(self.client.get("/api/library?edition=bible").json()["completed"], 0)

    def test_library_does_not_load_large_episode_content_fields(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/library?edition=catechism")

        self.assertEqual(response.status_code, 200)
        episode_queries = [
            query["sql"] for query in queries if 'FROM "study_episode"' in query["sql"]
        ]
        self.assertEqual(len(episode_queries), 1)
        self.assertNotIn('"transcript"', episode_queries[0])
        self.assertNotIn('"formatted_transcript"', episode_queries[0])
        self.assertNotIn('"formatted_commentary"', episode_queries[0])

    def test_account_requires_one_edition_and_controls_leaderboard_membership(self):
        response = self.client.patch(
            "/api/preferences?edition=bible",
            json.dumps({"bible_enabled": False, "catechism_enabled": False}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)

        Profile.objects.create(user=self.other, catechism_enabled=False)
        CatechismDayProgress.objects.create(
            user=self.other,
            day=self.catechism_day,
            completed_at=datetime(2025, 1, 2, tzinfo=dt_timezone.utc),
        )
        names = [
            row["name"] for row in self.client.get("/api/leaderboard?edition=catechism").json()
        ]
        self.assertNotIn("other-reader", names)
