import { createContext, useContext } from "react";

export type Edition = "bible" | "catechism";
export type EditionAvailability = { bible: boolean; catechism: boolean };

export const EDITION_STORAGE_KEY = "daily-companion-edition";

export function storedEdition(): Edition {
  return typeof localStorage !== "undefined" &&
    localStorage.getItem(EDITION_STORAGE_KEY) === "catechism"
    ? "catechism"
    : "bible";
}

export function lastPlanEdition(): Edition {
  return typeof localStorage !== "undefined" && localStorage.getItem("daily-companion-last-plan") === "catechism" ? "catechism" : "bible";
}

export function persistPlanEdition(edition: Edition) {
  if (typeof localStorage !== "undefined") localStorage.setItem("daily-companion-last-plan", edition);
}

export function persistEdition(edition: Edition) {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(EDITION_STORAGE_KEY, edition);
}

export const EditionContext = createContext<{
  edition: Edition;
  availability: EditionAvailability;
  setEdition: (edition: Edition) => void;
}>({
  edition: "bible",
  availability: { bible: true, catechism: true },
  setEdition: () => {},
});

export function useEdition() {
  return useContext(EditionContext);
}

export const editionName = (edition: Edition) =>
  edition === "bible" ? "Bible in a Year" : "Catechism in a Year";
