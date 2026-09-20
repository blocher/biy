import { describe, expect, it } from "vitest";
import {
  pageContainingIndex,
  readingPlanPage,
  readingPlanPageSize,
} from "./readingPlanPagination";

describe("reading-plan pagination", () => {
  it("uses the URL size, then the saved preference, then 20", () => {
    expect(readingPlanPageSize("50", "100")).toBe(50);
    expect(readingPlanPageSize(null, "200")).toBe(200);
    expect(readingPlanPageSize("17", "17")).toBe(20);
  });

  it("accepts only positive integer pages", () => {
    expect(readingPlanPage("3")).toBe(3);
    expect(readingPlanPage("0")).toBe(1);
    expect(readingPlanPage("2.5")).toBe(1);
  });

  it("finds the page containing the next available entry", () => {
    expect(pageContainingIndex(0, 20)).toBe(1);
    expect(pageContainingIndex(20, 20)).toBe(2);
    expect(pageContainingIndex(364, 400)).toBe(1);
  });
});
