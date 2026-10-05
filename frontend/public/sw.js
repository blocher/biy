const SHELL_CACHE = "biy-shell-v1";
const STAGING_PREFIX = "biy-shell-staging-";
const DATA_PREFIX = "biy-reading-v1-";
const STATE_CACHE = "biy-offline-state-v1";
const OWNER_KEY = "/__biy_offline_owner__";
const SESSION_KEY = "/__biy_offline_session__";
let authGeneration = 0;

async function owner() {
  const response = await (await caches.open(STATE_CACHE)).match(OWNER_KEY);
  return response ? response.text() : null;
}

async function dataCache() {
  const username = await owner();
  return username
    ? caches.open(DATA_PREFIX + encodeURIComponent(username))
    : null;
}

async function clearPrivateData() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(DATA_PREFIX) || name === STATE_CACHE)
      .map((name) => caches.delete(name)),
  );
}

async function setOwner(username) {
  const previous = await owner();
  if (previous && previous !== username) await clearPrivateData();
  if (username) {
    const currentCache = DATA_PREFIX + encodeURIComponent(username);
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(DATA_PREFIX) && name !== currentCache)
        .map((name) => caches.delete(name)),
    );
    await (
      await caches.open(STATE_CACHE)
    ).put(OWNER_KEY, new Response(username));
  } else {
    await clearPrivateData();
  }
}

function privatePath(pathname) {
  return (
    pathname === "/api/preferences" ||
    pathname === "/api/library" ||
    /^\/api\/(days\/\d+|episodes\/\d+)$/.test(pathname)
  );
}

function shellAssets(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
    (match) => match[1],
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const stageName = STAGING_PREFIX + crypto.randomUUID();
      try {
        const cache = await caches.open(stageName);
        const index = await fetch("/", { cache: "reload" });
        if (!index.ok) throw new Error("App shell unavailable");
        const assets = shellAssets(await index.clone().text());
        await cache.addAll([
          ...assets,
          "/manifest.webmanifest",
          "/icons/icon-192.png",
        ]);
        await cache.put("/", index);
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(stageName);
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const stages = (await caches.keys()).filter((name) =>
        name.startsWith(STAGING_PREFIX),
      );
      const stageName = stages.at(-1);
      if (stageName) {
        const stage = await caches.open(stageName);
        const shell = await caches.open(SHELL_CACHE);
        // Keep the previous index until every new asset has been copied.
        for (const request of await stage.keys()) {
          if (new URL(request.url).pathname === "/") continue;
          const response = await stage.match(request);
          if (response) await shell.put(request, response);
        }
        const index = await stage.match("/");
        if (index) await shell.put("/", index);
        await Promise.all(stages.map((name) => caches.delete(name)));
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PRIVATE_DATA") {
    authGeneration++;
    event.waitUntil(clearPrivateData());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    request.method === "POST" &&
    (url.pathname === "/api/logout" || url.pathname === "/api/login")
  ) {
    event.respondWith(
      (async () => {
        const generation = ++authGeneration;
        const response = await fetch(request);
        if (response.ok && generation === authGeneration) {
          try {
            await clearPrivateData();
          } catch {
            /* Keep the auth response usable. */
          }
        }
        return response;
      })(),
    );
    return;
  }
  if (request.method !== "GET") return;

  if (url.pathname === "/api/session") {
    event.respondWith(
      (async () => {
        const generation = authGeneration;
        try {
          const response = await fetch(request);
          if (response.ok && generation === authGeneration) {
            try {
              const session = await response.clone().json();
              await setOwner(session.user?.username || null);
              if (session.user)
                await (
                  await caches.open(STATE_CACHE)
                ).put(SESSION_KEY, response.clone());
            } catch {
              /* The live session still works if device storage is full. */
            }
          }
          return response;
        } catch {
          return (
            (await caches.open(STATE_CACHE)).match(SESSION_KEY) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  if (privatePath(url.pathname)) {
    event.respondWith(
      (async () => {
        const generation = authGeneration;
        const cacheKey =
          url.pathname === "/api/preferences" ? "/api/preferences" : request;
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            generation === authGeneration &&
            response.headers.get("content-type")?.includes("json")
          ) {
            try {
              const cache = await dataCache();
              if (cache && generation === authGeneration)
                await cache.put(cacheKey, response.clone());
            } catch {
              /* Do not fail an online read because offline storage is full. */
            }
          }
          if (response.status === 401) {
            try {
              await clearPrivateData();
            } catch {
              /* The server response is authoritative. */
            }
          }
          return response;
        } catch {
          const cache = await dataCache();
          return (cache && (await cache.match(cacheKey))) || Response.error();
        }
      })(),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            response.headers.get("content-type")?.includes("text/html")
          )
            try {
              const assets = shellAssets(await response.clone().text());
              const entries = await Promise.all(
                assets.map((asset) => cache.match(asset)),
              );
              if (entries.every(Boolean))
                await cache.put("/", response.clone());
            } catch {
              /* Continue online. */
            }
          return response;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok)
          try {
            await cache.put(request, response.clone());
          } catch {
            /* Continue online. */
          }
        return response;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Bible in a Year", {
      body: payload.body || "Your reading is ready when you are.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) =>
          client.url.startsWith(self.location.origin),
        );
        if (existing) {
          existing.navigate(target);
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
