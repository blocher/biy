import { useEffect, useState } from "react";
import type { EditionAvailability } from "./Edition";
import type { Library } from "./types";

const CACHE_PREFIX = "biy-reading-v1-";
const SHELL_CACHE = "biy-shell-v1";

type State = { done: number; total: number; error: string | null };

function readingUrls(libraries: Library[]): string[] {
  const urls: string[] = [];
  for (const library of libraries) {
    urls.push(`/api/library?edition=${library.edition}`);
    for (const day of library.days)
      urls.push(`/api/days/${day.number}?edition=${library.edition}`);
    for (const episode of library.extras)
      urls.push(`/api/episodes/${episode.id}?edition=${library.edition}`);
  }
  return [...new Set(urls)];
}

async function getLibrary(
  edition: "bible" | "catechism",
  cache: Cache,
  signal: AbortSignal,
): Promise<Library> {
  const url = `/api/library?edition=${edition}`;
  if (!navigator.onLine) {
    const cached = await cache.match(url);
    if (!cached) throw new Error("Reconnect to finish saving readings.");
    return cached.json() as Promise<Library>;
  }
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("Could not load the reading plan.");
  const library = (await response.clone().json()) as Library;
  await cache.put(url, response);
  return library;
}

export function OfflineStatus({
  user,
  availability,
}: {
  user: string;
  availability: EditionAvailability;
}) {
  const [state, setState] = useState<State>({ done: 0, total: 0, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      setState({
        done: 0,
        total: 0,
        error: "Offline saving is not supported in this browser.",
      });
      return;
    }
    const controller = new AbortController();
    let live = true;
    const update = (next: State) => {
      if (live) setState(next);
    };
    async function prepare() {
      try {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => resolve(),
              { once: true },
            );
          });
        }
        // The first load may have started before the service worker took control.
        // Fetching the session now binds the private cache to this signed-in user.
        if (navigator.onLine) {
          const response = await fetch("/api/session?edition=bible", {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok || (await response.json()).user?.username !== user)
            throw new Error("Sign in again to save readings offline.");
        }
        const shell = await caches.open(SHELL_CACHE);
        const index = await shell.match("/");
        if (!index) throw new Error("The offline app is still installing.");
        const assets = [
          ...(await index.text()).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
        ].map((match) => match[1]);
        for (const asset of assets)
          if (!(await shell.match(asset)))
            throw new Error("The offline app is still installing.");
        const cache = await caches.open(
          CACHE_PREFIX + encodeURIComponent(user),
        );
        const editions = (["bible", "catechism"] as const).filter(
          (edition) => availability[edition],
        );
        const libraries = await Promise.all(
          editions.map((edition) =>
            getLibrary(edition, cache, controller.signal),
          ),
        );
        const urls = readingUrls(libraries);
        let done = 0;
        for (const url of urls) if (await cache.match(url)) done++;
        update({ done, total: urls.length, error: null });
        if (done === urls.length) return;
        if (!navigator.onLine) {
          update({
            done,
            total: urls.length,
            error: "Reconnect to finish saving readings.",
          });
          return;
        }
        let cursor = 0;
        let downloadError: Error | null = null;
        const workers = Array.from({ length: 2 }, async () => {
          while (
            cursor < urls.length &&
            !controller.signal.aborted &&
            !downloadError
          ) {
            const url = urls[cursor++];
            if (await cache.match(url)) continue;
            try {
              const response = await fetch(url, {
                credentials: "same-origin",
                signal: controller.signal,
              });
              if (
                !response.ok ||
                !response.headers.get("content-type")?.includes("json")
              )
                throw new Error(
                  "A reading could not be saved. The download will resume when you reconnect.",
                );
              await cache.put(url, response);
              done++;
              update({ done, total: urls.length, error: null });
            } catch (error) {
              downloadError = error as Error;
            }
          }
        });
        await Promise.all(workers);
        if (downloadError) throw downloadError;
      } catch (error) {
        if (!controller.signal.aborted && live)
          setState((current) => ({
            ...current,
            error: (error as Error).message,
          }));
      }
    }
    void prepare();
    const reconnect = () => setRetry((value) => value + 1);
    window.addEventListener("online", reconnect);
    return () => {
      live = false;
      controller.abort();
      window.removeEventListener("online", reconnect);
    };
  }, [user, availability.bible, availability.catechism, retry]);

  const ready = state.total > 0 && state.done === state.total && !state.error;
  return (
    <div
      className="offline-status"
      role="status"
      aria-live="polite"
      title="Reading and episode text are saved on this device. Notes and progress need a connection."
    >
      {ready ? (
        "Readings and episode commentary ready offline"
      ) : state.error ? (
        <>
          Offline setup incomplete ({state.done}/{state.total}). {state.error}{" "}
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </>
      ) : state.total ? (
        `Saving readings for offline use: ${state.done}/${state.total}`
      ) : (
        "Preparing offline readings…"
      )}
    </div>
  );
}
