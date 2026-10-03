import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from .catechism_content import (
    extract_dataset,
    normalize_dataset,
    parse_inline,
    plain,
    source_digest,
)
from .models import CatechismDay, CatechismParagraph, Verse


def corpus(blocks=None):
    blocks = blocks or [{"type": "paragraph", "paragraphNumber": 1, "text": "Original body."}]
    used = {b.get("paragraphNumber") for b in blocks}
    return [
        {
            "book": "prologue",
            "heading": "Prologue",
            "blocks": blocks
            + [
                {"type": "paragraph", "paragraphNumber": n, "text": f"Paragraph {n}."}
                for n in range(1, 2866)
                if n not in used
            ],
            "sections": [],
        }
    ]


class CatechismStructureTests(SimpleTestCase):
    def test_preserves_heading_boundary_quotes_and_scoped_notes(self):
        data = corpus(
            [
                {
                    "type": "paragraph",
                    "paragraphNumber": 1,
                    "text": "First.<a>1</a>",
                    "appendedQuote": "A quotation.",
                    "crossLinks": {"1": {"text": "DV 2."}},
                },
                {"type": "subTitle", "text": "The next section"},
                {
                    "type": "paragraph",
                    "paragraphNumber": 2,
                    "text": "Second.<a>1</a>",
                    "crossLinks": {"1": {"text": "A different document."}},
                    "backLinks": [1],
                },
                {"type": "richText", "text": "Its continuation."},
            ]
        )
        rows, report = normalize_dataset(data)
        self.assertEqual(rows[0]["text"], "First.\n\nA quotation.")
        self.assertEqual(rows[1]["text"], "Second.\n\nIts continuation.")
        self.assertEqual(plain(rows[1]["content"]["before"][0]["children"]), "The next section")
        self.assertNotEqual(
            rows[0]["content"]["notes"][0]["id"], rows[1]["content"]["notes"][0]["id"]
        )
        self.assertEqual(report["unplaced_notes"], [])
        self.assertEqual(rows[1]["content"]["cross_references"], [1])

    def test_range_continuations_and_plain_citations(self):
        nodes = parse_inline('<a data-book="Rev" data-text="Rev 21:1-22"></a>:5; cf. Heb 3-4:11.')
        self.assertEqual(
            [n["reference"] for n in nodes if n["type"] == "bible"],
            ["Revelation 21:1-22:5", "Hebrews 3-4:11"],
        )
        nodes = parse_inline('<a data-book="Ps" data-text="Pss 6:3"></a>; 38; 39:9, 12.')
        self.assertEqual(nodes[0]["reference"], "Psalm 6:3, 38, 39:9, 39:12")
        self.assertEqual(plain(nodes), "Pss 6:3; 38; 39:9, 12.")

    def test_ambiguous_reference_is_preserved_not_guessed(self):
        nodes = parse_inline('<a data-book="1John" data-text="1 Jn 2:20:27"></a>')
        self.assertIsNone(nodes[0]["reference"])
        self.assertEqual(nodes[0]["text"], "1 Jn 2:20:27")

    def test_editorial_material_is_excluded_but_intro_and_lists_survive(self):
        rows, report = normalize_dataset(
            corpus(
                [
                    {"type": "quoteParagraph", "text": "An unnumbered introduction."},
                    {"type": "subTitle", "text": "Sources from Scripture and the Church"},
                    {"type": "table", "text": "<tr><td>Editorial</td></tr>"},
                    {"type": "subTitle", "text": "I. The opening"},
                    {"type": "paragraph", "paragraphNumber": 1, "text": "Body."},
                    {"type": "numberedList", "text": "<li>One.</li><li>Two.</li>"},
                ]
            )
        )
        self.assertEqual(report["excluded_editorial_blocks"], 2)
        self.assertIn("An unnumbered introduction.", str(rows[0]["content"]["before"]))
        self.assertEqual(rows[0]["content"]["blocks"][1]["kind"], "ordered_list")

    def test_incomplete_corpus_unknown_markup_and_dangling_markers_fail(self):
        with self.assertRaises(ValueError):
            normalize_dataset([{"book": "prologue", "blocks": []}])
        with self.assertRaises(ValueError):
            parse_inline('<img src="https://example.test">')
        with self.assertRaises(ValueError):
            parse_inline("Body<a>99</a>")

    def test_extracts_data_without_executing_script(self):
        data = [{"type": "extra", "book": "prologue", "blocks": []}]
        encoded = json.dumps(data, separators=(",", ":"))
        self.assertEqual(extract_dataset("throw Error();JSON.parse('" + encoded + "');"), data)


class CatechismReferenceAPITests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user("references")
        self.client.force_login(self.user)
        self.row = CatechismParagraph.objects.create(
            number=1,
            text="Original body.",
            source_url="https://example.test",
            content={"schema": 1, "notes": []},
        )
        CatechismDay.objects.create(number=1, part="Prologue", paragraph_start=1, paragraph_end=1)
        for n in [9, 10]:
            Verse.objects.create(book="Ephesians", chapter=4, number=n, text=f"Verse {n}")

    def test_ccc_preview_is_independent_of_day_and_has_context(self):
        data = self.client.get("/api/catechism/paragraphs/1").json()
        self.assertEqual(data["paragraph"]["content"]["schema"], 1)
        self.assertIn("#ccc-1", data["context_url"])
        self.assertEqual(self.client.get("/api/catechism/paragraphs/2866").status_code, 404)

    def test_bible_preview_ranges_partial_and_input_limits(self):
        data = self.client.get(
            "/api/catechism/bible-reference", {"reference": "Ephesians 4:9-10"}
        ).json()
        self.assertEqual([v["verse"] for v in data["passage"]["groups"][0]["verses"]], [9, 10])
        self.assertFalse(data["passage"]["groups"][0]["missing"])
        data = self.client.get(
            "/api/catechism/bible-reference", {"reference": "Ephesians 4:9-11"}
        ).json()
        self.assertTrue(data["passage"]["groups"][0]["missing"])
        for value in ["https://example.test", "Genesis 1-150", "John 3:16-2", "x" * 241]:
            self.assertEqual(
                self.client.get("/api/catechism/bible-reference", {"reference": value}).status_code,
                422,
            )

    def test_authentication_is_required(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/catechism/paragraphs/1").status_code, 401)
        self.assertEqual(
            self.client.get("/api/catechism/bible-reference?reference=John%203:16").status_code, 401
        )

    def test_import_preview_apply_and_no_ai_by_default(self):
        data = corpus()
        with TemporaryDirectory() as folder:
            source, report, backup = [
                Path(folder) / n for n in ["source.json", "report.json", "backup.json"]
            ]
            source.write_text(
                json.dumps(
                    {
                        "data": data,
                        "provenance": {"sha256": source_digest(data), "source": "Ascension"},
                    }
                )
            )
            args = {"source": source, "report": report, "stdout": StringIO()}
            call_command("import_catechism", **args)
            self.assertEqual(CatechismParagraph.objects.count(), 1)
            self.assertFalse(json.loads(report.read_text())["applied"])
            with self.assertRaises(CommandError):
                call_command("import_catechism", apply=True, **args)
            with patch("study.management.commands.import_catechism.index_catechism") as index:
                call_command("import_catechism", apply=True, backup=backup, **args)
                index.assert_not_called()
            self.assertEqual(CatechismParagraph.objects.count(), 2865)
            self.assertEqual(
                json.loads(backup.read_text())["paragraphs"][0]["text"], "Original body."
            )
            with self.assertRaises(CommandError):
                call_command("import_catechism", apply=True, backup=backup, **args)
            # Repeated previews are idempotent for the same snapshot.
            call_command("import_catechism", **args)
            self.assertEqual(json.loads(report.read_text())["changes"], [])
            # Rollback must also undo an initial import into a partial corpus.
            call_command(
                "import_catechism",
                source=backup,
                report=report,
                restore=True,
                apply=True,
                backup=Path(folder) / "before-restore.json",
                stdout=StringIO(),
            )
            self.assertEqual(CatechismParagraph.objects.count(), 1)
            self.assertEqual(
                CatechismParagraph.objects.get(pk=1).source_url, "https://example.test"
            )
