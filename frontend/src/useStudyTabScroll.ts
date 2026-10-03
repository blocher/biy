import { useLayoutEffect, useRef } from "react";

/** Reset a newly selected mobile study panel beneath its sticky tab bar. */
export function useStudyTabScroll(tab: string, reader: boolean) {
  const previousTab = useRef(tab);
  useLayoutEffect(() => {
    const changed = previousTab.current !== tab;
    previousTab.current = tab;
    if (!changed || reader || window.location.hash || !window.matchMedia("(max-width: 640px)").matches) return;
    const panel = document.getElementById("study-panel");
    const tabs = document.getElementById("viewport-2-b-tabs");
    if (!panel || !tabs) return;
    window.scrollTo({
      top: Math.max(0, window.scrollY + panel.getBoundingClientRect().top - tabs.getBoundingClientRect().height - 12),
      behavior: "instant",
    });
  }, [tab, reader]);
}
