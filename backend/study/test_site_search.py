from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from .models import CatechismDay, Commentary, CommentaryAuthor, Day, Episode, Era, Note, Profile, Verse
from .search import index_chapter


@override_settings(OPENAI_API_KEY="")
class SiteSearchTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.user = users.objects.create_user("reader", password="long-test-password")
        self.other = users.objects.create_user("other", password="long-test-password")
        self.client.force_login(self.user)
        era = Era.objects.create(name="Test", color="#123456", order=1)
        self.day = Day.objects.create(number=1, era=era, readings=["John 3:16-18"])
        Verse.objects.create(book="John", chapter=3, number=16, text="God so loved the world.")
        index_chapter("John", 3)
        Episode.objects.create(
            guid="search-day-one",
            day=self.day,
            title="Day 1: God's Love",
            description="A reading about enduring love.",
            published_at=timezone.now(),
            source_date="2025-01-01",
        )

    def search(self, phrase):
        response = self.client.get("/api/search", {"q": phrase})
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def test_scripture_and_day_titles_have_openable_in_app_links(self):
        scripture = self.search("loved the world")
        self.assertTrue(any(
            item["url"] == "/bible/day/1/reader?tab=scripture#verse-john-3-16"
            for item in scripture
        ))
        days = self.search("enduring love")
        self.assertTrue(any(item["url"] == "/bible/day/1" for item in days))

    def test_fuzzy_typo_finds_permitted_note_without_leaking_private_notes(self):
        own = Note.objects.create(user=self.user, day=self.day, body="The Eucharist is a gift.")
        Note.objects.create(user=self.other, day=self.day, body="The Eucharist is another secret.")
        results = self.search("eucharits")
        keys = [item["key"] for item in results]
        self.assertIn(f"note:{own.pk}:0", keys)
        self.assertFalse(any("secret" in item["excerpt"] for item in results))

    def test_historical_commentary_links_to_matching_day_and_focused_entry(self):
        author = CommentaryAuthor.objects.create(
            name="Ancient Writer", default_year=200, category="Early Fathers"
        )
        matching = Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000101",
            author=author,
            file_name="commentary.toml",
            year=200,
            book_key="john",
            location_start=3_000_016,
            location_end=3_000_016,
            text="A witness to generous mercy.",
            source_title="On the Gospel",
        )
        Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000102",
            author=author,
            file_name="elsewhere.toml",
            year=200,
            book_key="luke",
            location_start=2_000_001,
            location_end=2_000_001,
            text="A different passage about mercy.",
            source_title="Elsewhere",
        )
        results = self.search("mercy")
        historical = [item for item in results if item["kind"] == "historical_commentary"]
        self.assertEqual([item["key"] for item in historical], [f"historical:{matching.pk}"])
        self.assertEqual(
            historical[0]["url"],
            f"/commentaries?day=1&focus={matching.pk}#commentary-{matching.pk}",
        )

    def test_search_requires_login_and_bounded_query(self):
        self.assertEqual(self.client.get("/api/search", {"q": "a"}).status_code, 422)
        self.assertEqual(self.client.get("/api/search", {"q": "x" * 121}).status_code, 422)
        self.client.logout()
        self.assertEqual(self.client.get("/api/search", {"q": "love"}).status_code, 401)

    def test_disabled_edition_does_not_offer_unopenable_readings(self):
        Profile.objects.create(user=self.user, bible_enabled=False, catechism_enabled=True)
        self.assertEqual(self.search("loved the world"), [])

    def test_catechism_plan_titles_are_searchable_without_episode_audio(self):
        CatechismDay.objects.create(
            number=2, part="The Sacraments", section="Celebrating the Mystery",
            chapter="Baptism", color="#123456",
        )
        results = self.search("baptism")
        self.assertTrue(any(item["url"] == "/catechism/day/2" for item in results))
