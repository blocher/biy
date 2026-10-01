from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from .models import (
    CatechismDay,
    CatechismParagraph,
    Commentary,
    CommentaryAuthor,
    Day,
    Episode,
    Era,
    Note,
    Profile,
    SearchChunk,
    Verse,
)
from .search import index_catechism, index_chapter
from .site_search import ranked_results, site_search


class RankedResultTests(SimpleTestCase):
    def test_deduplication_keeps_best_excerpt_before_applying_limit(self):
        weaker = {"key": "episode:1:0", "excerpt": "First matching segment"}
        best = {"key": "episode:1:1", "excerpt": "Best matching segment"}
        scripture = {"key": "bible:John:3:0"}
        matches = [
            (2, ("chunk", "commentary", "episode:1"), weaker),
            (4, ("chunk", "commentary", "episode:1"), best),
            (1, ("chunk", "scripture", "bible:John:3"), scripture),
        ]
        self.assertEqual(ranked_results(matches, 2), [best, scripture])
        self.assertEqual(ranked_results(matches, 0), [])

    def test_repeated_candidates_from_different_search_passes_are_merged(self):
        result = {"key": "note:1:0"}
        identity = ("chunk", "journal", "note:1")
        self.assertEqual(ranked_results([(2, identity, result), (1, identity, result)], 24), [result])

    def test_same_title_or_destination_does_not_merge_distinct_sources(self):
        first = {"key": "note:1:0", "title": "Reading note", "url": "/bible/day/1"}
        second = {**first, "key": "note:2:0"}
        self.assertEqual(
            ranked_results([
                (2, ("chunk", "journal", "note:1"), first),
                (2, ("chunk", "journal", "note:2"), second),
            ], 24),
            [first, second],
        )


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

    def test_many_episode_matches_do_not_repeat_or_crowd_out_scripture(self):
        episode = Episode.objects.get(day=self.day)
        episode.status = "ready"
        episode.transcript = [
            {"id": index, "start": index * 30, "text": "Loved mercy. " * 170}
            for index in range(50)
        ]
        episode.classification = [
            {"id": index, "kind": "commentary"} for index in range(50)
        ]
        episode.save()
        self.assertGreater(SearchChunk.objects.filter(episode=episode).count(), 45)

        results = self.search("loved")
        commentary = [item for item in results if item["kind"] == "commentary"]
        self.assertEqual(len(commentary), 1)
        self.assertIn("tab=commentary#segment-", commentary[0]["url"])
        self.assertTrue(any(item["kind"] == "scripture" for item in results))

    def test_long_notes_return_once_but_separate_notes_remain_distinct(self):
        first = Note.objects.create(
            user=self.user, day=self.day, body="The Eucharist is a gift. " * 250,
            source_url="/bible/day/1/reader?tab=scripture",
        )
        second = Note.objects.create(
            user=self.user, day=self.day, body="The Eucharist is a gift. " * 250,
            source_url=first.source_url,
        )
        Note.objects.create(user=self.other, day=self.day, body="Eucharist private secret. " * 250)
        self.assertGreater(SearchChunk.objects.filter(note=first).count(), 1)

        for phrase in ["eucharist", "eucharits"]:
            with self.subTest(phrase=phrase):
                results = self.search(phrase)
                notes = [item for item in results if item["kind"] == "journal"]
                self.assertEqual(len(notes), 2)
                self.assertEqual(
                    {item["key"].rsplit(":", 1)[0] for item in notes},
                    {f"note:{first.pk}", f"note:{second.pk}"},
                )
                self.assertFalse(any("private secret" in item["excerpt"] for item in results))

    def test_scripture_chunks_share_one_chapter_result(self):
        self.day.readings = ["John 3"]
        self.day.save()
        Verse.objects.bulk_create([
            Verse(book="John", chapter=3, number=number, text="God loved the world.")
            for number in range(1, 16)
        ])
        index_chapter("John", 3)
        self.assertEqual(SearchChunk.objects.filter(source="bible:John:3").count(), 2)
        self.assertEqual(len([item for item in self.search("loved") if item["kind"] == "scripture"]), 1)

    def test_best_openable_scripture_chunk_is_kept(self):
        # The highest-ranked chunk is outside the assigned passage. A lower
        # matching chunk in the same chapter is still a valid result.
        Verse.objects.bulk_create([
            Verse(book="John", chapter=3, number=number, text="Loved " * 100)
            for number in range(1, 9)
        ])
        index_chapter("John", 3)
        scripture = [item for item in self.search("loved") if item["kind"] == "scripture"]
        self.assertEqual(len(scripture), 1)
        self.assertEqual(scripture[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")

    def full_john_chapter(self):
        Verse.objects.bulk_create([
            Verse(book="John", chapter=3, number=number, text="An unrelated passage.")
            for number in range(1, 16)
        ])
        index_chapter("John", 3)

    def test_partial_chapter_match_links_to_the_assigned_verse(self):
        self.full_john_chapter()
        results = [item for item in self.search("loved the world") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")
        self.assertEqual(results[0]["title"], "John 3:16")
        self.assertIn("God so loved the world", results[0]["excerpt"])
        self.assertNotIn("unrelated", results[0]["excerpt"])

    def test_match_only_in_unassigned_verse_does_not_link_to_overlapping_reading(self):
        self.full_john_chapter()
        Verse.objects.filter(book="John", chapter=3, number=15).update(text="A comet appeared.")
        index_chapter("John", 3)
        results = self.search("comet")
        self.assertFalse(any(item["kind"] == "scripture" for item in results))

    def test_split_chunk_chooses_day_that_contains_the_match(self):
        self.full_john_chapter()
        self.day.readings = ["John 3:9-10"]
        self.day.save()
        Day.objects.create(number=2, era=self.day.era, readings=["John 3:16-18"])
        results = [item for item in self.search("loved the world") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/2/reader?tab=scripture#verse-john-3-16")
        self.assertIn("God so loved the world", results[0]["excerpt"])
        self.assertNotIn("unrelated", results[0]["excerpt"])

    def test_stemmed_match_keeps_excerpt_and_anchor_on_matching_verse(self):
        self.full_john_chapter()
        self.day.readings = ["John 3:9-16"]
        self.day.save()
        results = [item for item in self.search("love") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")
        self.assertTrue(results[0]["excerpt"].startswith("16. God so loved the world"))

    def test_cross_chapter_assignment_links_to_matching_verse(self):
        self.full_john_chapter()
        self.day.readings = ["John 2:25-3:18"]
        self.day.save()
        results = [item for item in self.search("loved the world") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")

    def test_fuzzy_scripture_match_also_requires_an_assigned_verse(self):
        self.full_john_chapter()
        Verse.objects.filter(book="John", chapter=3, number=15).update(text="The Eucharist is a gift.")
        index_chapter("John", 3)
        self.assertFalse(any(item["kind"] == "scripture" for item in self.search("eucharits")))

        Verse.objects.filter(book="John", chapter=3, number=16).update(text="The Eucharist is a gift.")
        index_chapter("John", 3)
        results = [item for item in self.search("eucharits") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")
        self.assertIn("Eucharist", results[0]["excerpt"])

        self.day.readings = ["John 3:9-16"]
        self.day.save()
        Verse.objects.filter(book="John", chapter=3, number=15).update(text="An unrelated passage.")
        index_chapter("John", 3)
        results = [item for item in self.search("eucharits") if item["kind"] == "scripture"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "/bible/day/1/reader?tab=scripture#verse-john-3-16")
        self.assertTrue(results[0]["excerpt"].startswith("16. The Eucharist is a gift."))

    def test_catechism_chunks_return_one_reading_with_a_matching_anchor(self):
        CatechismDay.objects.create(
            number=2, part="Sacraments", paragraph_start=1, paragraph_end=3, color="#123456",
        )
        for number in range(1, 4):
            CatechismParagraph.objects.create(
                number=number, text="Baptism brings grace. " * 100,
                source_url="https://www.vatican.va/example",
            )
        index_catechism()
        self.assertGreater(SearchChunk.objects.filter(source="catechism-day:2").count(), 1)
        results = self.search("baptism")
        readings = [item for item in results if item["kind"] == "catechism"]
        self.assertEqual(len(readings), 1)
        self.assertTrue(readings[0]["url"].startswith("/catechism/day/2/reader?tab=catechism#ccc-"))

    def test_final_limit_counts_unique_results(self):
        for number in range(3):
            Note.objects.create(user=self.user, day=self.day, body="Eucharist " * 450)
        results = site_search(self.user, "eucharist", limit=3)["results"]
        self.assertEqual(len(results), 3)
        self.assertEqual(len({item["key"].rsplit(":", 1)[0] for item in results}), 3)
