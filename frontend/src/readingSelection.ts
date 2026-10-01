type Bounds = { left: number; top: number; width: number; height: number };

export type ReadingSelection = {
  quote: string;
  citation: string;
  sourceUrl: string;
};

export type SelectionToolbarPosition = {
  left: number;
  top: number;
  maxWidth: number;
  placement: "inline" | "dock-top" | "dock-bottom";
};

/** Native touch selection menus render above the page, outside its z-index tree.
 * Keep our actions at the opposite visible edge instead of beside that menu. */
export function selectionToolbarPosition(
  range: Bounds,
  viewport: Bounds,
  touch: boolean,
): SelectionToolbarPosition {
  const margin = 12;
  const width = Math.min(248, viewport.width - margin * 2);
  const height = 54;
  const bottom = viewport.top + viewport.height;
  if (touch) {
    const visibleTop = Math.max(viewport.top, range.top);
    const visibleBottom = Math.min(bottom, range.top + range.height);
    const dockTop =
      (visibleTop + visibleBottom) / 2 > viewport.top + viewport.height / 2;
    return {
      left: viewport.left + viewport.width / 2,
      top: dockTop ? viewport.top + margin : bottom - margin,
      maxWidth: width,
      placement: dockTop ? "dock-top" : "dock-bottom",
    };
  }

  const above = range.top - height - margin;
  const top =
    above >= viewport.top + margin ? above : range.top + range.height + margin;
  return {
    left: Math.max(
      viewport.left + width / 2 + margin,
      Math.min(
        viewport.left + viewport.width - width / 2 - margin,
        range.left + range.width / 2,
      ),
    ),
    top: Math.max(
      viewport.top + margin,
      Math.min(bottom - height - margin, top),
    ),
    maxWidth: width,
    placement: "inline",
  };
}
