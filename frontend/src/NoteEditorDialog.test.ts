import { describe, expect, it } from "vitest";
import { noteEditorValue } from "./NoteEditorDialog";
import type { Note } from "./types";

describe("noteEditorValue", () => {
  it("preserves linked reading metadata when a journal entry is edited", () => {
    const note: Note = {
      id: 12,
      author: { id: 3, name: "Reader" },
      body: "A reflection",
      kind: "journal",
      shared: true,
      audio_time: 42,
      quote: "The light shines in the darkness.",
      citation: "John 1:5",
      source_url: "/day/1/reader#verse-john-1-5",
      created_at: "2026-09-22T12:00:00Z",
      updated_at: "2026-09-22T12:00:00Z",
      day: 1,
      catechism_day: null,
      edition: "bible",
      episode: null,
    };

    expect(noteEditorValue(note)).toEqual({
      body: "A reflection",
      kind: "journal",
      shared: true,
      audio_time: 42,
      quote: "The light shines in the darkness.",
      citation: "John 1:5",
      source_url: "/day/1/reader#verse-john-1-5",
    });
  });
});
