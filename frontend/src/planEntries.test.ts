import { describe, expect, it } from "vitest";
import type { Episode, Library, PlanDay } from "./types";
import { planEntries, nextPlanEntry, followingPlanEntry } from "./planEntries";

const episode = (
  id: number,
  published_at: string,
  day: number | null,
): Episode => ({
  id,
  title: day ? `Day ${day}` : `Supplement ${id}`,
  day,
  era: "Early World",
  color: "#64b6bd",
  duration: 1200,
  status: "complete",
  has_audio: true,
  source_date: published_at.slice(0, 10),
  published_at,
});

const day = (number: number, ep: Episode): PlanDay => ({
  number,
  readings: [`Reading ${number}`],
  era: "Early World",
  color: "#64b6bd",
  completed_at: null,
  episode: ep,
});

describe("planEntries", () => {
  it("places supplementary episodes between the correct days in publication order", () => {
    const day1 = episode(1, "2025-01-01T08:00:00Z", 1);
    const extra = episode(2, "2025-01-01T18:00:00Z", null);
    const day2 = episode(3, "2025-01-02T08:00:00Z", 2);
    const library: Library = {
      days: [day(1, day1), day(2, day2)],
      extras: [extra],
      completed: 0,
      next_day: 1,
    };

    expect(planEntries(library).map((entry) => entry.key)).toEqual([
      "day-1",
      "episode-2",
      "day-2",
    ]);
  });

  it("keeps multiple episodes with the same timestamp in feed id order", () => {
    const first = episode(8, "2025-01-03T08:00:00Z", null);
    const second = episode(9, "2025-01-03T08:00:00Z", null);
    const library: Library = {
      days: [],
      extras: [second, first],
      completed: 0,
      next_day: null,
    };

    expect(planEntries(library).map((entry) => entry.key)).toEqual([
      "episode-8",
      "episode-9",
    ]);
  });

  it("places Catechism bonus episodes after all 365 days", () => {
    const day1 = episode(1, "2025-01-01T08:00:00Z", 1);
    const day365 = episode(365, "2025-12-31T08:00:00Z", 365);
    const bonus = episode(366, "2025-06-01T08:00:00Z", null);
    const library: Library = {
      edition: "catechism",
      days: [day(1, day1), day(365, day365)],
      extras: [bonus],
      completed: 0,
      next_day: 1,
    };

    expect(planEntries(library).map((entry) => entry.key)).toEqual([
      "day-1",
      "day-365",
      "episode-366",
    ]);
  });
});

it("continues an incomplete supplement before the next day and skips it when complete", () => {
  const first = day(1, episode(1, "2025-01-01T08:00:00Z", 1));
  first.completed_at = "2026-01-01T12:00:00Z";
  const extra = episode(2, "2025-01-01T18:00:00Z", null);
  const data: Library = {
    days: [first, day(2, episode(3, "2025-01-02T08:00:00Z", 2))],
    extras: [extra],
    completed: 1,
    next_day: 2,
  };
  expect(nextPlanEntry(data)?.key).toBe("episode-2");
  extra.completed_at = "2026-01-01T13:00:00Z";
  expect(nextPlanEntry(data)?.key).toBe("day-2");
  data.days[1].completed_at = first.completed_at;
  expect(nextPlanEntry(data)).toBeUndefined();
});

it("advances from a supplement to the following reading, including at the end", () => {
  const data: Library = {
    days: [day(1, episode(1, "2025-01-01T08:00:00Z", 1)), day(2, episode(3, "2025-01-02T08:00:00Z", 2))],
    extras: [episode(2, "2025-01-01T18:00:00Z", null)],
    completed: 0, next_day: 1,
  };
  expect(followingPlanEntry(data, "day-1")?.key).toBe("episode-2");
  expect(followingPlanEntry(data, "episode-2")?.key).toBe("day-2");
  expect(followingPlanEntry(data, "day-2")).toBeUndefined();
  expect(followingPlanEntry(data, "episode-missing")).toBeUndefined();
});
