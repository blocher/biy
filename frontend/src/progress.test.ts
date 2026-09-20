import { describe, expect, it } from "vitest";
import type { Library, PlanDay } from "./types";
import { progressStats } from "./progress";

const days = Array.from({ length: 365 }, (_, index): PlanDay => ({
  number: index + 1,
  readings: [`Reading ${index + 1}`],
  era: "Test era",
  color: "#123456",
  completed_at: null,
  episode: null,
}));

function library(completions: Array<[number, string]>): Library {
  const completed = new Map(completions);
  return {
    days: days.map((day) => ({
      ...day,
      completed_at: completed.get(day.number) || null,
    })),
    extras: [],
    completed: completions.length,
    next_day: completions.length + 1,
  };
}

describe("progressStats", () => {
  it("starts an on-schedule count on the first completed day", () => {
    const stats = progressStats(
      library([[1, "2026-03-10T18:00:00Z"]]),
      "first-completion",
      new Date(2026, 2, 10),
    );
    expect(stats.scheduleDelta).toBe(0);
    expect(stats.lastCompleted?.number).toBe(1);
    expect(stats.completedPercent).toBe(0.3);
    expect(stats.remainingPercent).toBe(99.7);
  });

  it("counts completed days against a January 1 start", () => {
    const stats = progressStats(
      library([
        [1, "2026-01-01T18:00:00Z"],
        [2, "2026-01-02T18:00:00Z"],
      ]),
      "january-1",
      new Date(2026, 0, 5),
    );
    expect(stats.scheduleDelta).toBe(-3);
    expect(stats.lastCompleted?.number).toBe(2);
  });

  it("does not count supplementary episodes", () => {
    const data = library([]);
    data.extras = [
      {
        id: 9,
        title: "Extra",
        day: null,
        era: null,
        color: "#123456",
        duration: 60,
        status: "ready",
        has_audio: true,
        source_date: "2026-01-01",
        published_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T12:00:00Z",
      },
    ];
    expect(progressStats(data, "first-completion").completed).toBe(0);
  });
});

it("uses the shared date and counts calendar days across daylight saving", () => {
  expect(
    progressStats(
      library([[1, "2026-03-07T18:00:00Z"]]),
      "leaderboard",
      new Date(2026, 2, 9),
      "2026-03-07",
    ).scheduleDelta,
  ).toBe(-2);
});
it("does not expect progress before the group starts", () => {
  expect(
    progressStats(
      library([]),
      "leaderboard",
      new Date(2026, 8, 20),
      "2026-10-01",
    ).scheduleDelta,
  ).toBe(0);
});
it("caps the expected number of days at 365", () => {
  expect(
    progressStats(
      library([[1, "2024-01-01T18:00:00Z"]]),
      "leaderboard",
      new Date(2026, 8, 20),
      "2024-01-01",
    ).scheduleDelta,
  ).toBe(-364);
});
it("leaves a personal schedule unstarted until a first completion", () => {
  expect(
    progressStats(library([]), "first-completion").scheduleDelta,
  ).toBeNull();
});
