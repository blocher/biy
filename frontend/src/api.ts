import { storedEdition } from "./Edition";

let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const editionPath = /[?&]edition=/.test(path)
    ? path
    : `${path}${separator}edition=${storedEdition()}`;
  let response: Response;
  try {
    response = await fetch("/api" + editionPath, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "X-CSRFToken": csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (typeof navigator !== "undefined" && !navigator.onLine)
      throw new Error(
        method === "GET"
          ? "This item is not saved offline yet. Reconnect and try again."
          : "You're offline. Reconnect before saving changes.",
      );
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server could not complete this request. Please try again.",
    );
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/login") {
      if (typeof navigator !== "undefined")
        navigator.serviceWorker?.controller?.postMessage({
          type: "CLEAR_PRIVATE_DATA",
        });
      window.dispatchEvent(new Event("session-expired"));
    }
    const detail = Array.isArray(data.detail)
      ? data.detail.find(
          (item: { msg?: unknown }) => typeof item?.msg === "string",
        )?.msg
      : data.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : "Could not save this change. Please try again.",
    );
  }
  return data as T;
}
export const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
export const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
export const dateInputValue = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export const episodeTitle = (title: string) =>
  title.replace(/^Day\s+\d+:\s*/i, "").replace(/\s*[-–]?\s*\(?2025\)?$/, "");
