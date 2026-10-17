import type { PlanDay } from "./types";

export type PreviousReading = { day: number; index: number; reference: string };

/** The book a plan reading starts in, e.g. "1 Samuel 3-4" → "1 Samuel". */
export function readingBook(reference: string) {
  return reference
    .split(",")[0]
    .trim()
    .replace(/\s+\d[\d:\-–\s]*$/, "");
}

/** Whether a plan reading opens its book; single-chapter books have no number. */
export function readingOpensBook(reference: string) {
  const start = /^(\d+)(?::(\d+))?/.exec(
    reference.slice(readingBook(reference).length).trim(),
  );
  return !start || (start[1] === "1" && (start[2] || "1") === "1");
}

/**
 * For each of a day's readings, the most recent earlier reading of that book.
 * A book's first verse has nothing to recall, and each psalm stands alone.
 */
export function previousReadings(
  days: PlanDay[],
  dayNumber: number,
  references: string[],
): (PreviousReading | null)[] {
  const earlier = days
    .filter((day) => day.number < dayNumber)
    .sort((a, b) => b.number - a.number);
  return references.map((reference) => {
    const book = readingBook(reference);
    if (book === "Psalm" || readingOpensBook(reference)) return null;
    for (const day of earlier) {
      const index = day.readings.findIndex((r) => readingBook(r) === book);
      if (index >= 0)
        return { day: day.number, index, reference: day.readings[index] };
    }
    return null;
  });
}
