import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";

type Mark = { left: number; top: number; width: number; height: number; active: boolean };

function findRanges(surface: HTMLElement, query: string): Range[] {
  if (!query.trim()) return [];
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !node.textContent?.trim() ||
        !parent ||
        parent.closest("button, input, textarea, select, [aria-hidden='true']") ||
        !parent.getClientRects().length
      ) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const segments: { node: Text; start: number; end: number }[] = [];
  let text = "";
  let block: Element | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nextBlock = node.parentElement?.closest("p, li, h1, h2, h3, h4, blockquote, td") || node.parentElement;
    if (block && nextBlock !== block) text += "\n";
    block = nextBlock || null;
    segments.push({ node, start: text.length, end: text.length + node.length });
    text += node.textContent;
  }
  const needle = query.trim().toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  const ranges: Range[] = [];
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1 && ranges.length < 500) {
    const first = segments.find((part) => part.start <= offset && offset < part.end);
    const end = offset + needle.length;
    const last = segments.find((part) => part.start < end && end <= part.end);
    if (first && last) {
      const range = document.createRange();
      range.setStart(first.node, offset - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
    }
    offset += Math.max(needle.length, 1);
  }
  return ranges;
}

export function FindInPage({ surface, onClose }: {
  surface: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [active, setActive] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
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
    const observer = new MutationObserver(refresh);
    observer.observe(node, { subtree: true, childList: true, characterData: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [surface, query]);

  useEffect(() => {
    if (!ranges.length) return;
    ranges[active]?.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }, [ranges, active]);

  useEffect(() => {
    let frame = 0;
    const position = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visible: Mark[] = [];
        ranges.forEach((range, index) => {
          for (const rect of range.getClientRects()) {
            if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight) continue;
            visible.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, active: index === active });
          }
        });
        setMarks(visible);
      });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [ranges, active]);

  function move(step: number) {
    if (ranges.length) setActive((current) => (current + step + ranges.length) % ranges.length);
  }

  return <>
    <div className="page-find-highlights" aria-hidden="true">
      {marks.map(({ active: highlighted, ...bounds }, index) =>
        <span key={index} className={highlighted ? "active" : ""} style={bounds} />
      )}
    </div>
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
        {query ? ranges.length ? `${active + 1} of ${ranges.length}${ranges.length === 500 ? "+" : ""}` : "No matches" : ""}
      </span>
      <button type="button" aria-label="Previous match" disabled={!ranges.length} onClick={() => move(-1)}><ArrowUp size={17} /></button>
      <button type="button" aria-label="Next match" disabled={!ranges.length} onClick={() => move(1)}><ArrowDown size={17} /></button>
      <button type="button" aria-label="Close find" onClick={onClose}><X size={18} /></button>
    </div>
  </>;
}
