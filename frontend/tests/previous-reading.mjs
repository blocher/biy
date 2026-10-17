// Every API response is mocked; this never reads credentials or writes user data.
// npm run test:previous-reading
// PREVIOUS_READING_BROWSER_PATH=/usr/bin/chromium npm run test:previous-reading
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const screenshots = new URL("../../data/screenshots/previous-reading/", import.meta.url);
await mkdir(screenshots, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const plan = [
  { number: 1, readings: ["Genesis 1-2", "Psalm 19"] },
  { number: 2, readings: ["Genesis 3-4", "Psalm 104"] },
];
const verses = (chapters, count) =>
  chapters.flatMap((chapter) =>
    Array.from({ length: count }, (_, i) => ({
      chapter,
      verse: i + 1,
      text: `Verse text for chapter ${chapter}, verse ${i + 1}, long enough to wrap across the reading column.`,
      paragraph: false,
    })),
  );
const passage = (reference) => {
  const [book, range] = reference.split(" ");
  const [first, last = first] = range.split("-").map(Number);
  const chapters = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return { reference, audio: null, groups: [{ book, missing: false, verses: verses(chapters, 25) }] };
};
const day = (entry) => ({
  ...entry,
  era: "Early World",
  color: "#64b6bd",
  completed_at: null,
  episode: null,
});

async function open(browser, path, viewport) {
  const page = await browser.newPage({ viewport, serviceWorkers: "block" });
  const unexpected = [], dayRequests = [];
  page.on("pageerror", (error) => unexpected.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const match = /^\/api\/days\/(\d+)$/.exec(url.pathname);
    let json;
    if (route.request().method() !== "GET") unexpected.push(`Unexpected write ${url.pathname}`);
    if (match) {
      dayRequests.push(Number(match[1]));
      const entry = plan.find((d) => d.number === Number(match[1]));
      json = { ...day(entry), edition: "bible", scripture: entry.readings.map(passage) };
    } else if (url.pathname === "/api/session")
      json = { user: { username: "reader", is_admin: false }, csrf: "test" };
    else if (url.pathname === "/api/library")
      json = { edition: "bible", days: plan.map(day), extras: [], completed: 1, next_day: 2 };
    else if (url.pathname === "/api/preferences")
      json = { bible_enabled: true, catechism_enabled: true, notification_setup_completed: true };
    else if (url.pathname === "/api/chat/conversations") json = { items: [], has_more: false };
    else if (url.pathname === "/api/chat/status") json = { configured: false, worker_available: false };
    else json = [];
    await route.fulfill({ json });
  });
  await page.goto(`${origin}${path}`);
  await page.getByRole("heading", { name: "Genesis 3-4", level: 2 }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  return { page, unexpected, dayRequests };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PREVIOUS_READING_BROWSER_PATH || undefined,
});
try {
  for (const [mode, path] of [["study", "/bible/day/2?tab=scripture"], ["reader", "/bible/day/2/reader?tab=scripture"]]) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const { page, unexpected, dayRequests } = await open(browser, path, viewport);
      const label = /Where you left off in Genesis: Day 1, Genesis 1-2/;
      const buttons = page.getByRole("button", { name: /Where you left off in/ });
      // Only the first chapter heading of each reading carries the reminder,
      // and psalms never do.
      await expect(buttons).toHaveCount(1);
      const button = page.getByRole("button", { name: label });
      await button.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => scrollY);
      await button.click();
      const dialog = page.getByRole("dialog", { name: /Genesis 1-2/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Verse text for chapter 2, verse 25,", { exact: false })).toBeInViewport();
      const body = dialog.locator(".ccc-panel-body");
      expect(await body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
      await expect(dialog.getByRole("link", { name: "Open Day 1" })).toHaveAttribute(
        "href",
        `/bible/day/1${mode === "reader" ? "/reader" : ""}?tab=scripture#verse-genesis-2-25`,
      );
      await page.screenshot({ path: new URL(`${mode}-${viewport.width}.png`, screenshots).pathname });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      // Closing returns to the same place in today's reading.
      expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(3);
      // Reopening reuses the passage already fetched.
      const fetched = dayRequests.length;
      await button.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close previous reading" }).click();
      expect(dayRequests).toHaveLength(fetched);
      expect(unexpected).toEqual([]);
      await page.close();
    }
  }
  console.log("Previous-reading reminders open at the end and close in study and reader modes.");
} finally {
  await browser.close();
  await server.close();
}
