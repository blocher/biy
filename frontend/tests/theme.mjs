// Run against Vite: npm run dev -- --port 5181 --strictPort
// Every API response is mocked; this never reads credentials or writes user data.
import { chromium, webkit, expect } from "@playwright/test";
import fs from "node:fs/promises";
const engines =
  process.env.BIY_TEST_BROWSER === "webkit"
    ? [webkit]
    : process.env.BIY_TEST_BROWSER === "chromium"
      ? [chromium]
      : [chromium, webkit];
const base = process.env.BIY_TEST_URL || "http://127.0.0.1:5181";
const screenshots = new URL("../../data/screenshots/theme/", import.meta.url)
  .pathname;
await fs.mkdir(screenshots, { recursive: true });
const preferences = {
  bible_enabled: true,
  catechism_enabled: true,
  progress_basis: "first-completion",
  leaderboard_visible: true,
  leaderboard_start_date: "2026-09-20",
  notification_setup_completed: true,
  notification_timezone: "UTC",
  morning_reminder_time: "07:00",
  evening_reminder_time: "19:00",
};
const episode = {
  id: 1,
  title: "Day 1: In the Beginning",
  day: 1,
  color: "#771051",
  era: "Early World",
  has_audio: true,
  audio: "/test-audio.wav",
  duration: 90,
  status: "ready",
  position: 0,
  published_at: "2026-01-01T12:00:00Z",
  summary: "A reading for reflection.",
  key_points: [],
  outline: [],
  transcript: [],
  commentary: [],
  edited_commentary: [],
};
const day = {
  number: 1,
  readings: ["Genesis 1"],
  era: "Early World",
  color: "#771051",
  completed_at: null,
  episode,
  scripture: [
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
              text: "In the beginning God created the heavens and the earth.",
              paragraph: true,
            },
            {
              chapter: 1,
              verse: 2,
              text: "The earth was without form and void, and darkness was upon the face of the deep.",
              paragraph: false,
            },
          ],
        },
      ],
    },
  ],
  catechism: [
    {
      number: 1,
      text: "God, infinitely perfect and blessed in himself, in a plan of sheer goodness freely created man to make him share in his own blessed life.",
      source_url: "https://www.vatican.va/",
    },
  ],
};
async function mock(context, loggedIn = true) {
  const unexpected = [];
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.abort(),
  );
  await context.route("https://fonts.gstatic.com/**", (route) => route.abort());
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  await context.route("**/test-audio.wav", (route) =>
    route.fulfill({ body: wav, contentType: "audio/wav" }),
  );
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/episodes/1/audio") {
      await route.fulfill({ body: wav, contentType: "audio/wav" });
      return;
    }
    const edition = url.searchParams.get("edition") || "bible";
    let data;
    switch (url.pathname) {
      case "/api/session":
        data = {
          user: loggedIn ? { username: "Reader", is_admin: false } : null,
          csrf: "test",
        };
        break;
      case "/api/library":
        data = {
          edition,
          days: [
            {
              ...day,
              readings: edition === "bible" ? ["Genesis 1"] : ["CCC 1"],
            },
          ],
          extras: [],
          completed: 0,
          next_day: 1,
        };
        break;
      case "/api/preferences":
        data = preferences;
        break;
      case "/api/days/1":
        data = {
          ...day,
          edition,
          readings: edition === "bible" ? ["Genesis 1"] : ["CCC 1"],
        };
        break;
      case "/api/account":
        data = { username: "Reader", first_name: "", last_name: "", email: "" };
        break;
      case "/api/push/subscriptions":
      case "/api/days/1/notes":
      case "/api/shared-notes":
      case "/api/leaderboard":
        data = [];
        break;
      case "/api/chat/conversations":
        data = { items: [], has_more: false };
        break;
      case "/api/chat/status":
        data = { configured: false, worker_available: false };
        break;
      case "/api/episodes/1/position":
        data = {};
        break;
      default:
        unexpected.push(`${route.request().method()} ${url.pathname}`);
        data = {};
    }
    if (
      route.request().method() !== "GET" &&
      url.pathname !== "/api/episodes/1/position"
    )
      unexpected.push(`Unexpected write ${url.pathname}`);
    await route.fulfill({ json: data });
  });
  return unexpected;
}
async function assertTheme(page, theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
  ).toBe(theme);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    theme === "dark" ? "#151e1b" : "#123f34",
  );
}
async function noOverflow(page, name) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `${name} horizontal overflow`,
  ).toBe(true);
}
async function readable(page, selector) {
  const colors = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      let bg = s.backgroundColor,
        parent = el;
      while (
        (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") &&
        parent.parentElement
      ) {
        parent = parent.parentElement;
        bg = getComputedStyle(parent).backgroundColor;
      }
      const luminance = (value) => {
        const channels = value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            c /= 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const fgL = luminance(s.color),
        bgL = luminance(bg);
      return {
        foreground: s.color,
        background: bg,
        ratio: (Math.max(fgL, bgL) + 0.05) / (Math.min(fgL, bgL) + 0.05),
      };
    });
  expect(
    colors.ratio,
    `${selector}: ${JSON.stringify(colors)}`,
  ).toBeGreaterThanOrEqual(4.5);
}
for (const engine of engines) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? { channel: "chrome" }
      : { executablePath: process.env.BIY_WEBKIT_EXECUTABLE }),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "dark",
      serviceWorkers: "block",
    });
    const unexpected = await mock(context);
    const errors = [];
    context.on("page", (page) =>
      page.on("pageerror", (error) => errors.push(error.message)),
    );
    const page = await context.newPage();
    await page.goto(base + "/bible");
    await page
      .getByRole("link", { name: "Continue Day 1", exact: true })
      .waitFor();
    await assertTheme(page, "dark");
    await readable(page, "h1");
    await readable(page, ".primary");
    await readable(page, ".day-table");
    // Exercise the same classes used by AdminPeople and NotificationSetupModal,
    // without granting fixture users admin rights or simulating installed PWAs.
    await page.evaluate(() => {
      const fixture = document.createElement("section");
      fixture.id = "theme-peripheral-contrast";
      fixture.style.position = "fixed";
      fixture.style.left = "-10000px";
      const avatar = document.createElement("span");
      avatar.className = "member-avatar";
      avatar.textContent = "R";
      const hint = document.createElement("p");
      hint.className = "notification-setup-condition";
      hint.textContent = "Only when today's reading is incomplete";
      fixture.append(avatar, hint);
      document.body.append(fixture);
    });
    await readable(page, ".member-avatar");
    await readable(page, ".notification-setup-condition");
    await page
      .locator("#theme-peripheral-contrast")
      .evaluate((el) => el.remove());
    await page.screenshot({
      path: screenshots + engine.name() + "-home-dark.png",
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await assertTheme(page, "light");
    const sidebarSwitch = page.getByRole("switch", { name: "Dark mode" });
    await expect(sidebarSwitch).not.toBeChecked();
    await sidebarSwitch.focus();
    await page.keyboard.press("Enter");
    await assertTheme(page, "dark");
    await expect(sidebarSwitch).toBeChecked();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await assertTheme(page, "dark");
    await page.reload();
    await assertTheme(page, "dark");
    const otherTab = await context.newPage();
    await otherTab.goto(base + "/account");
    await otherTab.getByLabel("Color theme").selectOption("light");
    await assertTheme(page, "light");
    await otherTab.getByLabel("Color theme").selectOption("system");
    await otherTab.emulateMedia({ colorScheme: "dark" });
    await assertTheme(otherTab, "dark");
    await readable(otherTab, ".account-field input");
    await otherTab.close();
    await sidebarSwitch.click();
    await page.goto(base + "/bible/day/1/reader");
    await page
      .getByRole("heading", { name: "Genesis 1", exact: true, level: 1 })
      .waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page, `reader ${width}`);
      const toggle = page.getByRole("switch", { name: "Dark mode" });
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeChecked();
      const box = await toggle.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await readable(page, ".verse-paragraph");
      await page.screenshot({
        path: screenshots + engine.name() + `-reader-dark-${width}.png`,
        fullPage: true,
      });
      await toggle.click();
      await assertTheme(page, "light");
      await expect(toggle).not.toBeChecked();
      await toggle.click();
    }
    await page
      .getByRole("button", { name: "Ask about this reading", exact: true })
      .click();
    await expect(page.locator(".reading-chat-dialog")).toBeVisible();
    await readable(page, ".reading-chat-dialog h2");
    await readable(page, ".chat-composer textarea");
    await noOverflow(page, "Ask dialog");
    await page.screenshot({
      path: screenshots + engine.name() + "-ask-dark-320.png",
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open reading tools" }).click();
    await page.getByRole("menuitem", { name: "Take a note" }).click();
    await expect(page.locator(".reading-note-dialog")).toBeVisible();
    await readable(page, ".reading-note-dialog textarea");
    await readable(page, ".reading-note-dialog h2");
    await noOverflow(page, "note dialog");
    await page.screenshot({
      path: screenshots + engine.name() + "-note-dark-320.png",
    });
    await page.getByRole("button", { name: "Close note" }).click();
    await page.goto(base + "/bible/day/1");
    await page.locator(".study-primary-actions > button.primary").click();
    await expect(page.locator(".player")).toBeVisible();
    await readable(page, ".player select");
    await readable(page, ".player .seek span");
    await noOverflow(page, "audio player");
    await page.screenshot({
      path: screenshots + engine.name() + "-audio-dark-320.png",
    });
    // Close the player and finish its mocked save before a full document load.
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().includes("/episodes/1/position"),
      ),
      page.getByRole("button", { name: "Close player" }).click(),
    ]);
    await page.goto(base + "/catechism/day/1/reader");
    await page.locator(".catechism-text").waitFor();
    await readable(page, ".catechism-text [data-reading-citation]");
    await readable(page, ".catechism-text [data-reading-citation] strong");
    await noOverflow(page, "catechism reader");
    await page.screenshot({
      path: screenshots + engine.name() + "-catechism-dark-320.png",
      fullPage: true,
    });
    await page.goto(base + "/bible");
    await page
      .getByRole("link", { name: "Continue Day 1", exact: true })
      .waitFor();
    await noOverflow(page, "home 320");
    await expect(
      page.getByRole("switch", { name: "Dark mode" }),
    ).toBeVisible();
    await page.screenshot({
      path: screenshots + engine.name() + "-home-dark-320.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
    await context.close();
    const loginContext = await browser.newContext({
      colorScheme: "dark",
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    await mock(loginContext, false);
    const login = await loginContext.newPage();
    await login.goto(base);
    await login.getByLabel("Password", { exact: true }).waitFor();
    await assertTheme(login, "dark");
    await readable(login, "#password");
    const loginSwitch = login.getByRole("switch", { name: "Dark mode" });
    await expect(loginSwitch).toBeChecked();
    await loginSwitch.click();
    await assertTheme(login, "light");
    await expect(loginSwitch).not.toBeChecked();
    await noOverflow(login, "login");
    await loginContext.close();
    console.log(
      `${engine.name()}: theme persistence, OS/cross-tab changes, keyboard toggle, dark contrast, login, 320/390px reader + dialogs passed`,
    );
  } finally {
    await browser.close();
  }
}
