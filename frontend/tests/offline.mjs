import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";

const dist = resolve("dist");
const fullFixture = process.env.BIY_FULL_FIXTURE === "1";
const oneEdition = process.env.BIY_ONE_EDITION === "1";
const readyText = oneEdition
  ? "Bible readings ready offline; available episode commentary saved"
  : "Bible and Catechism readings ready offline; available episode commentary saved";
const fixtureRoot = process.env.BIY_FIXTURE_ROOT || "/tmp/biy_offline_fixture";
let interrupt = true;
let signedIn = true;
const counts = new Map();
const episode = {
  id: 99,
  title: "Extra teaching",
  day: null,
  era: null,
  color: "#123f34",
  duration: 100,
  status: "ready",
  has_audio: false,
  source_date: "2025-01-01",
  published_at: "2025-01-01",
  transcript: [],
  commentary: [
    {
      id: 1,
      start: 0,
      end: 1,
      speaker: "Teacher",
      text: "Offline episode commentary",
    },
  ],
  edited_commentary: [],
  summary: "Offline commentary summary",
  key_points: [],
  outline: [],
};
const day = (number, edition) => ({
  number,
  edition,
  readings: ["Genesis 1"],
  era: "Beginnings",
  color: "#123f34",
  completed_at: null,
  episode,
  catechism:
    edition === "catechism"
      ? [{ number, text: "Offline catechism text", source_url: "" }]
      : [],
  scripture:
    edition === "bible"
      ? [
          {
            reference: "Genesis 1",
            groups: [
              {
                book: "Genesis",
                missing: false,
                verses: [
                  {
                    chapter: 1,
                    verse: 1,
                    text: "Offline Scripture text",
                    paragraph: true,
                  },
                ],
              },
            ],
          },
        ]
      : [],
});
const library = (edition) => ({
  edition,
  days: (edition === "bible" ? [1, 2] : [1]).map((number) => {
    const { scripture, catechism, ...card } = day(number, edition);
    return card;
  }),
  extras: edition === "bible" ? [episode] : [],
  completed: 0,
  next_day: 1,
});
const json = (res, value, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  counts.set(url.pathname, (counts.get(url.pathname) || 0) + 1);
  if (url.pathname === "/api/session")
    return json(res, {
      user: signedIn ? { username: "ben", is_admin: false } : null,
      csrf: "test",
    });
  if (url.pathname === "/api/logout") {
    signedIn = false;
    return json(res, { ok: true });
  }
  if (url.pathname === "/api/preferences")
    return json(res, {
      bible_enabled: true,
      catechism_enabled: !oneEdition,
      progress_basis: "first-completion",
      notification_setup_completed: true,
      morning_reminder_enabled: false,
      evening_reminder_enabled: false,
    });
  if (fullFixture && url.pathname === "/api/library") {
    const edition = url.searchParams.get("edition") || "bible";
    return json(
      res,
      JSON.parse(
        await readFile(join(fixtureRoot, `library-${edition}.json`), "utf8"),
      ),
    );
  }
  if (fullFixture && /^\/api\/days\/\d+$/.test(url.pathname)) {
    const edition = url.searchParams.get("edition") || "bible";
    const number = url.pathname.split("/").at(-1);
    return json(
      res,
      JSON.parse(
        await readFile(
          join(fixtureRoot, `day-${edition}-${number}.json`),
          "utf8",
        ),
      ),
    );
  }
  if (fullFixture && /^\/api\/episodes\/\d+$/.test(url.pathname)) {
    const number = url.pathname.split("/").at(-1);
    return json(
      res,
      JSON.parse(
        await readFile(join(fixtureRoot, `episode-${number}.json`), "utf8"),
      ),
    );
  }
  if (url.pathname === "/api/library")
    return json(res, library(url.searchParams.get("edition") || "bible"));
  if (url.pathname === "/api/days/2" && interrupt)
    return json(res, { detail: "Interrupted" }, 503);
  if (url.pathname.startsWith("/api/days/"))
    return json(
      res,
      day(
        Number(url.pathname.split("/").at(-1)),
        url.searchParams.get("edition") || "bible",
      ),
    );
  if (url.pathname === "/api/episodes/99") return json(res, episode);
  if (url.pathname.startsWith("/api/"))
    return json(res, { detail: "Not in fixture" }, 404);
  const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const bytes = await readFile(join(dist, path));
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      }[extname(path)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(bytes);
  } catch {
    const bytes = await readFile(join(dist, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(bytes);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let serverClosed = false;
const isWebKit = process.env.BIY_BROWSER === "webkit";
const browser = await (isWebKit ? webkit : chromium).launch(
  isWebKit ? { headless: true } : { channel: "chrome", headless: true },
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "allow",
  ...(isWebKit ? { isMobile: true, hasTouch: true } : {}),
});
if (isWebKit)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    localStorage.setItem(
      "biy-notification-setup-dismissed-on-this-device",
      "true",
    );
  });
const page = await context.newPage();
page.on("pageerror", (error) => console.error("Page error:", error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error("Browser:", message.text());
});
try {
  await page.goto(origin);
  if (fullFixture) {
    await page.getByText(readyText).waitFor({ timeout: 120000 });
    const storage = await page.evaluate(async () => {
      const cache = await caches.open("biy-reading-v1-ben");
      const keys = await cache.keys();
      let bytes = 0;
      for (const key of keys) {
        const response = await cache.match(key);
        bytes += (await response.arrayBuffer()).byteLength;
      }
      const estimate = await navigator.storage.estimate();
      return {
        entries: keys.length,
        responseBytes: bytes,
        reportedUsage: estimate.usage,
      };
    });
    console.log("Full-size cache", storage);
    assert.ok(
      storage.entries >= 755,
      "all 730 days, 22 extras, libraries, and preferences should be cached",
    );
    assert.ok(
      storage.responseBytes > 14_000_000,
      "full local reading content should be stored",
    );
    if (isWebKit) {
      await new Promise((resolve) => server.close(resolve));
      serverClosed = true;
    } else {
      await context.setOffline(true);
    }
    await page.goto(origin + "/bible/day/365/reader?tab=scripture");
    await page.locator(".scripture-text").waitFor({ timeout: 15000 });
    const lastDays = await page.evaluate(async () => {
      const bible = await (await fetch("/api/days/365?edition=bible")).json();
      const catechism = await (
        await fetch("/api/days/365?edition=catechism")
      ).json();
      return {
        bible: bible.scripture.length,
        catechism: catechism.catechism.length,
      };
    });
    assert.ok(lastDays.bible > 0 && lastDays.catechism > 0);
    console.log(
      "Full-size offline cold restart and last-day navigation passed",
      lastDays,
    );
  } else {
    try {
      await page
        .getByText(/Offline setup incomplete/)
        .waitFor({ timeout: 20000 });
    } catch (error) {
      console.error(
        "Page text:",
        (await page.locator("body").innerText()).slice(0, 1500),
      );
      console.error("Requests:", Object.fromEntries(counts));
      throw error;
    }
    assert.ok(
      (counts.get("/api/days/1") || 0) > 0,
      "first reading should download before interruption",
    );
    interrupt = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText(readyText).waitFor({ timeout: 20000 });
    if (isWebKit) {
      await new Promise((resolve) => server.close(resolve));
      serverClosed = true;
    } else {
      await context.setOffline(true);
    }
    await page.goto(origin + "/bible/day/1/reader?tab=scripture");
    await page.getByText("Offline Scripture text").waitFor({ timeout: 15000 });
    const cached = await page.evaluate(async (oneEdition) => {
      const paths = [
        "/api/days/2?edition=bible",
        ...(!oneEdition ? ["/api/days/1?edition=catechism"] : []),
        "/api/episodes/99?edition=bible",
      ];
      return Promise.all(
        paths.map(async (path) => {
          const response = await fetch(path);
          return response.ok ? response.json() : null;
        }),
      );
    }, oneEdition);
    assert.equal(cached[0].number, 2);
    if (!oneEdition)
      assert.equal(cached[1].catechism[0].text, "Offline catechism text");
    assert.equal(
      cached.at(-1).commentary[0].text,
      "Offline episode commentary",
    );
    assert.ok(await page.getByText(readyText).isVisible());
    await page.goto(origin + "/commentaries?day=1");
    await page
      .getByText("Historical commentaries unavailable", { exact: true })
      .waitFor({ timeout: 15000 });
    if (!isWebKit) {
      await context.setOffline(false);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(origin + "/bible");
      await page.getByRole("button", { name: "Sign out" }).first().click();
      await page
        .getByRole("button", { name: "Continue your journey" })
        .waitFor();
      const privateEntries = await page.evaluate(async () => {
        const names = await caches.keys();
        const data = names.filter((name) => name.startsWith("biy-reading-"));
        const state = names.includes("biy-offline-state-v1")
          ? await (await caches.open("biy-offline-state-v1")).keys()
          : [];
        return { data, state: state.map((request) => request.url) };
      });
      assert.deepEqual(
        privateEntries,
        { data: [], state: [] },
        "sign-out should remove private offline content",
      );
    }
    console.log(
      `Offline cold restart, ${oneEdition ? "one enabled edition" : "both editions"}, commentary, and interrupted download resume passed`,
    );
  }
} finally {
  await context.close();
  await browser.close();
  if (!serverClosed) await new Promise((resolve) => server.close(resolve));
}
