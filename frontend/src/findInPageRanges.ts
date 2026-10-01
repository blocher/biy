// Keep offsets in the original text: lowercasing can change Unicode string lengths.
const excluded = "script, style, noscript, template, input, textarea, select, [hidden], [inert], [aria-hidden='true'], [data-page-find-ignore], .page-find, .page-find-highlights, .reading-selection-tools, .reading-capture-launcher";

export function findRanges(surface: HTMLElement, query: string): Range[] {
  if (!query.trim()) return [];
  const visibility = new Map<Element, boolean>();
  function rendered(element: Element): boolean {
    const cached = visibility.get(element);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    const visible = !element.matches(excluded) && style.display !== "none" &&
      style.contentVisibility !== "hidden" && style.opacity !== "0" &&
      (!element.parentElement || rendered(element.parentElement));
    visibility.set(element, visible);
    return visible;
  }
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node instanceof Element) {
        return node.tagName === "BR" && rendered(node) && getComputedStyle(node).visibility === "visible"
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      const parent = node.parentElement;
      if (!node.textContent || !parent || !rendered(parent)) return NodeFilter.FILTER_REJECT;
      // Visibility is inherited but a descendant may explicitly become visible.
      if (["hidden", "collapse"].includes(getComputedStyle(parent).visibility)) return NodeFilter.FILTER_REJECT;
      // Closed details can still report element boxes in some browsers.
      for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open &&
          !ancestor.querySelector(":scope > summary")?.contains(node)) return NodeFilter.FILTER_REJECT;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const segments: { node: Text; start: number; end: number }[] = [];
  let text = "";
  let block: Element | null = null;
  function textBlock(element: Element | null): Element | null {
    while (element && element !== surface) {
      const display = getComputedStyle(element).display;
      if (!display.startsWith("inline") && display !== "contents") break;
      element = element.parentElement;
    }
    return element;
  }
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Element) { text += "\n"; continue; }
    const node = walker.currentNode as Text;
    const nextBlock = textBlock(node.parentElement);
    if (block && nextBlock !== block) text += "\n";
    block = nextBlock;
    segments.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  const pattern = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const matches = text.matchAll(new RegExp(pattern, "giu"));
  const ranges: Range[] = [];
  for (const match of matches) {
    const offset = match.index!;
    const end = offset + match[0].length;
    const first = segments.find((part) => part.start <= offset && offset < part.end);
    const last = segments.find((part) => part.start < end && end <= part.end);
    if (first && last) {
      const range = document.createRange();
      range.setStart(first.node, offset - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
      if (ranges.length === 500) break;
    }
  }
  return ranges;
}

export function isFindUI(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest(".page-find, .page-find-highlights, .reading-selection-tools, .reading-capture-launcher");
}
