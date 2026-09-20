from django.test import SimpleTestCase

from .scripture_audio import align_scripture_audio


def passage(reference, book, text):
    return {
        "reference": reference,
        "groups": [
            {
                "book": book,
                "verses": [{"chapter": 1, "verse": 1, "text": text}],
            }
        ],
    }


class ScriptureAudioAlignmentTests(SimpleTestCase):
    def test_aligns_passages_and_includes_spoken_headings(self):
        passages = [
            passage(
                "Genesis 1-2",
                "Genesis",
                "In the beginning God created the heavens and the earth. The earth was without form and void.",
            ),
            passage(
                "Psalm 19",
                "Psalm",
                "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
            ),
        ]
        transcript = [
            {"id": 0, "start": 10, "end": 11, "text": "Genesis chapter one."},
            {
                "id": 1,
                "start": 12,
                "end": 16,
                "text": "In the beginning God created the heavens and the earth.",
            },
            {
                "id": 2,
                "start": 16,
                "end": 20,
                "text": "The earth was without form and void.",
            },
            {"id": 3, "start": 30, "end": 32, "text": "Psalm nineteen."},
            {
                "id": 4,
                "start": 33,
                "end": 38,
                "text": "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
            },
            {"id": 5, "start": 40, "end": 44, "text": "Teaching begins here."},
        ]
        classification = [
            {"id": 0, "kind": "scripture"},
            {"id": 1, "kind": "scripture"},
            {"id": 2, "kind": "scripture"},
            {"id": 3, "kind": "scripture"},
            {"id": 4, "kind": "scripture"},
            {"id": 5, "kind": "commentary"},
        ]

        self.assertEqual(
            align_scripture_audio(passages, transcript, classification),
            [
                {
                    "passage_index": 0,
                    "reference": "Genesis 1-2",
                    "start": 10.0,
                    "end": 20.0,
                    "confidence": 1.0,
                },
                {
                    "passage_index": 1,
                    "reference": "Psalm 19",
                    "start": 30.0,
                    "end": 38.0,
                    "confidence": 1.0,
                },
            ],
        )

    def test_omits_unreliable_matches(self):
        self.assertEqual(
            align_scripture_audio(
                [passage("Genesis 1", "Genesis", "In the beginning God created")],
                [{"id": 1, "start": 0, "end": 4, "text": "Completely unrelated words"}],
                [{"id": 1, "kind": "scripture"}],
            ),
            [],
        )
