import { describe, expect, it } from "vitest";
import {
  previousReadings,
  readingBook,
  readingChapter,
} from "./previousReading";
import type { PlanDay } from "./types";

const day = (number: number, readings: string[]): PlanDay => ({
  number,
  readings,
  era: "",
  color: "",
  completed_at: null,
  episode: null,
});

describe("readingBook", () => {
  it("strips chapters and verses but keeps numbered book names", () => {
    expect(readingBook("Genesis 1-2")).toBe("Genesis");
    expect(readingBook("1 Samuel 3")).toBe("1 Samuel");
    expect(readingBook("Proverbs 1:1-7")).toBe("Proverbs");
    expect(readingBook("Song of Solomon 1")).toBe("Song of Solomon");
    expect(readingBook("Esther 15, 6-7")).toBe("Esther");
    expect(readingBook("2 John, 3 John")).toBe("2 John");
    expect(readingBook("Jude")).toBe("Jude");
  });
});

describe("readingChapter", () => {
  it("reads the opening chapter, treating single-chapter books as 1", () => {
    expect(readingChapter("Genesis 3-4")).toBe(3);
    expect(readingChapter("1 Samuel 12")).toBe(12);
    expect(readingChapter("Proverbs 1:8-19")).toBe(1);
    expect(readingChapter("Esther 15, 6-7")).toBe(15);
    expect(readingChapter("Jude")).toBe(1);
  });
});

describe("previousReadings", () => {
  const days = [
    day(51, ["Exodus 39-40", "Leviticus 27", "Psalm 84"]),
    day(53, ["Numbers 2", "Deuteronomy 2", "Psalm 86"]),
    day(52, ["Numbers 1", "Deuteronomy 1", "Psalm 85"]),
  ];

  it("finds the latest earlier day reading the same book", () => {
    expect(previousReadings(days, 53, ["Numbers 2", "Deuteronomy 2"])).toEqual(
      [
        { day: 52, index: 0, reference: "Numbers 1" },
        { day: 52, index: 1, reference: "Deuteronomy 1" },
      ],
    );
  });

  it("skips chapter 1 and psalms", () => {
    expect(
      previousReadings(days, 53, ["Numbers 1:5-9", "Psalm 86"]),
    ).toEqual([null, null]);
  });
});
