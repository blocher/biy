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
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!window.matchMedia("(max-width: 650px)").matches) {
          node.style.removeProperty("--dialog-viewport-top");
          node.style.removeProperty("--dialog-viewport-height");
          return;
        }
        node.style.setProperty("--dialog-viewport-top", `${viewport.offsetTop}px`);
        node.style.setProperty("--dialog-viewport-height", `${viewport.height}px`);
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      node.style.removeProperty("--dialog-viewport-top");
      node.style.removeProperty("--dialog-viewport-height");
    };
  }, [dialog, open]);
}
