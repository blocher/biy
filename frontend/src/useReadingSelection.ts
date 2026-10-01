import { useEffect, useRef, useState, type RefObject } from "react";
import {
  selectionToolbarPosition,
  type ReadingSelection,
  type SelectionToolbarPosition,
} from "./readingSelection";

export function localReadingUrl(fragment = "") {
  return `${window.location.pathname}${window.location.search}${fragment}`;
}

const interactive =
  "button, a, input, textarea, select, [contenteditable=true]";

export function useReadingSelection(
  surface: RefObject<HTMLElement | null>,
  contextLabel: string,
  target: string,
) {
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [toolbar, setToolbar] = useState<SelectionToolbarPosition | null>(null);
  const snapshot = useRef<ReadingSelection | null>(null);
  const range = useRef<Range | null>(null);
  const enabled = useRef(true);
  const touch = useRef(false);

  function suspend() {
    enabled.current = false;
    range.current = null;
    setToolbar(null);
  }

  function dismiss() {
    suspend();
    snapshot.current = null;
    setSelection(null);
  }

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    let selectionFrame = 0;
    let viewportFrame = 0;
    enabled.current = true;
    snapshot.current = null;
    range.current = null;
    setSelection(null);
    setToolbar(null);
    touch.current = window.matchMedia("(any-pointer: coarse)").matches;

    function position() {
      if (!enabled.current || !range.current) return;
      const viewport = window.visualViewport;
      setToolbar(
        selectionToolbarPosition(
          range.current.getBoundingClientRect(),
          {
            left: viewport?.offsetLeft || 0,
            top: viewport?.offsetTop || 0,
            width: viewport?.width || window.innerWidth,
            height: viewport?.height || window.innerHeight,
          },
          touch.current,
        ),
      );
    }

    function read() {
      if (!enabled.current) return false;
      const native = window.getSelection();
      if (!native || native.isCollapsed || !native.rangeCount) {
        // iOS may collapse its native range while opening a menu or focusing an
        // action. Keep the captured text until an action or explicit dismissal.
        if (
          !touch.current &&
          !document.activeElement?.closest(".reading-selection-tools")
        )
          dismiss();
        return false;
      }
      const selected = native.getRangeAt(0);
      if (!node!.contains(selected.commonAncestorContainer)) {
        dismiss();
        return false;
      }
      const quote = native
        .toString()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10000);
      if (!quote) return false;
      const element =
        selected.startContainer instanceof Element
          ? selected.startContainer
          : selected.startContainer.parentElement;
      const source = element?.closest<HTMLElement>("[data-reading-citation]");
      const fragment = source?.dataset.readingUrl || "";
      const value = {
        quote,
        citation: source?.dataset.readingCitation || contextLabel,
        sourceUrl: fragment.startsWith("/")
          ? fragment
          : localReadingUrl(fragment),
      };
      // Store an independent range and text, not the live native selection.
      range.current = selected.cloneRange();
      snapshot.current = value;
      setSelection(value);
      position();
      return true;
    }

    const queueRead = () => {
      cancelAnimationFrame(selectionFrame);
      selectionFrame = requestAnimationFrame(read);
    };
    const reposition = () => {
      cancelAnimationFrame(viewportFrame);
      viewportFrame = requestAnimationFrame(position);
    };
    const pointerDown = (event: PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".reading-selection-tools")) return;
      if (!element || !node.contains(element) || element.closest(interactive)) {
        // A note dialog owns its frozen snapshot after suspend().
        if (enabled.current) dismiss();
        return;
      }
      enabled.current = true;
      touch.current = event.pointerType === "touch";
      if (!touch.current) {
        range.current = null;
        snapshot.current = null;
        setSelection(null);
        setToolbar(null);
      }
    };
    const pointerUp = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest(interactive)
      )
        return;
      queueRead();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (enabled.current) dismiss();
        return;
      }
      if (event.key.startsWith("Arrow") || event.key === "Shift") {
        const native = window.getSelection();
        if (
          node.contains(native?.anchorNode || null) &&
          !document.activeElement?.closest(interactive)
        ) {
          enabled.current = true;
          touch.current = false;
          queueRead();
        }
      }
    };
    const contextMenu = (event: MouseEvent) => {
      // Keep Copy, Look Up, and selection handles available on touch devices.
      if (read() && !touch.current) event.preventDefault();
    };
    const viewport = window.visualViewport;
    document.addEventListener("selectionchange", read);
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    node.addEventListener("pointerup", pointerUp);
    node.addEventListener("contextmenu", contextMenu);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    viewport?.addEventListener("scroll", reposition);
    viewport?.addEventListener("resize", reposition);
    return () => {
      enabled.current = false;
      cancelAnimationFrame(selectionFrame);
      cancelAnimationFrame(viewportFrame);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
      node.removeEventListener("pointerup", pointerUp);
      node.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      viewport?.removeEventListener("scroll", reposition);
      viewport?.removeEventListener("resize", reposition);
    };
  }, [surface, contextLabel, target]);

  return { selection, snapshot, toolbar, suspend, dismiss };
}
