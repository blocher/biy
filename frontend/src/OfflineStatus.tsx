import { useEffect, useState } from "react";
import type { EditionAvailability } from "./Edition";
import type { Library } from "./types";
import {
  COMMENTARY_MANIFEST_URL,
  READING_CACHE_PREFIX,
  commentaryBookUrl,
  type CommentaryManifest,
} from "./offlineCommentaries";

const SHELL_CACHE = "biy-shell-v1";

type State = {
  done: number;
  total: number;
  readingsReady: boolean;
  catalogReady?: boolean;
  error: string | null;
};

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
  if (response.status === 401) throw expiredSession();
  if (!response.ok) throw new Error("Could not load the reading plan.");
  const library = (await response.clone().json()) as Library;
  await cache.put(url, response);
  return library;
}

function expiredSession(): Error {
  navigator.serviceWorker.controller?.postMessage({
    type: "CLEAR_PRIVATE_DATA",
  });
  window.dispatchEvent(new Event("session-expired"));
  const error = new Error("Sign in again to save readings offline.");
  error.name = "UnauthorizedOffline";
  return error;
}

export function OfflineStatus({
  user,
  availability,
}: {
  user: string;
  availability: EditionAvailability;
}) {
  const [state, setState] = useState<State>({
    done: 0,
    total: 0,
    readingsReady: false,
    error: null,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      setState({
        done: 0,
        total: 0,
        readingsReady: false,
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
            throw expiredSession();
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
          READING_CACHE_PREFIX + encodeURIComponent(user),
        );
        const preferences = await fetch("/api/preferences", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (preferences.status === 401) throw expiredSession();
        if (!preferences.ok)
          throw new Error("Reconnect to finish saving account settings.");
        await cache.put("/api/preferences", preferences);
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
        update({
          done,
          total: urls.length,
          readingsReady: done === urls.length,
          error: null,
        });
        if (done < urls.length && !navigator.onLine) {
          update({
            done,
            total: urls.length,
            readingsReady: false,
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
              update({
                done,
                total: urls.length,
                readingsReady: false,
                error: null,
              });
            } catch (error) {
              downloadError = error as Error;
            }
          }
        });
        await Promise.all(workers);
        if (downloadError) throw downloadError;
        update({ done, total: urls.length, readingsReady: true, error: null });
        if (!availability.bible) return;
        if (!("DecompressionStream" in window))
          throw new Error(
            "Historical commentary offline needs a newer browser.",
          );
        const cachedManifest = await cache.match(COMMENTARY_MANIFEST_URL);
        let manifestResponse = cachedManifest?.clone();
        let fetchedManifest = false;
        if (navigator.onLine) {
          try {
            const response = await fetch(COMMENTARY_MANIFEST_URL, {
              credentials: "same-origin",
              signal: controller.signal,
            });
            if (response.status === 401) throw expiredSession();
            if (response.ok) {
              manifestResponse = response;
              fetchedManifest = true;
            }
          } catch (error) {
            if ((error as Error).name === "UnauthorizedOffline") throw error;
            // A completed earlier catalog remains usable during an outage.
          }
        }
        if (!manifestResponse)
          throw new Error(
            "Reconnect to finish saving historical commentaries.",
          );
        const manifest = (await manifestResponse
          .clone()
          .json()) as CommentaryManifest;
        const chunkUrls = manifest.books.map((book) =>
          commentaryBookUrl(book, manifest.version),
        );
        const oldVersion = cachedManifest
          ? ((await cachedManifest.json()) as CommentaryManifest).version
          : null;
        let catalogDone = oldVersion === manifest.version ? 1 : 0;
        for (const url of chunkUrls) if (await cache.match(url)) catalogDone++;
        const total = urls.length + chunkUrls.length + 1;
        update({
          done: done + catalogDone,
          total,
          readingsReady: true,
          catalogReady: catalogDone === chunkUrls.length + 1,
          error: null,
        });
        if (catalogDone === chunkUrls.length + 1) return;
        if (!navigator.onLine)
          throw new Error(
            "Reconnect to finish saving historical commentaries.",
          );
        for (const url of chunkUrls) {
          if (controller.signal.aborted) return;
          if (await cache.match(url)) continue;
          const response = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (response.status === 401) throw expiredSession();
          if (
            !response.ok ||
            !response.headers.get("content-type")?.includes("gzip")
          )
            throw new Error(
              "A commentary chunk could not be saved. Retry when connected.",
            );
          try {
            await cache.put(url, response);
          } catch {
            throw new Error(
              "Device storage could not hold the commentary catalog. Free space and retry.",
            );
          }
          catalogDone++;
          update({
            done: done + catalogDone,
            total,
            readingsReady: true,
            error: null,
          });
        }
        if (fetchedManifest) {
          const check = await fetch(COMMENTARY_MANIFEST_URL, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (check.status === 401) throw expiredSession();
          if (
            !check.ok ||
            ((await check.json()) as CommentaryManifest).version !==
              manifest.version
          )
            throw new Error(
              "The commentary catalog changed during download. Retry to finish.",
            );
          try {
            await cache.put(COMMENTARY_MANIFEST_URL, manifestResponse);
          } catch {
            throw new Error(
              "Device storage could not finish the commentary catalog. Free space and retry.",
            );
          }
          catalogDone++;
        }
        update({
          done: done + catalogDone,
          total,
          readingsReady: true,
          catalogReady: catalogDone === chunkUrls.length + 1,
          error: null,
        });
        if (catalogDone === chunkUrls.length + 1) {
          const active = new Set(chunkUrls);
          try {
            for (const request of await cache.keys()) {
              const url = new URL(request.url);
              if (
                url.pathname.startsWith("/api/offline-commentaries/books/") &&
                !active.has(url.pathname + url.search)
              )
                await cache.delete(request);
            }
          } catch {
            /* Old chunks can be reclaimed on a later visit. */
          }
        }
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

  const ready =
    state.total > 0 &&
    state.done === state.total &&
    !state.error &&
    (!availability.bible || state.catalogReady === true);
  const planLabel =
    availability.bible && availability.catechism
      ? "Bible and Catechism readings"
      : availability.bible
        ? "Bible readings"
        : "Catechism readings";
  const readyLabel = availability.bible
    ? `${planLabel} and historical commentaries ready offline`
    : `${planLabel} ready offline; available episode text saved`;
  return (
    <div
      className="offline-status"
      role="status"
      aria-live="polite"
      title={
        availability.bible
          ? "The enabled plans, available episode text, and historical commentary catalog are saved on this device. Notes and progress need a connection."
          : "The enabled plan and available episode text are saved on this device. Notes and progress need a connection."
      }
    >
      {ready ? (
        readyLabel
      ) : state.error ? (
        <>
          {state.readingsReady
            ? "Readings ready; commentary setup incomplete"
            : "Offline setup incomplete"}{" "}
          ({state.done}/{state.total}). {state.error}{" "}
          <button onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </>
      ) : state.total ? (
        `${state.readingsReady ? "Saving historical commentaries" : "Saving readings for offline use"}: ${state.done}/${state.total}`
      ) : (
        "Preparing offline readings…"
      )}
    </div>
  );
}
