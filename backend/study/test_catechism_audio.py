from django.test import SimpleTestCase

from .catechism_audio import align_catechism_audio


class CatechismAudioAlignmentTests(SimpleTestCase):
    first = {
        "number": 1,
        "text": "God infinitely perfect and blessed in himself created man freely.",
    }
    second = {"number": 2, "text": "The apostles went forth and preached everywhere with the Lord."}

    def align(self, segments, kinds=None, paragraphs=None):
        return align_catechism_audio(
            paragraphs or [self.first, self.second],
            segments,
            [
                {"id": segment["id"], "kind": (kinds or {}).get(segment["id"], "catechism")}
                for segment in segments
            ],
        )

    def test_paragraph_boundaries_and_spoken_numbers_inside_segments(self):
        cues = self.align(
            [
                {"id": 1, "start": 10, "end": 14, "text": "Paragraph one. God infinitely perfect"},
                {
                    "id": 2,
                    "start": 14,
                    "end": 20,
                    "text": "and blessed in himself created man freely.",
                },
                {"id": 3, "start": 20, "end": 25, "text": "Two. " + self.second["text"]},
                {"id": 4, "start": 25, "end": 35, "text": "Let us reflect on these paragraphs."},
            ],
            {4: "commentary"},
        )
        self.assertEqual([(cue["start"], cue["end"]) for cue in cues], [(10, 20), (20, 25)])
        self.assertEqual([cue["paragraph_number"] for cue in cues], [1, 2])
        self.assertTrue(all(cue["confidence"] == 1 for cue in cues))

    def test_shared_segment_can_contain_multiple_paragraphs(self):
        cues = self.align(
            [
                {"id": 1, "start": 10, "end": 20, "text": self.first["text"] + self.second["text"]},
            ]
        )
        self.assertEqual([cue["paragraph_number"] for cue in cues], [1, 2])
        self.assertEqual([(cue["start"], cue["end"]) for cue in cues], [(10, 20), (10, 20)])

    def test_unmatched_paragraph_does_not_extend_previous_cue(self):
        cues = self.align(
            [
                {"id": 1, "start": 10, "end": 20, "text": self.first["text"]},
                {"id": 2, "start": 20, "end": 25, "text": "An unrelated reading follows here."},
            ]
        )
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["end"], 20)

    def test_does_not_bridge_commentary_or_include_mixed_segments(self):
        self.assertEqual(
            self.align(
                [
                    {"id": 1, "start": 10, "end": 15, "text": "God infinitely perfect and blessed"},
                    {"id": 2, "start": 15, "end": 20, "text": "An explanation goes here."},
                    {"id": 3, "start": 20, "end": 25, "text": "in himself created man freely."},
                    {"id": 4, "start": 25, "end": 35, "text": self.second["text"]},
                ],
                {2: "commentary", 4: "mixed"},
            ),
            [],
        )

    def test_rejects_missing_ending_and_other_edition_reading(self):
        self.assertEqual(
            self.align(
                [
                    {"id": 1, "start": 10, "end": 20, "text": "God infinitely perfect and blessed"},
                    {"id": 2, "start": 20, "end": 25, "text": self.second["text"]},
                ],
                {2: "scripture"},
            ),
            [],
        )

    def test_repeated_first_word_does_not_capture_previous_segment(self):
        cues = self.align(
            [
                {"id": 1, "start": 5, "end": 9, "text": "God is with us."},
                {"id": 2, "start": 10, "end": 20, "text": self.first["text"]},
            ]
        )
        self.assertEqual(cues[0]["start"], 10)
