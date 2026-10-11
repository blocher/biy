import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { noticeKey, readDismissals, saveDismissal } from "./offlineNotice";
import type { EditionAvailability } from "./Edition";
import type { Library } from "./types";
import {
  COMMENTARY_MANIFEST_URL,
  READING_CACHE_PREFIX,
  commentaryBookUrl,
  type CommentaryManifest,
} from "./offlineCommentaries";

const SHELL_CACHE = "biy-shell-v1";
const STATE_CACHE = "biy-offline-state-v1";
const OWNER_KEY = "/__biy_offline_owner__";
const SESSION_KEY = "/__biy_offline_session__";

type State = {
  done: number;
  total: number;
  readingsReady: boolean;
  catalogReady?: boolean;
  error: string | null;
  catalogVersion?: string;
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
  user: string,
  signal: AbortSignal,
  refresh: boolean,
): Promise<Library> {
  const url = `/api/library?edition=${edition}`;
  if (!navigator.onLine) {
    const cached = await cache.match(url);
    if (!cached) throw new Error("Reconnect to finish saving readings.");
    return cached.json() as Promise<Library>;
  }
  const response = await fetch(url, {
    credentials: "same-origin",
    signal,
    cache: refresh ? "reload" : "default",
  });
  if (response.status === 401) throw expiredSession();
  if (!response.ok) throw new Error("Could not load the reading plan.");
  const library = (await response.clone().json()) as Library;
  await putPrivate(cache, url, response, user, signal);
  return library;
}

async function currentOwner(user: string, signal: AbortSignal) {
  if (signal.aborted) return false;
  const saved = await (await caches.open(STATE_CACHE)).match(OWNER_KEY);
  return !signal.aborted && (await saved?.text()) === user;
}

async function putPrivate(
  cache: Cache,
  key: string,
  response: Response,
  user: string,
  signal: AbortSignal,
) {
  if (!(await currentOwner(user, signal)))
    throw new DOMException("Session changed", "AbortError");
  await cache.put(key, response);
  if (!(await currentOwner(user, signal))) {
    await caches.delete(READING_CACHE_PREFIX + encodeURIComponent(user));
    throw new DOMException("Session changed", "AbortError");
  }
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

const OfflineContext = createContext<ReactNode>(null);

export function OfflineSettings() {
  return useContext(OfflineContext);
}

export function OfflineStatus({
  user,
  availability,
  children,
}: {
  user: string;
  availability: EditionAvailability;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({
    done: 0,
    total: 0,
    readingsReady: false,
    error: null,
  });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(true);
  const running = useRef(true);
  const forceRefresh = useRef(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [dismissed, setDismissed] = useState(() => readDismissals(user));
  const location = useLocation();
  const request = (refresh = forceRefresh.current) => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    forceRefresh.current = refresh;
    setBusy(true);
    setRetry((value) => value + 1);
  };
  useEffect(() => {
    const refresh = forceRefresh.current;
    running.current = true;
    setBusy(true);
    setState({ done: 0, total: 0, readingsReady: false, error: null });
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      setState({
        done: 0,
        total: 0,
        readingsReady: false,
        error: "Offline saving is not supported in this browser.",
      });
      running.current = false;
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    const update = (next: State) => {
      if (live) setState(next);
    };
    async function prepare() {
      let failed = false;
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
            cache: refresh ? "reload" : "default",
          });
          if (response.status === 401) throw expiredSession();
          if (!response.ok)
            throw new Error(
              "Could not verify your offline session. Check your connection and retry; saved content is still available.",
            );
          if ((await response.json()).user?.username !== user)
            throw expiredSession();
        }
        const sessionCache = await caches.open(STATE_CACHE);
        const savedSession = await sessionCache.match(SESSION_KEY);
        if (
          !(await currentOwner(user, controller.signal)) ||
          !savedSession ||
          (await savedSession.json()).user?.username !== user
        )
          throw new Error("Reconnect to finish saving your offline session.");
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
        await putPrivate(
          cache,
          "/api/preferences",
          preferences,
          user,
          controller.signal,
        );
        const editions = (["bible", "catechism"] as const).filter(
          (edition) => availability[edition],
        );
        const libraries = await Promise.all(
          editions.map((edition) =>
            getLibrary(edition, cache, user, controller.signal, refresh),
          ),
        );
        const urls = readingUrls(libraries);
        let done = 0;
        for (const url of urls)
          if (!refresh && (await cache.match(url))) done++;
        update({
          done,
          total: urls.length,
          readingsReady: done === urls.length,
          error: null,
        });
        if (done < urls.length && !navigator.onLine) {
          failed = true;
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
            if (!refresh && (await cache.match(url))) continue;
            try {
              const response = await fetch(url, {
                credentials: "same-origin",
                signal: controller.signal,
                cache: refresh ? "reload" : "default",
              });
              if (response.status === 401) throw expiredSession();
              if (
                !response.ok ||
                !response.headers.get("content-type")?.includes("json")
              )
                throw new Error(
                  "A reading could not be saved. The download will resume when you reconnect.",
                );
              await putPrivate(cache, url, response, user, controller.signal);
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
              cache: refresh ? "reload" : "default",
            });
            if (response.status === 401) throw expiredSession();
            if (!response.ok && refresh)
              throw new Error(
                "Could not refresh historical commentaries. Saved content is still available.",
              );
            if (response.ok) {
              manifestResponse = response;
              fetchedManifest = true;
            }
          } catch (error) {
            if (
              refresh ||
              controller.signal.aborted ||
              (error as Error).name === "UnauthorizedOffline"
            )
              throw error;
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
        let catalogDone = !refresh && oldVersion === manifest.version ? 1 : 0;
        for (const url of chunkUrls)
          if (!refresh && (await cache.match(url))) catalogDone++;
        const total = urls.length + chunkUrls.length + 1;
        update({
          done: done + catalogDone,
          total,
          readingsReady: true,
          catalogReady: catalogDone === chunkUrls.length + 1,
          catalogVersion: manifest.version,
          error: null,
        });
        if (catalogDone === chunkUrls.length + 1) return;
        if (!navigator.onLine)
          throw new Error(
            "Reconnect to finish saving historical commentaries.",
          );
        for (const url of chunkUrls) {
          if (controller.signal.aborted) return;
          if (!refresh && (await cache.match(url))) continue;
          const response = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal,
            cache: refresh ? "reload" : "default",
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
            await putPrivate(cache, url, response, user, controller.signal);
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
            catalogVersion: manifest.version,
          });
        }
        if (fetchedManifest) {
          const check = await fetch(COMMENTARY_MANIFEST_URL, {
            credentials: "same-origin",
            signal: controller.signal,
            cache: refresh ? "reload" : "default",
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
            await putPrivate(
              cache,
              COMMENTARY_MANIFEST_URL,
              manifestResponse,
              user,
              controller.signal,
            );
          } catch {
            throw new Error(
              "Device storage could not finish the commentary catalog. Free space and retry.",
            );
          }
          if (refresh || oldVersion !== manifest.version) catalogDone++;
        }
        update({
          done: done + catalogDone,
          total,
          readingsReady: true,
          catalogReady: catalogDone === chunkUrls.length + 1,
          catalogVersion: manifest.version,
          error: null,
        });
      } catch (error) {
        failed = true;
        if (!controller.signal.aborted && live)
          setState((current) => ({
            ...current,
            error:
              error instanceof TypeError
                ? "Could not save readings. Check your connection and retry; previously saved content remains available."
                : (error as Error).message,
          }));
      } finally {
        if (live) {
          // Retry/reconnect must finish the failed refresh, not just count old cache entries.
          if (!failed) forceRefresh.current = false;
          running.current = false;
          setBusy(false);
        }
      }
    }
    void prepare();
    const reconnect = () => {
      setOnline(true);
      request();
    };
    const disconnected = () => setOnline(false);
    const resumed = () => {
      if (document.visibilityState === "visible") request();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnected);
    document.addEventListener("visibilitychange", resumed);
    return () => {
      live = false;
      controller.abort();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", disconnected);
      document.removeEventListener("visibilitychange", resumed);
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
  const message = busy
    ? state.total
      ? `${state.readingsReady ? "Saving historical commentaries" : "Saving readings for offline use"}: ${state.done}/${state.total}`
      : "Preparing offline readings…"
    : state.error
      ? `${state.readingsReady ? "Readings ready; commentary setup incomplete" : "Offline setup incomplete"} (${state.done}/${state.total}). ${state.error}`
      : readyLabel;
  const key = noticeKey({
    availability,
    ready,
    busy,
    error: state.error,
    total: state.total,
    version: state.catalogVersion,
  });
  const hidden = busy ? dismissed.length > 0 : dismissed.includes(key);
  const dismiss = () => {
    const next = saveDismissal(user, dismissed, key);
    setDismissed(next);
  };
  const supported = "serviceWorker" in navigator && "caches" in window;
  const settings = (
    <section
      className="account-card offline-settings"
      id="offline-readings"
      aria-labelledby="offline-heading"
    >
      <h2 id="offline-heading">Offline readings</h2>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!online && (
        <p>
          You’re offline. Saved content remains available; reconnect to refresh
          or finish downloading.
        </p>
      )}
      <p>
        Offline preparation includes: {planLabel}, enabled reading plans, and
        available episode text
        {availability.bible ? ", plus historical commentaries" : ""}.
      </p>
      <p>
        Refresh saved readings downloads the latest versions of this content.
        Notes, progress, and audio need a connection and are not synced by this
        control.
      </p>
      <button
        type="button"
        className="outline-button"
        disabled={busy || !online || !supported}
        onClick={() => request(true)}
      >
        {busy
          ? "Saving readings…"
          : state.error
            ? "Retry saving readings"
            : "Refresh saved readings"}
      </button>
      <p className="quiet">
        Automatic preparation resumes when you reconnect. Refresh keeps your
        saved content available while downloading.
      </p>
    </section>
  );
  return (
    <OfflineContext.Provider value={settings}>
      {children}
      {!hidden && location.pathname !== "/account" && (
        <div className="offline-status">
          <div>
            <p role="status" aria-live="polite">
              {message}
            </p>
            <Link to="/account#offline-readings">Offline settings</Link>
            {state.error && !busy && (
              <button
                type="button"
                disabled={!online || !supported}
                onClick={() => request()}
              >
                Retry
              </button>
            )}
          </div>
          <button
            type="button"
            className="offline-dismiss"
            aria-label="Dismiss offline notice"
            onClick={dismiss}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </OfflineContext.Provider>
  );
}
