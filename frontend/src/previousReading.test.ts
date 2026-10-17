import { describe, expect, it } from "vitest";
import {
  previousReadings,
  readingBook,
  readingOpensBook,
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

describe("readingOpensBook", () => {
  it("is true only for readings starting at chapter 1, verse 1", () => {
    expect(readingOpensBook("Genesis 1-2")).toBe(true);
    expect(readingOpensBook("Proverbs 1:1-7")).toBe(true);
    expect(readingOpensBook("Jude")).toBe(true);
    expect(readingOpensBook("1 Samuel 1")).toBe(true);
    expect(readingOpensBook("Proverbs 1:8-19")).toBe(false);
    expect(readingOpensBook("Genesis 3-4")).toBe(false);
    expect(readingOpensBook("1 Samuel 12")).toBe(false);
    expect(readingOpensBook("Esther 15, 6-7")).toBe(false);
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

  it("skips a book's first verse and psalms", () => {
    expect(
      previousReadings(days, 53, ["Numbers 1", "Numbers 1:5-9", "Psalm 86"]),
    ).toEqual([null, { day: 52, index: 0, reference: "Numbers 1" }, null]);
  });
});
