import { afterEach, expect, test, vi } from "vitest";
import {
  COMMENTARY_MANIFEST_URL,
  commentaryBookUrl,
  offlineCommentaries,
} from "./offlineCommentaries";
import type { CommentaryEntry } from "./types";

afterEach(() => vi.unstubAllGlobals());

test("offline commentary matches, filters, paginates, and opens a focused page", async () => {
  const row = (
    id: number,
    year: number,
    category: string,
  ): CommentaryEntry => ({
    id: String(id),
    database_id: id,
    author: "Witness",
    author_metadata: {
      name: "Witness",
      category,
      default_year: year,
      year_label: String(year),
      wiki_url: "",
      condemned_by_council: false,
    },
    year,
    year_label: String(year),
    source_title: "Source",
    source_url: "",
    text: `Commentary ${id}`,
    book: "john",
    location_start: 3_000_016,
    location_end: 3_000_018,
    matched_readings: [],
  });
  const rows = [row(2, 300, "Later"), row(1, 100, "Early")];
  const manifest = {
    version: "sample",
    books: ["john"],
    days: {
      "1": {
        readings: ["John 3:16-18"],
        ranges: [
          {
            reference: "John 3:16-18",
            book: "john",
            start: 3_000_016,
            end: 3_000_018,
          },
        ],
      },
    },
    filters: { categories: ["Early", "Later"], min_year: 100, max_year: 300 },
    matching_notes: ["Sample"],
  };
  const stream = new Response(JSON.stringify(rows)).body!.pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressed = await new Response(stream).arrayBuffer();
  const saved = new Map<string, Response>([
    [COMMENTARY_MANIFEST_URL, new Response(JSON.stringify(manifest))],
    [commentaryBookUrl("john", "sample"), new Response(compressed)],
  ]);
  vi.stubGlobal("window", { caches: true, DecompressionStream });
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (key: string) => saved.get(key)?.clone(),
    }),
  });

  const filtered = await offlineCommentaries(
    "reader",
    new URLSearchParams("day=1&from_year=200"),
  );
  expect(filtered?.commentaries.map((entry) => entry.database_id)).toEqual([2]);
  expect(filtered?.commentaries[0].matched_readings).toEqual(["John 3:16-18"]);
  const page = await offlineCommentaries(
    "reader",
    new URLSearchParams("day=1&page=2&page_size=1"),
  );
  expect(page?.commentaries.map((entry) => entry.database_id)).toEqual([2]);
  const focused = await offlineCommentaries(
    "reader",
    new URLSearchParams("day=1&page_size=1&focus=2"),
  );
  expect(focused?.page).toBe(2);
  expect(focused?.commentaries.map((entry) => entry.database_id)).toEqual([
    1, 2,
  ]);
  const category = await offlineCommentaries(
    "reader",
    new URLSearchParams("day=1&category=Early"),
  );
  expect(category?.commentaries.map((entry) => entry.database_id)).toEqual([1]);
});
