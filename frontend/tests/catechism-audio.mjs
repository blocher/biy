// Fully mocked API/media acceptance; never changes an account or starts an import.
// Run against this worktree's Vite server: BIY_TEST_URL=http://127.0.0.1:5183 node tests/catechism-audio.mjs
import { chromium, webkit, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.BIY_TEST_URL || "http://127.0.0.1:5183";
const output = process.env.BIY_TEST_OUTPUT || "/tmp/biy-catechism-audio";
fs.mkdirSync(output, { recursive: true });
const episode = {
  id: 901,
  day: 1,
  edition: "catechism",
  title: "Day 1: To Know and Love God",
  status: "ready",
  duration: 100,
  has_audio: true,
  position: 0,
  source_date: "2025-01-01",
  published_at: "2025-01-01",
  era: "Prologue",
  color: "#00798c",
  transcript: [],
  commentary: [
    {
      id: 4,
      start: 45,
      end: 80,
      text: "Reflecting on the reading.",
      speaker: "Fr. Mike",
    },
  ],
};
const paragraphs = [
  {
    number: 1,
    text: "God infinitely perfect and blessed in himself created man freely.",
    audio: {
      paragraph_number: 1,
      reference: "CCC 1",
      start: 10,
      end: 20,
      confidence: 1,
    },
  },
  {
    number: 2,
    text: "The apostles went forth and preached everywhere with the Lord.",
    audio: {
      paragraph_number: 2,
      reference: "CCC 2",
      start: 30,
      end: 40,
      confidence: 1,
    },
  },
  {
    number: 3,
    text: "The Church invites all people to share in the life of God.",
    audio: null,
  },
].map((p) => ({
  ...p,
  source_url: "https://www.vatican.va/archive/ENG0015/example",
}));
const detail = {
  edition: "catechism",
  number: 1,
  readings: ["CCC 1-3"],
  era: "Prologue",
  color: "#00798c",
  completed_at: null,
  scripture: [],
  catechism: paragraphs,
  episode,
};

for (const mobile of [false, true]) {
  const browser = await (mobile ? webkit : chromium).launch(
    mobile ? { headless: true } : { channel: "chrome", headless: true },
  );
  const page = await browser.newPage(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1440, height: 1000 } },
  );
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let fixture = structuredClone(detail);
  await page.context().route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === "/api/session")
      body = {
        user: { username: "test-reader", is_admin: false },
        csrf: "test-only",
      };
    else if (path === "/api/preferences")
      body = { bible_enabled: true, catechism_enabled: true };
    else if (path === "/api/library")
      body = {
        edition: "catechism",
        days: [fixture],
        extras: [],
        completed: 0,
        next_day: 1,
      };
    else if (/^\/api\/days\/\d+$/.test(path)) body = fixture;
    else if (path.endsWith("/notes") || path === "/api/shared-notes") body = [];
    else if (path === "/api/chat/conversations")
      body = { items: [], has_more: false };
    else if (path.endsWith("/audio")) return route.fulfill({ status: 204 });
    return route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    localStorage.setItem("daily-companion-edition", "catechism");
    const proto = HTMLMediaElement.prototype;
    Object.defineProperty(proto, "currentTime", {
      get() {
        return this._time || 0;
      },
      set(n) {
        if (n === this._time) return;
        this._time = n;
        queueMicrotask(() => this.dispatchEvent(new Event("timeupdate")));
      },
    });
    Object.defineProperty(proto, "duration", {
      get() {
        return 100;
      },
    });
    Object.defineProperty(proto, "readyState", {
      get() {
        return 1;
      },
    });
    Object.defineProperty(proto, "error", {
      get() {
        return this._error || null;
      },
    });
    Object.defineProperty(proto, "paused", {
      get() {
        return this._paused !== false;
      },
    });
    proto.play = function () {
      this._paused = false;
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    proto.pause = function () {
      if (this._paused !== false) return;
      this._paused = true;
      this.dispatchEvent(new Event("pause"));
    };
    proto.load = function () {
      this._error = null;
      queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    };
    document.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLMediaElement && event.isTrusted)
          event.stopImmediatePropagation();
      },
      true,
    );
    new MutationObserver((records) => {
      for (const r of records)
        if (r.type === "attributes" && r.target.tagName === "AUDIO")
          r.target.load();
    }).observe(document, {
      attributes: true,
      attributeFilter: ["src"],
      subtree: true,
    });
  });
  const mediaTime = () =>
    page.locator("audio").evaluate((el) => el.currentTime);
  const tick = (time) =>
    page.locator("audio").evaluate((el, time) => {
      el.currentTime = time;
    }, time);
  const reader = `${base}/catechism/day/1/reader?tab=catechism`;
  try {
    await page.goto(reader);
    await expect(
      page.getByRole("button", { name: /Play Catechism/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("2 of 3 paragraphs");
    await page.getByRole("link", { name: "§ 2", exact: true }).click();
    await expect(page).toHaveURL(/#ccc-2$/);
    await page
      .getByRole("button", { name: "Play Catechism paragraph 2", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(30);
    await expect(
      page.getByRole("button", {
        name: "Pause Catechism paragraph 2",
        exact: true,
      }),
    ).toBeVisible();
    await tick(34);
    await page
      .getByRole("button", { name: "Pause Catechism paragraph 2", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Resume Catechism paragraph 2",
        exact: true,
      })
      .click();
    await expect.poll(mediaTime).toBe(34);
    await tick(40);
    await expect(
      page
        .getByRole("region", { name: "Episode audio player" })
        .getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "Episode audio player" })
      .getByRole("button", { name: "Play", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(30); // restart the paragraph, never continue commentary
    await tick(40);
    await page
      .getByRole("button", { name: "Play Catechism", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(10);
    await tick(20);
    await expect.poll(mediaTime).toBe(30); // skip the non-reading gap
    await tick(40);
    await page
      .getByRole("button", { name: "Play Catechism paragraph 1", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(10);
    await page
      .locator("audio")
      .evaluate((el) => el.dispatchEvent(new Event("waiting")));
    await expect(page.getByRole("status")).toContainText("Loading audio");
    await page.locator("audio").evaluate((el) => {
      el._error = { code: 2 };
      el.dispatchEvent(new Event("error"));
    });
    await expect(page.getByRole("status")).toContainText(
      "Audio could not load",
    );
    await page
      .getByRole("button", {
        name: "Resume Catechism paragraph 1",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Pause Catechism paragraph 1",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause Catechism paragraph 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Dismiss message", exact: true })
      .click();
    await page.screenshot({
      path: `${output}/reader-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await page
      .getByRole("link", { name: "Back to study", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(10);
    await expect(
      page.getByRole("button", { name: "Resume Catechism", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close player", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Play Catechism", exact: true })
      .click();
    await expect.poll(mediaTime).toBe(10);
    await page
      .getByRole("tab", { name: "Full transcript", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Pause reading/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Play episode", exact: true })
      .click();
    await page.getByRole("tab", { name: "Catechism", exact: true }).click();
    await page
      .getByRole("button", { name: "Play Catechism", exact: true })
      .click();
    await tick(20);
    await expect.poll(mediaTime).toBe(30); // changing from episode reinstates reading boundaries

    await page
      .getByRole("button", { name: "Close player", exact: true })
      .click();
    fixture.number = 2;
    fixture.episode.has_audio = false;
    await page.getByRole("link", { name: "Day 2", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Audio has not been imported",
    );
    await expect(
      page.getByRole("button", { name: /Play Catechism/ }),
    ).toHaveCount(0);
    fixture.number = 3;
    fixture.episode.has_audio = true;
    fixture.catechism.forEach((p) => {
      p.audio = null;
    });
    await page.getByRole("link", { name: "Day 3", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Paragraph audio is not available",
    );
    await expect(
      page.getByRole("button", { name: /Play Catechism/ }),
    ).toHaveCount(0);
    fixture.number = 4;
    fixture.catechism = [];
    await page.getByRole("link", { name: "Day 4", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Catechism text unavailable" }),
    ).toBeVisible();
    fixture.number = 5;
    fixture.readings = [];
    await page.getByRole("link", { name: "Day 5", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Introductory episode" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    console.log(
      `${mobile ? "Mobile WebKit" : "Desktop Chromium"}: Catechism audio navigation, queue, pause/resume, retry and unavailable states passed.`,
    );
  } catch (error) {
    console.error(await page.locator("body").innerText());
    console.error(errors);
    throw error;
  } finally {
    await browser.close();
  }
}
