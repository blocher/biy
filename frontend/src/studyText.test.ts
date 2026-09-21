import { describe, expect, it } from "vitest";
import type { Episode, Segment } from "./types";
import {
  audioSpanContaining,
  audioSpanDuration,
  groupTranscriptSegments,
  mergeAudioSpans,
  plainOutlineTitle,
  supplementarySpeakerNames,
} from "./studyText";

const segment = (
  id: number,
  speaker: string,
  text: string,
  start = id * 2,
): Segment => ({ id, start, end: start + 2, speaker, text });

describe("groupTranscriptSegments", () => {
  it("combines short daily transcription fragments into readable paragraphs", () => {
    const fragments = Array.from({ length: 9 }, (_, id) =>
      segment(
        id,
        "Voice A · part 1",
        `Fragment ${id} has several useful words.`,
      ),
    );

    const paragraphs = groupTranscriptSegments(fragments, false);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].segmentIds).toEqual(fragments.map(({ id }) => id));
  });

  it("keeps supplementary speaker turns separate", () => {
    const paragraphs = groupTranscriptSegments(
      [
        segment(0, "Voice A · part 1", "Welcome."),
        segment(1, "Voice A · part 1", "Let us begin."),
        segment(2, "Voice B · part 1", "Thank you."),
      ],
      true,
    );

    expect(paragraphs.map(({ text }) => text)).toEqual([
      "Welcome. Let us begin.",
      "Thank you.",
    ]);
  });

  it("starts a new paragraph before a combined paragraph becomes too long", () => {
    const longFragment = Array(80).fill("word").join(" ");
    const paragraphs = groupTranscriptSegments(
      [
        segment(0, "Voice A", longFragment),
        segment(1, "Voice A", longFragment),
      ],
      false,
    );

    expect(paragraphs).toHaveLength(2);
  });

  it("honors AI-selected paragraph boundaries", () => {
    const second = segment(1, "Voice A", "A new thought begins here.");
    second.paragraph_break_before = true;

    const paragraphs = groupTranscriptSegments(
      [segment(0, "Voice A", "The first thought ends here."), second],
      false,
    );

    expect(paragraphs.map(({ text }) => text)).toEqual([
      "The first thought ends here.",
      "A new thought begins here.",
    ]);
  });
});

describe("supplementarySpeakerNames", () => {
  it("maps diarized voices only when outline metadata identifies them consistently", () => {
    const episode = {
      transcript: [
        segment(0, "Voice A · part 1", "Welcome."),
        segment(1, "Voice B · part 1", "Thank you."),
      ],
      outline: [
        {
          heading: "Commentary",
          title: "Opening",
          segment_id: 0,
          start: 0,
          speaker: "Fr. Mike",
        },
        {
          heading: "Commentary",
          title: "Response",
          segment_id: 1,
          start: 2,
          speaker: "Jeff Cavins",
        },
      ],
    } as Episode;

    expect([...supplementarySpeakerNames(episode)]).toEqual([
      ["Voice A · part 1", "Fr. Mike Schmitz"],
      ["Voice B · part 1", "Jeff Cavins"],
    ]);
  });
});

describe("plainOutlineTitle", () => {
  it("removes generated Markdown segment links from outline titles", () => {
    expect(
      plainOutlineTitle("[Receiving the Bible as one story](#segment-58)"),
    ).toBe("Receiving the Bible as one story");
  });

  it("leaves an ordinary title unchanged", () => {
    expect(plainOutlineTitle("The Bible Timeline")).toBe("The Bible Timeline");
  });
});

describe("mergeAudioSpans", () => {
  it("joins nearly adjacent commentary spans and skips invalid ranges", () => {
    const spans = mergeAudioSpans([
      { start: 10, end: 20 },
      { start: 20.2, end: 30 },
      { start: 40, end: 50 },
      { start: 12, end: 8 },
    ]);

    expect(spans).toEqual([
      { start: 10, end: 30 },
      { start: 40, end: 50 },
    ]);
    expect(audioSpanDuration(spans)).toBe(30);
    expect(audioSpanContaining(spans, 22)?.start).toBe(10);
    expect(audioSpanContaining(spans, 35)).toBeUndefined();
  });
});
