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


def chapter(reference, book, number, *texts):
    return {
        "reference": reference,
        "groups": [
            {
                "book": book,
                "verses": [
                    {"chapter": number, "verse": verse, "text": text}
                    for verse, text in enumerate(texts, start=1)
                ],
            }
        ],
    }


def scripture(*texts, start=0, step=5):
    transcript = [
        {
            "id": index,
            "start": start + index * step,
            "end": start + index * step + step - 1,
            "text": text,
        }
        for index, text in enumerate(texts)
    ]
    return transcript, [{"id": segment["id"], "kind": "scripture"} for segment in transcript]


ESTHER_11 = chapter(
    "Esther 11-12",
    "Esther",
    11,
    "In the fourth year of the reign of Ptolemy and Cleopatra Dositheus who said that he was a priest brought the letter",
    "In the second year of the reign of Artaxerxes the Great on the first day of Nisan Mordecai had a dream",
    "He was a Jew dwelling in the city of Susa a great man serving in the court of the king",
)
NEHEMIAH_10 = chapter(
    "Nehemiah 10",
    "Nehemiah",
    10,
    "Those who set their seal are Nehemiah the governor the son of Hacaliah Zedekiah Seraiah Azariah Jeremiah",
    "Pashhur Amariah Malchijah Hattush Shebaniah Malluch Harim Meremoth Obadiah Daniel Ginnethon Baruch",
)
PSALM_19 = chapter(
    "Psalm 19",
    "Psalm",
    19,
    "The heavens are telling the glory of God and the firmament proclaims his handiwork day to day pours forth speech",
)


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

    def test_anchors_on_a_later_verse_when_the_first_is_not_read(self):
        transcript, labels = scripture(
            "The Book of Esther chapter eleven Mordecai's dream.",
            "In the second year of the reign of Artaxerxes the Great, on the first day of Nisan,",
            "Mordecai had a dream. He was a Jew dwelling in the city of Susa,",
            "a great man serving in the court of the king.",
        )

        cues = align_scripture_audio([ESTHER_11], transcript, labels)

        self.assertEqual(
            [(cue["reference"], cue["start"]) for cue in cues], [("Esther 11-12", 0.0)]
        )

    def test_finds_an_unmatchable_name_list_by_its_spoken_chapter_heading(self):
        transcript, labels = scripture(
            "Chapter ten.",
            "Those were sealed by Nehemiah, governor, son of Akalaya, Sedekaya,",
            "Seraya, Asaraya, Jeramaya, Pashar, Amaraya, Malkaya, Hatush, Shabanaya,",
            "Psalm nineteen.",
            "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
            "Day to day pours forth speech.",
        )

        cues = align_scripture_audio([NEHEMIAH_10, PSALM_19], transcript, labels)

        self.assertEqual(
            [(cue["reference"], cue["start"], cue["end"]) for cue in cues],
            [("Nehemiah 10", 0.0, 14.0), ("Psalm 19", 15.0, 29.0)],
        )

    def test_never_takes_a_heading_from_another_reading_or_a_longer_number(self):
        transcript, labels = scripture(
            "Psalm nineteen.",
            "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
            "Day to day pours forth speech.",
            "The Book of Proverbs, chapter ten.",
            "Chapter one hundred.",
        )

        cues = align_scripture_audio([PSALM_19, NEHEMIAH_10], transcript, labels)
        self.assertEqual([cue["reference"] for cue in cues], ["Psalm 19"])

        transcript, labels = scripture(
            "Chapter ten.",
            "Unrelated words.",
            "Psalm nineteen.",
            "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
        )
        cues = align_scripture_audio([PSALM_19, NEHEMIAH_10], transcript, labels)
        self.assertEqual([cue["reference"] for cue in cues], ["Psalm 19"])

        transcript, labels = scripture("Chapter one hundred and ten.", "Unrelated words.")
        self.assertEqual(
            align_scripture_audio(
                [chapter("Psalm 100", "Psalm", 100, "Make a joyful noise")], transcript, labels
            ),
            [],
        )

    def test_a_later_verbatim_quotation_does_not_displace_the_reading(self):
        sirach = chapter(
            "Sirach 30",
            "Sirach",
            30,
            "He who loves his son will whip him often in order that he may rejoice at the way he turns out",
        )
        transcript, labels = scripture(
            "He who loves his son will whip him often in order that he may rejoice",
            "at the way he turns out.",
            "Psalm nineteen.",
            "The heavens are telling the glory of God and the firmament proclaims his handiwork.",
            "He who loves his son will whip him often in order that he may rejoice",
            "at the way he turns out.",
        )

        cues = align_scripture_audio([sirach, PSALM_19], transcript, labels)

        self.assertEqual(
            [(cue["reference"], cue["start"]) for cue in cues],
            [("Sirach 30", 0.0), ("Psalm 19", 10.0)],
        )

    def test_a_parallel_passage_does_not_claim_the_previous_reading(self):
        text = "Rehoboam went to Shechem for all Israel had come to Shechem to make him king"
        kings = chapter("1 Kings 12", "1 Kings", 12, text + " and when Jeroboam heard of it")
        chronicles = chapter(
            "2 Chronicles 10", "2 Chronicles", 10, text + " and when Jeroboam heard"
        )
        transcript, labels = scripture(
            "The first book of Kings chapter twelve.",
            "Rehoboam went to Shechem, for all Israel had come to Shechem",
            "to make him king. And when Jeroboam heard of it,",
            "The second book of Chronicles chapter ten.",
            "Rehoboam went to Shechem, for all Israel had come to Shechem",
            "to make him king. And when Jeroboam heard",
        )

        cues = align_scripture_audio([kings, chronicles], transcript, labels)

        self.assertEqual(
            [(cue["reference"], cue["start"]) for cue in cues],
            [("1 Kings 12", 0.0), ("2 Chronicles 10", 15.0)],
        )
