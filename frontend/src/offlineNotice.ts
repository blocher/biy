import type { EditionAvailability } from "./Edition";

// Stable states, not download counts or timestamps: restarting a download should
// not bring back a dismissed notice. A new catalog/plan or error can surface once.
export function noticeKey({
  availability,
  ready,
  busy,
  error,
  total,
  version,
}: {
  availability: EditionAvailability;
  ready: boolean;
  busy: boolean;
  error: string | null;
  total: number;
  version?: string;
}) {
  return JSON.stringify([
    availability.bible,
    availability.catechism,
    busy ? "preparing" : error ? "error" : ready ? "ready" : "incomplete",
    busy ? null : error,
    busy ? null : total,
    busy ? null : version,
  ]);
}

const storageKey = (user: string) =>
  `biy-offline-notices-v1-${encodeURIComponent(user)}`;
export function readDismissals(user: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(user)) || "[]",
    );
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string").slice(-20)
      : [];
  } catch {
    return [];
  }
}
export function saveDismissal(user: string, current: string[], key: string) {
  const next = [...current.filter((value) => value !== key), key].slice(-20);
  try {
    localStorage.setItem(storageKey(user), JSON.stringify(next));
  } catch {
    // Dismissal still works for this session if local storage is unavailable.
  }
  return next;
}
