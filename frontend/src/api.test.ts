import { afterEach, describe, expect, it, vi } from "vitest";
import { api, episodeTitle, time } from "./api";
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

describe("API validation errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the server validation message instead of a generic save error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            detail: [{ msg: "String should have at least 8 characters" }],
          }),
      }),
    );
    await expect(
      api("/account/password", "PUT", { new_password: "short" }),
    ).rejects.toThrow("String should have at least 8 characters");
  });
});
