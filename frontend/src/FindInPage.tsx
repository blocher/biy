import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";

import { FindHighlightFallback } from "./FindHighlightFallback";
import { findRanges, isFindUI } from "./findInPageRanges";

export function FindInPage({ onClose }: {
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [active, setActive] = useState(0);

  const nativeHighlights = !!CSS.highlights && typeof Highlight !== "undefined";
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const node = document.body;
    let frame = 0;
    setActive(0);
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = findRanges(node, query);
        setRanges((current) => current.length === found.length && current.every((range, index) =>
          range.startContainer === found[index].startContainer &&
          range.startOffset === found[index].startOffset &&
          range.endContainer === found[index].endContainer &&
          range.endOffset === found[index].endOffset
        ) ? current : found);
      });
    };
    refresh();
    const observer = new MutationObserver((changes) => {
      if (changes.some((change) => !isFindUI(change.target))) refresh();
    });
    observer.observe(node, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "inert"],
    });
    window.addEventListener("resize", refresh);
    document.addEventListener("toggle", refresh, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", refresh);
      document.removeEventListener("toggle", refresh, true);
    };
  }, [query]);

  const current = Math.min(active, Math.max(0, ranges.length - 1));
  useEffect(() => {
    setActive(current);
    const range = ranges[current];
    if (!range) return;
    range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    // A match may be far down a single long paragraph. Center the actual text,
    // rather than leaving it offscreen after centering the paragraph's box.
    for (let parent = range.startContainer.parentElement; parent; parent = parent.parentElement) {
      if (parent === document.body || parent === document.documentElement) continue;
      if (!/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
      const bounds = parent.getBoundingClientRect();
      const text = range.getClientRects()[0] || range.getBoundingClientRect();
      if (text.top < bounds.top || text.bottom > bounds.bottom)
        parent.scrollTop += text.top - bounds.top - parent.clientHeight / 2;
    }
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const height = viewport?.height || innerHeight;
    if (rect.top < top + 72 || rect.bottom > top + height - 24)
      window.scrollBy({ top: rect.top - top - height / 2, behavior: "instant" });
  }, [ranges, current]);

  useEffect(() => {
    if (!nativeHighlights) return;
    // The browser paints the real text ranges. No cached viewport rectangles,
    // scroll listeners, or coordinate conversion can drift away from the words.
    const all = new Highlight(...ranges);
    const selected = new Highlight(...(ranges[current] ? [ranges[current]] : []));
    selected.priority = 1;
    CSS.highlights.set("biy-page-find", all);
    CSS.highlights.set("biy-page-find-active", selected);
    return () => {
      CSS.highlights.delete("biy-page-find");
      CSS.highlights.delete("biy-page-find-active");
    };
  }, [ranges, current, nativeHighlights]);

  function move(step: number) {
    if (ranges.length) setActive((current) => (current + step + ranges.length) % ranges.length);
  }

  return <>
    {!nativeHighlights && <FindHighlightFallback ranges={ranges} active={current} />}
    <div className="page-find" role="search" aria-label="Find on this page">
      <Search size={18} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label="Find text on this page"
        placeholder="Find exact text…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
        }}
      />
      <span className="page-find-count" role="status">
        {query ? ranges.length ? `${current + 1} of ${ranges.length}${ranges.length === 500 ? "+" : ""}` : "No matches" : ""}
      </span>
      <button type="button" aria-label="Previous match" disabled={!ranges.length} onClick={() => move(-1)}><ArrowUp size={17} /></button>
      <button type="button" aria-label="Next match" disabled={!ranges.length} onClick={() => move(1)}><ArrowDown size={17} /></button>
      <button type="button" aria-label="Close find" onClick={onClose}><X size={18} /></button>
    </div>
  </>;
}

