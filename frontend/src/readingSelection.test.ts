import { describe, expect, it } from "vitest";
import { selectionToolbarPosition } from "./readingSelection";

const phone = { left: 0, top: 0, width: 390, height: 700 };

describe("selectionToolbarPosition", () => {
  it("keeps touch actions far from a selection and its native menu", () => {
    const upper = selectionToolbarPosition(
      { left: 20, top: 150, width: 200, height: 60 },
      phone,
      true,
    );
    expect(upper.placement).toBe("dock-bottom");
    expect(upper.top).toBeGreaterThan(600);
    const lower = selectionToolbarPosition(
      { left: 20, top: 600, width: 200, height: 60 },
      phone,
      true,
    );
    expect(lower.placement).toBe("dock-top");
    expect(lower.top).toBeLessThan(40);
  });

  it("uses the visible viewport after zooming, keyboard resize, or browser chrome changes", () => {
    const viewport = { left: 50, top: 200, width: 280, height: 320 };
    const position = selectionToolbarPosition(
      { left: 60, top: 230, width: 100, height: 30 },
      viewport,
      true,
    );
    expect(position.left).toBe(190);
    expect(position.top).toBeLessThan(520);
    expect(position.top).toBeGreaterThan(450);
    expect(position.maxWidth).toBeLessThanOrEqual(256);
  });

  it("uses the visible part of a long selection to choose its opposite edge", () => {
    expect(
      selectionToolbarPosition(
        { left: 20, top: -1000, width: 300, height: 1600 },
        phone,
        true,
      ).placement,
    ).toBe("dock-bottom");
    expect(
      selectionToolbarPosition(
        { left: 20, top: 500, width: 300, height: 1600 },
        phone,
        true,
      ).placement,
    ).toBe("dock-top");
  });

  it("keeps desktop actions near the range but within every viewport edge", () => {
    for (const range of [
      { left: -20, top: 0, width: 80, height: 20 },
      { left: 360, top: 660, width: 100, height: 40 },
    ]) {
      const position = selectionToolbarPosition(range, phone, false);
      expect(position.placement).toBe("inline");
      expect(position.left - position.maxWidth / 2).toBeGreaterThanOrEqual(12);
      expect(position.left + position.maxWidth / 2).toBeLessThanOrEqual(378);
      expect(position.top).toBeGreaterThanOrEqual(12);
      expect(position.top + 54).toBeLessThanOrEqual(688);
    }
  });
});
