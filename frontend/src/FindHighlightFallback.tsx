import { useEffect, useRef } from "react";

// Older installed browsers without Custom Highlight support still get search.
// Measure in the SVG's own coordinate system, never assume fixed CSS pixels
// equal Range viewport pixels (zoom and the mobile keyboard can change that).
export function FindHighlightFallback({ ranges, active }: { ranges: Range[]; active: number }) {
  const overlay = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = overlay.current;
    if (!svg) return;
    let frame = 0;
    const paint = () => {
      const matrix = svg.getScreenCTM()?.inverse();
      if (matrix) {
        const boxes: SVGRectElement[] = [];
        ranges.forEach((range, index) => {
          let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
          for (let parent = range.startContainer.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
            const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
            const clientLeft = bounds.left + parent.clientLeft * scaleX;
            const clientTop = bounds.top + parent.clientTop * scaleY;
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, clientLeft);
              right = Math.min(right, clientLeft + parent.clientWidth * scaleX);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, clientTop);
              bottom = Math.min(bottom, clientTop + parent.clientHeight * scaleY);
            }
          }
          for (const rect of range.getClientRects()) {
            const x = Math.max(left, rect.left), y = Math.max(top, rect.top);
            const endX = Math.min(right, rect.right), endY = Math.min(bottom, rect.bottom);
            if (endX <= x || endY <= y) continue;
            const start = new DOMPoint(x, y).matrixTransform(matrix);
            const end = new DOMPoint(endX, endY).matrixTransform(matrix);
            const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            box.setAttribute("x", String(start.x)); box.setAttribute("y", String(start.y));
            box.setAttribute("width", String(end.x - start.x)); box.setAttribute("height", String(end.y - start.y));
            box.setAttribute("fill", index === active ? "#f7ab4870" : "#f4cf5760");
            boxes.push(box);
          }
        });
        svg.replaceChildren(...boxes);
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => { cancelAnimationFrame(frame); svg.replaceChildren(); };
  }, [ranges, active]);
  return <svg ref={overlay} className="page-find-highlights" aria-hidden="true" />;
}
