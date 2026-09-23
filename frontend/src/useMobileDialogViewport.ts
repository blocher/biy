import { useLayoutEffect, type RefObject } from "react";

/** Keep a modal inside the visible portion of Safari when the keyboard opens. */
export function useMobileDialogViewport(
  dialog: RefObject<HTMLDialogElement | null>,
  open: boolean,
) {
  useLayoutEffect(() => {
    const node = dialog.current;
    const viewport = window.visualViewport;
    if (!open || !node || !viewport) return;

    let frame = 0;
    const update = (keepFocused: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!window.matchMedia("(max-width: 650px)").matches) {
          node.style.removeProperty("--dialog-viewport-top");
          node.style.removeProperty("--dialog-viewport-height");
          return;
        }
        node.style.setProperty("--dialog-viewport-top", `${viewport.offsetTop}px`);
        node.style.setProperty("--dialog-viewport-height", `${viewport.height}px`);
        const active = document.activeElement;
        if (keepFocused && active && node.contains(active) && active instanceof HTMLElement) {
          active.scrollIntoView({ block: "nearest" });
        }
      });
    };
    const onResize = () => update(true);
    const onScroll = () => update(false);
    onResize();
    viewport.addEventListener("resize", onResize);
    viewport.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    node.addEventListener("focusin", onResize);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", onResize);
      viewport.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      node.removeEventListener("focusin", onResize);
      node.style.removeProperty("--dialog-viewport-top");
      node.style.removeProperty("--dialog-viewport-height");
    };
  }, [dialog, open]);
}
