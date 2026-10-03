import { describe, expect, it } from "vitest";
import { buildSelectionQuestion } from "./ReadingCapture";

describe("buildSelectionQuestion", () => {
  it("keeps the selected quote and citation together for Ask", () => {
    expect(
      buildSelectionQuestion({
        quote: "The light shines in the darkness.",
        citation: "John 1:5",
        sourceUrl: "/day/1/reader?tab=scripture#verse-john-1-5",
      }),
    ).toBe(
      "In John 1:5, I highlighted:\n\n“The light shines in the darkness.”\n\n",
    );
  });

  it("keeps a long selection within the Ask question limit", () => {
    const question = buildSelectionQuestion({
      quote: "word ".repeat(1000),
      citation: "Full transcript · 12:03",
      sourceUrl: "/day/1?tab=transcript#segment-12",
    });

    expect(question.length).toBeLessThan(800);
    expect(question).toContain("…”");
  });
});
