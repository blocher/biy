import type { Episode, Library, PlanDay } from "./types";

export type PlanEntry =
  | { kind: "day"; key: string; day: PlanDay }
  | { kind: "extra"; key: string; episode: Episode };

function publishedAt(entry: PlanEntry) {
  if (entry.kind === "extra") return Date.parse(entry.episode.published_at);
  if (entry.day.episode) return Date.parse(entry.day.episode.published_at);

  // The plan is a 2025 day-by-day sequence. This fallback is only used before
  // a daily episode has been catalogued; imported episodes use their exact RSS
  // publication timestamps below.
  return Date.UTC(2025, 0, entry.day.number);
}

function episodeId(entry: PlanEntry) {
  if (entry.kind === "extra") return entry.episode.id;
  return entry.day.episode?.id ?? Number.MAX_SAFE_INTEGER;
}

/** Combine daily and supplementary episodes in the publisher's exact order. */
export function planEntries(library: Library): PlanEntry[] {
  const entries: PlanEntry[] = [
    ...library.days.map((day): PlanEntry => ({
      kind: "day",
      key: `day-${day.number}`,
      day,
    })),
    ...library.extras.map((episode): PlanEntry => ({
      kind: "extra",
      key: `episode-${episode.id}`,
      episode,
    })),
  ];

  return entries.sort(
    (a, b) => publishedAt(a) - publishedAt(b) || episodeId(a) - episodeId(b),
  );
}
