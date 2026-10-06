import gzip
import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .commentaries import commentary_ranges, historical_commentaries
from .models import Commentary, CommentaryAuthor, Day, Era


class CommentaryMatchingTests(TestCase):
    def test_ranges_use_export_keys_and_split_cross_chapter_passages(self):
        psalm = commentary_ranges("Psalm 23:1")[0]
        cross_chapter = commentary_ranges("John 7:53-8:11")

        self.assertEqual(psalm.book_key, "psalms")
        self.assertEqual(psalm.start, 23_000_001)
        self.assertEqual(len(cross_chapter), 2)
        self.assertEqual(cross_chapter[0].start, 7_000_053)
        self.assertEqual(cross_chapter[1].end, 8_000_011)


class CommentaryApiTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user("reader", password="password")
        self.client.force_login(user)
        era = Era.objects.create(name="Test", color="#123456", order=1)
        self.day = Day.objects.create(number=1, era=era, readings=["John 3:16-18"])
        orthodox = CommentaryAuthor.objects.create(
            name="Early Witness",
            default_year=120,
            category="Early Fathers (Pre-Nicaea)",
        )
        condemned = CommentaryAuthor.objects.create(
            name="Condemned Witness",
            default_year=300,
            category="Eastern & Byzantine Theology",
            condemned_by_council=True,
        )
        Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000001",
            author=orthodox,
            file_name="Early.toml",
            year=120,
            book_key="john",
            location_start=3_000_019,
            location_end=3_000_020,
            text="A later verse should not match.",
            source_title="Later source",
        )
        self.early = Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000002",
            author=orthodox,
            file_name="Early.toml",
            year=120,
            book_key="john",
            location_start=3_000_016,
            location_end=3_000_017,
            text="An early witness.",
            source_title="Early source",
        )
        self.condemned = Commentary.objects.create(
            external_id="00000000-0000-0000-0000-000000000003",
            author=condemned,
            file_name="Condemned.toml",
            year=300,
            book_key="john",
            location_start=3_000_018,
            location_end=3_000_018,
            text="A condemned witness.",
            source_title="Second source",
        )

    def test_returns_overlapping_rows_oldest_first_with_author_metadata(self):
        response = self.client.get("/api/commentaries", {"day": self.day.number})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 2)
        self.assertEqual([row["year"] for row in payload["commentaries"]], [120, 300])
        self.assertTrue(payload["commentaries"][1]["author_metadata"]["condemned_by_council"])
        self.assertEqual(payload["commentaries"][0]["matched_readings"], ["John 3:16-18"])

    def test_category_filter_is_applied(self):
        response = self.client.get(
            "/api/commentaries",
            {"day": self.day.number, "category": "Eastern & Byzantine Theology"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)

    def test_focus_opens_the_page_containing_a_linked_commentary(self):
        response = self.client.get(
            "/api/commentaries",
            {
                "day": self.day.number,
                "page_size": 1,
                "focus": self.condemned.pk,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["page"], 2)
        self.assertEqual(len(payload["commentaries"]), 2)
        self.assertEqual(
            payload["commentaries"][-1]["database_id"], self.condemned.pk
        )

    def test_historical_lookup_returns_citable_witness_metadata(self):
        result = historical_commentaries(reference="John 3:16-18", limit=1)

        self.assertEqual(result["total"], 2)
        self.assertEqual(result["next_offset"], 1)
        source = result["sources"][0]
        self.assertTrue(source["id"].startswith("H"))
        self.assertEqual(source["kind"], "historical_commentary")
        self.assertEqual(source["metadata"]["author"], "Early Witness")
        self.assertEqual(source["metadata"]["year_label"], "c. AD 120")

    def test_offline_manifest_and_unique_gzip_book(self):
        manifest_response = self.client.get("/api/offline-commentaries/manifest")
        self.assertEqual(manifest_response.status_code, 200)
        manifest = manifest_response.json()
        self.assertEqual(manifest["books"], ["john"])
        self.assertEqual(manifest["days"]["1"]["readings"], ["John 3:16-18"])
        self.assertEqual(manifest["days"]["1"]["ranges"][0]["book"], "john")
        self.assertTrue(manifest["version"])

        book_response = self.client.get("/api/offline-commentaries/books/john")
        self.assertEqual(book_response.status_code, 200)
        self.assertEqual(book_response["Content-Type"], "application/gzip")
        rows = json.loads(gzip.decompress(book_response.content))
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["database_id"], self.early.pk - 1)
        self.assertEqual(rows[1]["text"], "An early witness.")
        self.assertEqual(rows[1]["matched_readings"], [])
        self.assertEqual(
            self.client.get("/api/offline-commentaries/books/invalid!").status_code,
            404,
        )
        self.client.logout()
        self.assertEqual(
            self.client.get("/api/offline-commentaries/manifest").status_code, 401
        )
        self.assertEqual(
            self.client.get("/api/offline-commentaries/books/john").status_code, 401
        )

    def test_offline_manifest_version_changes_with_content_and_plan_edits(self):
        def version():
            return self.client.get("/api/offline-commentaries/manifest").json()["version"]

        original = version()
        self.early.text = "An early witness!"  # Same length as the original text.
        self.early.save(update_fields=["text"])
        changed_text = version()
        self.assertNotEqual(changed_text, original)

        self.early.author.category = "Reclassified"
        self.early.author.save(update_fields=["category"])
        changed_author = version()
        self.assertNotEqual(changed_author, changed_text)

        self.day.readings = ["John 3:17-18"]
        self.day.save(update_fields=["readings"])
        self.assertNotEqual(version(), changed_author)

    def test_day_lookup_links_to_the_commentary_browser_anchor(self):
        result = historical_commentaries(day=self.day.number, limit=1)

        self.assertEqual(
            result["sources"][0]["url"],
            f"/commentaries?day={self.day.number}#commentary-{self.early.pk}",
        )
