import type { CommentaryEntry, CommentaryResponse } from "./types";

export const COMMENTARY_MANIFEST_URL = "/api/offline-commentaries/manifest";
export const READING_CACHE_PREFIX = "biy-reading-v1-";

type Range = { reference: string; book: string; start: number; end: number };
export type CommentaryManifest = {
  version: string;
  books: string[];
  days: Record<string, { readings: string[]; ranges: Range[] }>;
  filters: CommentaryResponse["filters"];
  matching_notes: string[];
};

export function commentaryBookUrl(book: string, version: string) {
  return `/api/offline-commentaries/books/${encodeURIComponent(book)}?v=${encodeURIComponent(version)}`;
}

export async function offlineCommentaries(
  user: string,
  query: URLSearchParams,
): Promise<CommentaryResponse | null> {
  if (!("caches" in window) || !("DecompressionStream" in window)) return null;
  const cache = await caches.open(
    READING_CACHE_PREFIX + encodeURIComponent(user),
  );
  const saved = await cache.match(COMMENTARY_MANIFEST_URL);
  if (!saved) return null;
  const manifest = (await saved.json()) as CommentaryManifest;
  const dayNumber = Number(query.get("day"));
  const day = manifest.days[String(dayNumber)];
  if (!day) return null;
  const rows: CommentaryEntry[] = [];
  for (const book of new Set(day.ranges.map((range) => range.book))) {
    if (!manifest.books.includes(book)) continue;
    const response = await cache.match(
      commentaryBookUrl(book, manifest.version),
    );
    if (!response?.body) return null;
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const bookRows = JSON.parse(
      await new Response(stream).text(),
    ) as CommentaryEntry[];
    for (const row of bookRows) {
      const matched = [
        ...new Set(
          day.ranges
            .filter(
              (range) =>
                range.book === row.book &&
                row.location_end >= range.start &&
                row.location_start <= range.end,
            )
            .map((range) => range.reference),
        ),
      ];
      if (matched.length) rows.push({ ...row, matched_readings: matched });
    }
  }
  const fromYear = query.get("from_year");
  const toYear = query.get("to_year");
  const category = query.get("category");
  const filtered = rows.filter(
    (row) =>
      (fromYear === null || row.year >= Number(fromYear)) &&
      (toYear === null || row.year <= Number(toYear)) &&
      (!category || row.author_metadata.category === category),
  );
  filtered.sort((a, b) => a.year - b.year || a.database_id - b.database_id);
  const total = filtered.length;
  const pageSize = Number(query.get("page_size")) || 36;
  let page = Number(query.get("page")) || 1;
  let offset = (page - 1) * pageSize;
  let focusedPage = false;
  const focus = Number(query.get("focus"));
  if (focus && page === 1) {
    const position = filtered.findIndex((row) => row.database_id === focus);
    if (position >= 0) {
      page = Math.floor(position / pageSize) + 1;
      offset = 0;
      focusedPage = true;
    }
  }
  const commentaries = filtered.slice(
    offset,
    offset + (focusedPage ? page * pageSize : pageSize),
  );
  return {
    day: dayNumber,
    readings: day.readings,
    edition: "RSV-2CE",
    commentaries,
    total,
    page,
    page_size: pageSize,
    has_more: offset + commentaries.length < total,
    filters: manifest.filters,
    matching_notes: manifest.matching_notes,
  };
}
