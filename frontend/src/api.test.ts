import { describe, it, expect } from "vitest";
import { episodeTitle, time } from "./api";
describe("episode display", () => {
  it("preserves supplementary titles while removing the dated edition suffix", () => {
    expect(episodeTitle("Day 1: In the Beginning (2025)")).toBe(
      "In the Beginning",
    );
    expect(
      episodeTitle("Introduction to the Return (with Jeff Cavins) - 2025"),
    ).toBe("Introduction to the Return (with Jeff Cavins)");
    expect(
      episodeTitle("BONUS: Preparing for the Bible in a Year Journey"),
    ).toBe("BONUS: Preparing for the Bible in a Year Journey");
  });
  it("formats timestamps without losing long-episode minutes", () => {
    expect(time(3601.9)).toBe("60:01");
    expect(time(0)).toBe("0:00");
  });
});
