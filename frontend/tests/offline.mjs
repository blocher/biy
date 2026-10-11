import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";

const dist = resolve("dist");
const fullFixture = process.env.BIY_FULL_FIXTURE === "1";
const oneEdition = process.env.BIY_ONE_EDITION === "1";
const catechismOnly = process.env.BIY_CATECHISM_ONLY === "1";
const storageFailure = process.env.BIY_STORAGE_FAILURE === "1";
const readyText = catechismOnly
  ? "Catechism readings ready offline; available episode text saved"
  : oneEdition
    ? "Bible readings and historical commentaries ready offline"
    : "Bible and Catechism readings and historical commentaries ready offline";
const fixtureRoot = process.env.BIY_FIXTURE_ROOT || "/tmp/biy_offline_fixture";
let interrupt = true;
let interruptCatalog = true;
let signedIn = true;
const ux = process.env.BIY_OFFLINE_UX === "1";
let revision = 1;
let delay = false;
let networkFailure = false;
let sessionFailure = false;
let profileFailure = false;
let profile = {
  username: "ben",
  first_name: "Ben",
  last_name: "Reader",
  email: "reader@example.test",
};
const profileWrites = [];
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
                    text:
                      revision === 1
                        ? "Offline Scripture text"
                        : "Refreshed Scripture text",
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
const catalogRows = [
  {
    id: "early",
    database_id: 1,
    author: "Early Witness",
    author_metadata: {
      name: "Early Witness",
      category: "Early Fathers",
      default_year: 100,
      year_label: "c. AD 100",
      wiki_url: "",
      condemned_by_council: false,
    },
    year: 100,
    year_label: "c. AD 100",
    source_title: "Early source",
    source_url: "",
    text: "Offline historical commentary",
    book: "genesis",
    location_start: 1000001,
    location_end: 1000001,
    matched_readings: [],
  },
  {
    id: "later",
    database_id: 2,
    author: "Later Witness",
    author_metadata: {
      name: "Later Witness",
      category: "Later Fathers",
      default_year: 300,
      year_label: "c. AD 300",
      wiki_url: "",
      condemned_by_council: false,
    },
    year: 300,
    year_label: "c. AD 300",
    source_title: "Later source",
    source_url: "",
    text: "Later historical commentary",
    book: "genesis",
    location_start: 1000001,
    location_end: 1000002,
    matched_readings: [],
  },
];
const catalogManifest = {
  version: "fixture-1",
  books: ["genesis"],
  days: Object.fromEntries(
    [1, 2].map((number) => [
      String(number),
      {
        readings: ["Genesis 1"],
        ranges: [
          {
            reference: "Genesis 1",
            book: "genesis",
            start: 1000001,
            end: 1999999,
          },
        ],
      },
    ]),
  ),
  filters: {
    categories: ["Early Fathers", "Later Fathers"],
    min_year: 100,
    max_year: 300,
  },
  matching_notes: ["Offline catalog fixture"],
};
const json = (res, value, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  counts.set(url.pathname, (counts.get(url.pathname) || 0) + 1);
  if (url.pathname === "/api/account") {
    if (req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      profile = JSON.parse(body);
      profileWrites.push(profile);
      return json(res, profile);
    }
    return json(
      res,
      profileFailure ? { detail: "Profile unavailable" } : profile,
      profileFailure ? 503 : 200,
    );
  }
  if (url.pathname === "/api/push/subscriptions") return json(res, []);
  if (delay && url.pathname.startsWith("/api/days/"))
    await new Promise((resolve) => setTimeout(resolve, 250));
  if (networkFailure && url.pathname === "/api/days/2") return res.destroy();
  if (sessionFailure && url.pathname === "/api/session")
    return json(res, { detail: "Session unavailable" }, 503);
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
      bible_enabled: !catechismOnly,
      catechism_enabled: !oneEdition,
      progress_basis: "first-completion",
      notification_setup_completed: true,
      notification_timezone: "UTC",
      morning_reminder_enabled: false,
      evening_reminder_enabled: false,
    });
  if (url.pathname === "/api/offline-commentaries/manifest")
    return json(
      res,
      fullFixture
        ? JSON.parse(
            await readFile(
              join(fixtureRoot, "commentary-manifest.json"),
              "utf8",
            ),
          )
        : catalogManifest,
    );
  if (
    fullFixture &&
    url.pathname.startsWith("/api/offline-commentaries/books/")
  ) {
    const book = url.pathname.split("/").at(-1);
    const bytes = await readFile(
      join(fixtureRoot, `commentary-book-${book}.gz`),
    );
    res.writeHead(200, { "Content-Type": "application/gzip" });
    res.end(bytes);
    return;
  }
  if (url.pathname === "/api/offline-commentaries/books/genesis") {
    if (interruptCatalog)
      return json(res, { detail: "Interrupted catalog" }, 503);
    res.writeHead(200, { "Content-Type": "application/gzip" });
    res.end(gzipSync(JSON.stringify(catalogRows)));
    return;
  }
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
  isWebKit
    ? { headless: true }
    : {
        ...(process.env.BIY_CHROMIUM_PATH
          ? { executablePath: process.env.BIY_CHROMIUM_PATH }
          : {}),
        headless: true,
      },
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "allow",
  ...(isWebKit || ux ? { isMobile: true, hasTouch: true } : {}),
});
if (isWebKit || ux)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true });
    localStorage.setItem(
      "biy-notification-setup-dismissed-on-this-device",
      "true",
    );
  });
if (storageFailure)
  await context.addInitScript(() => {
    const original = Cache.prototype.put;
    Cache.prototype.put = function (key, response) {
      if (String(key).includes("/api/offline-commentaries/books/"))
        return Promise.reject(
          new DOMException("Quota exceeded", "QuotaExceededError"),
        );
      return original.call(this, key, response);
    };
  });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("pageerror", (error) => console.error("Page error:", error.message));
page.on("console", (message) => {
  if (message.type() === "error") console.error("Browser:", message.text());
});
try {
  await page.goto(origin);
  if (catechismOnly) {
    await page.getByText(readyText).waitFor({ timeout: 20000 });
    assert.equal(counts.get("/api/offline-commentaries/manifest") || 0, 0);
    await context.setOffline(true);
    await page.goto(origin + "/catechism/day/1/reader?tab=catechism");
    await page.getByText("Offline catechism text").waitFor({ timeout: 15000 });
    console.log(
      "Catechism-only plan skips the historical catalog and opens offline",
    );
  } else if (fullFixture) {
    await page.getByText(readyText).waitFor({ timeout: 120000 });
    const storage = await page.evaluate(async () => {
      const cache = await caches.open("biy-reading-v1-ben");
      const keys = await cache.keys();
      const manifest = await (
        await cache.match("/api/offline-commentaries/manifest")
      ).json();
      let bytes = 0;
      for (const key of keys) {
        const response = await cache.match(key);
        bytes += (await response.arrayBuffer()).byteLength;
      }
      const estimate = await navigator.storage.estimate();
      return {
        entries: keys.length,
        books: manifest.books.length,
        responseBytes: bytes,
        reportedUsage: estimate.usage,
      };
    });
    console.log("Full-size cache", storage);
    assert.ok(
      storage.entries >= 756 + storage.books,
      "all readings, extras, settings, and unique commentary book chunks should be cached",
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
    await page.goto(origin + "/commentaries?day=1");
    await page.locator(".commentary-card").first().waitFor({ timeout: 20000 });
    const expectedCases = JSON.parse(
      await readFile(join(fixtureRoot, "commentary-expected.json"), "utf8"),
    );
    for (const item of expectedCases) {
      await page.goto(origin + "/commentaries?" + item.query);
      await page
        .locator(".commentary-card")
        .first()
        .waitFor({ timeout: 20000 });
      const actual = await page
        .locator(".commentary-card")
        .evaluateAll((cards) =>
          cards.map((card) => Number(card.id.replace("commentary-", ""))),
        );
      assert.deepEqual(
        actual,
        item.ids,
        `Offline commentary order for ${item.query}`,
      );
      assert.match(
        await page.locator(".commentary-count").innerText(),
        new RegExp(`^${item.total.toLocaleString()}`),
      );
    }
    console.log(
      "Full-size offline cold restart, last-day navigation, and historical commentary passed",
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
    if (storageFailure) interruptCatalog = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await page
      .getByText(/Readings ready; commentary setup incomplete/)
      .waitFor({ timeout: 20000 });
    if (storageFailure) {
      await page
        .getByText(/Device storage could not hold the commentary catalog/)
        .waitFor();
      await context.setOffline(true);
      await page.goto(origin + "/bible/day/1/reader?tab=scripture");
      await page
        .getByText("Offline Scripture text")
        .waitFor({ timeout: 15000 });
      console.log(
        "Storage failure leaves saved readings usable and readiness incomplete",
      );
    } else {
      interruptCatalog = false;
      await page.getByRole("button", { name: "Retry" }).click();
      await page.getByText(readyText).waitFor({ timeout: 20000 });
      if (ux) {
        const screenshots = resolve("../data/screenshots/offline-status");
        await mkdir(screenshots, { recursive: true });
        const banner = page.locator(".offline-status");
        const contrast = async (selector) =>
          page.locator(selector).evaluate((el) => {
            const style = getComputedStyle(el);
            const luminance = (value) => {
              const rgb = value
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map((v) => Number(v) / 255)
                .map((v) =>
                  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
                );
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            let bg = el;
            while (
              getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)" &&
              bg.parentElement
            )
              bg = bg.parentElement;
            const a = luminance(style.color),
              b = luminance(getComputedStyle(bg).backgroundColor);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (theme) => (document.documentElement.dataset.theme = theme),
            theme,
          );
          assert.ok(
            (await contrast(".offline-status")) >= 4.5,
            `${theme} notice contrast`,
          );
          assert.ok(
            (await contrast(".offline-status a")) >= 4.5,
            `${theme} link contrast`,
          );
          await page.screenshot({
            path: join(screenshots, `phone-notice-${theme}.png`),
          });
        }
        const close = page.getByRole("button", {
          name: "Dismiss offline notice",
        });
        await banner.getByRole("link").focus();
        await page.keyboard.press("Tab");
        await expect(close).toBeFocused();
        assert.ok(
          await close.evaluate(
            (el) => getComputedStyle(el).outlineStyle !== "none",
          ),
        );
        const size = await close.boundingBox();
        assert.ok(size.width >= 44 && size.height >= 44);
        await page.keyboard.press("Enter");
        await expect(banner).toHaveCount(0);
        await page.goto(origin + "/bible/day/1/reader?tab=scripture");
        await page.getByText("Offline Scripture text").waitFor();
        await expect(banner).toHaveCount(0);
        await page.reload();
        await page.getByText("Offline Scripture text").waitFor();
        await expect(banner).toHaveCount(0);
        await page.goto(origin + "/account");
        const panel = page.locator(".offline-settings");
        await expect(panel).toContainText(readyText);
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const theme of ["light", "dark"]) {
            await page.getByLabel("Color theme").selectOption(theme);
            assert.ok(
              (await contrast(".offline-settings p[role=status]")) >= 4.5,
              `${theme} settings contrast`,
            );
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              `No overflow at ${width}`,
            );
            await page.screenshot({
              path: join(screenshots, `account-${width}-${theme}.png`),
              fullPage: true,
            });
          }
        }
        const profileCard = page.locator(".profile-card");
        const saveProfile = profileCard.getByRole("button", {
          name: "Save details",
        });
        await expect(profileCard.getByLabel("First name")).toHaveValue("Ben");
        await profileCard.getByLabel("First name").fill("Edited Ben");
        const profileReads = counts.get("/api/account");
        await context.setOffline(true);
        await expect(saveProfile).toBeDisabled();
        await context.setOffline(false);
        await expect(saveProfile).toBeEnabled();
        await expect(profileCard.getByLabel("First name")).toHaveValue(
          "Edited Ben",
        );
        assert.equal(
          counts.get("/api/account"),
          profileReads,
          "Reconnect does not reload an already loaded profile or discard edits",
        );
        await saveProfile.click();
        await page
          .getByText("Your personal details have been saved.")
          .waitFor();
        assert.deepEqual(profileWrites.at(-1), {
          username: "ben",
          first_name: "Edited Ben",
          last_name: "Reader",
          email: "reader@example.test",
        });
        await expect(panel).toContainText(readyText);
        await context.setOffline(true);
        await page.reload();
        await expect(profileCard).toContainText(
          "Reconnect to load your personal details",
        );
        await expect(profileCard.getByLabel("First name")).toBeDisabled();
        await expect(saveProfile).toBeDisabled();
        let writesBefore = profileWrites.length;
        await profileCard
          .locator("form")
          .evaluate((form) => form.requestSubmit());
        assert.equal(
          profileWrites.length,
          writesBefore,
          "Offline placeholder details cannot be submitted",
        );
        await context.setOffline(false);
        await expect(saveProfile).toBeEnabled();
        await expect(profileCard.getByLabel("First name")).toHaveValue(
          "Edited Ben",
        );
        await saveProfile.click();
        await expect(saveProfile).toBeEnabled();
        assert.deepEqual(
          profileWrites.at(-1),
          {
            username: "ben",
            first_name: "Edited Ben",
            last_name: "Reader",
            email: "reader@example.test",
          },
          "Offline-open/reconnect/save keeps stored names and email",
        );
        await context.setOffline(true);
        await page.reload();
        await expect(saveProfile).toBeDisabled();
        writesBefore = profileWrites.length;
        profileFailure = true;
        await context.setOffline(false);
        await expect(profileCard).toContainText(
          "Could not load your personal details",
        );
        await expect(saveProfile).toBeDisabled();
        await profileCard
          .locator("form")
          .evaluate((form) => form.requestSubmit());
        assert.equal(
          profileWrites.length,
          writesBefore,
          "A failed profile load cannot submit placeholder details after reconnect",
        );
        profileFailure = false;
        await profileCard
          .getByRole("button", { name: "Retry loading details" })
          .click();
        await expect(saveProfile).toBeEnabled();
        await page
          .getByRole("button", { name: "Dismiss message", exact: true })
          .click();
        await expect(profileCard.getByLabel("First name")).toHaveValue(
          "Edited Ben",
        );
        await expect(profileCard.getByLabel("Email address")).toHaveValue(
          "reader@example.test",
        );
        await profileCard.getByLabel("Last name").fill("Updated Reader");
        await saveProfile.click();
        await expect(saveProfile).toBeEnabled();
        assert.deepEqual(profileWrites.at(-1), {
          username: "ben",
          first_name: "Edited Ben",
          last_name: "Updated Reader",
          email: "reader@example.test",
        });
        await expect(panel).toContainText(readyText);
        // Cached revision 1 must be refreshed by banner Retry after a failed revision 2 refresh.
        revision = 2;
        networkFailure = true;
        await panel
          .getByRole("button", { name: "Refresh saved readings" })
          .click();
        await expect(panel).toContainText("Offline setup incomplete");
        await expect(panel).toContainText("Offline preparation includes:");
        await expect(panel).not.toContainText("Saved on this device:");
        const cachedDay2 = () =>
          page.evaluate(
            async () =>
              (
                await (
                  await (
                    await caches.open("biy-reading-v1-ben")
                  ).match("/api/days/2?edition=bible")
                ).json()
              ).scripture[0].groups[0].verses[0].text,
          );
        assert.equal(await cachedDay2(), "Offline Scripture text");
        await page
          .getByRole("link", { name: "Reading plan", exact: true })
          .first()
          .click();
        networkFailure = false;
        await banner
          .getByRole("button", { name: "Retry", exact: true })
          .click();
        await page
          .getByRole("link", { name: "Account", exact: true })
          .first()
          .click();
        await expect(panel).toContainText(readyText);
        assert.equal(
          await cachedDay2(),
          "Refreshed Scripture text",
          "Banner Retry preserves refresh intent and fetches the previously failed reading",
        );
        await page
          .getByRole("link", { name: "Account", exact: true })
          .first()
          .click();
        await expect(panel).toContainText(readyText);
        delay = true;
        const refresh = panel.getByRole("button", {
          name: "Refresh saved readings",
        });
        const before = counts.get("/api/session");
        await refresh.click();
        await expect(panel.getByRole("button")).toBeDisabled();
        await expect(panel).not.toContainText("Saved on this device:");
        await page.evaluate(() => {
          window.dispatchEvent(new Event("online"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await expect(panel).toContainText(readyText);
        assert.equal(
          counts.get("/api/session"),
          before + 1,
          "Repeated actions do not restart preparation",
        );
        delay = false;
        const refreshed = await page.evaluate(
          async () =>
            (
              await (
                await (
                  await caches.open("biy-reading-v1-ben")
                ).match("/api/days/1?edition=bible")
              ).json()
            ).scripture[0].groups[0].verses[0].text,
        );
        assert.equal(refreshed, "Refreshed Scripture text");
        sessionFailure = true;
        await refresh.click();
        await expect(panel).toContainText(
          "Could not verify your offline session",
        );
        assert.ok(
          await page.evaluate(async () =>
            (await caches.keys()).includes("biy-reading-v1-ben"),
          ),
          "Session server outage does not clear downloaded content or sign out",
        );
        sessionFailure = false;
        await panel
          .getByRole("button", { name: "Retry saving readings" })
          .click();
        await expect(panel).toContainText(readyText);
        networkFailure = true;
        await refresh.click();
        await expect(panel).toContainText("Offline setup incomplete");
        const retained = await page.evaluate(
          async () =>
            !!(await (
              await caches.open("biy-reading-v1-ben")
            ).match("/api/days/2?edition=bible")),
        );
        assert.ok(retained, "Interrupted refresh preserves saved readings");
        await page
          .getByRole("link", { name: "Reading plan", exact: true })
          .first()
          .click();
        await expect(banner).toContainText("Offline setup incomplete");
        await page
          .getByRole("button", { name: "Dismiss offline notice" })
          .click();
        await page
          .getByRole("link", { name: "Account", exact: true })
          .first()
          .click();
        await panel
          .getByRole("button", { name: "Retry saving readings" })
          .click();
        await expect(panel).toContainText("Offline setup incomplete");
        await page
          .getByRole("link", { name: "Reading plan", exact: true })
          .first()
          .click();
        await expect(banner).toHaveCount(0);
        await page.reload();
        await expect(page.locator(".offline-status")).toHaveCount(0);
        networkFailure = false;
        catalogManifest.version = "fixture-2";
        await page.goto(origin + "/account");
        await expect(panel).toContainText(readyText);
        await page.goto(origin + "/bible");
        await expect(banner).toContainText(readyText);
        await banner.getByRole("link", { name: "Offline settings" }).click();
        await expect(panel).toBeInViewport();
        await context.setOffline(true);
        await page.reload();
        await expect(panel).toContainText(readyText);
        await expect(panel).toContainText("You’re offline");
        await expect(panel.getByRole("button")).toBeDisabled();
        await page.screenshot({
          path: join(screenshots, "offline-account-dark.png"),
          fullPage: true,
        });
        await page.goto(origin + "/bible/day/1/reader?tab=scripture");
        await page.getByText("Refreshed Scripture text").waitFor();
        await context.setOffline(false);
        revision = 1;
        await page.goto(origin + "/account");
        await expect(panel).toContainText(readyText);
        await panel
          .getByRole("button", { name: "Refresh saved readings" })
          .click();
        await expect(panel).toContainText(readyText);
        await page.goto(origin + "/bible");
        assert.deepEqual(pageErrors, [], "No browser JavaScript errors");
        const unsupportedContext = await browser.newContext();
        await unsupportedContext.addInitScript(() =>
          Reflect.deleteProperty(Navigator.prototype, "serviceWorker"),
        );
        const unsupportedPage = await unsupportedContext.newPage();
        await unsupportedPage.goto(origin + "/account");
        const unsupportedPanel = unsupportedPage.locator(".offline-settings");
        await expect(unsupportedPanel).toContainText(
          "Offline saving is not supported in this browser.",
        );
        await expect(unsupportedPanel).toContainText(
          "Offline preparation includes:",
        );
        await expect(unsupportedPanel).not.toContainText(
          "Saved on this device:",
        );
        await expect(unsupportedPanel.getByRole("button")).toBeDisabled();
        await unsupportedContext.close();
        console.log(
          "Offline UX: failed refresh banner Retry updates stale readings; offline/reconnect/failed-load profile saves preserve data; accurate pending/failure scope; keyboard/touch close, persistence, 390/768/1440 light/dark contrast, settings discovery, disabled pending/offline controls, fresh content, network failure with cache preservation, new catalog notice, and offline Account passed",
        );
      }
      if (isWebKit) {
        await new Promise((resolve) => server.close(resolve));
        serverClosed = true;
      } else {
        await context.setOffline(true);
      }
      await page.goto(origin + "/bible/day/1/reader?tab=scripture");
      await page
        .getByText("Offline Scripture text")
        .waitFor({ timeout: 15000 });
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
      try {
        await page.getByText(readyText).waitFor({ timeout: 15000 });
      } catch (error) {
        console.error(
          "Offline status after restart:",
          await page.locator(".offline-status").innerText(),
        );
        console.error(
          "Saved catalog:",
          await page.evaluate(async () => {
            const cache = await caches.open("biy-reading-v1-ben");
            const keys = (await cache.keys()).map(
              (request) => new URL(request.url).pathname,
            );
            return {
              manifest: keys.includes("/api/offline-commentaries/manifest"),
              books: keys.filter((path) =>
                path.includes("/offline-commentaries/books/"),
              ).length,
              online: navigator.onLine,
            };
          }),
        );
        throw error;
      }
      await page.goto(origin + "/commentaries?day=1");
      await page
        .getByText("Offline historical commentary", { exact: true })
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
  }
} finally {
  await context.close();
  await browser.close();
  if (!serverClosed) await new Promise((resolve) => server.close(resolve));
}
