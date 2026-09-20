// Isolated browser fixtures: no database changes or actual email delivery.
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let prefs = {
  progress_basis: "first-completion",
  leaderboard_visible: true,
  email_notifications: true,
  leaderboard_start_date: "2026-09-20",
};
let notes = [];
const otherNotes = [
  {
    id: 101,
    body: "A shared reflection from Anna.",
    kind: "journal",
    shared: true,
    author: { id: 2, name: "Anna" },
    audio_time: null,
    day: 1,
    episode: null,
    created_at: "2026-09-20T12:00:00Z",
  },
  {
    id: 102,
    body: "A shared study note from James.",
    kind: "note",
    shared: true,
    author: { id: 3, name: "James" },
    audio_time: null,
    day: 1,
    episode: null,
    created_at: "2026-09-20T12:00:00Z",
  },
];
const days = Array.from({ length: 365 }, (_, i) => ({
  number: i + 1,
  readings: ["Genesis 1"],
  era: "Early World",
  color: "#64b6bd",
  completed_at: null,
  episode: null,
}));
await page.route("**/api/**", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname.replace("/api", "");
  const method = req.method();
  const data = req.postDataJSON();
  let json;
  if (path === "/session")
    json = { user: { username: "reader" }, csrf: "fixture" };
  else if (path === "/library")
    json = { days, extras: [], completed: 0, next_day: 1 };
  else if (path === "/preferences") {
    if (method === "PATCH") prefs = { ...prefs, ...data };
    json = prefs;
  } else if (path === "/community-settings") {
    expect(data.confirm_affects_everyone).toBe(true);
    prefs.leaderboard_start_date = data.start_date;
    json = { leaderboard_start_date: data.start_date };
  } else if (path === "/account")
    json = {
      username: "reader",
      first_name: "",
      last_name: "",
      email: "reader@example.org",
    };
  else if (path === "/leaderboard")
    json = [
      {
        id: 2,
        name: "Anna",
        completed: 12,
        current_day: 13,
        first_completed: "2026-09-01T12:00:00Z",
      },
      {
        id: 1,
        name: "reader",
        completed: 0,
        current_day: 1,
        first_completed: null,
      },
    ];
  else if (path === "/shared-notes") json = otherNotes;
  else if (path === "/days/1") json = { ...days[0], scripture: [] };
  else if (path === "/days/1/notes" && method === "POST") {
    json = {
      ...data,
      id: 1,
      day: 1,
      episode: null,
      author: { id: 1, name: "reader" },
      created_at: new Date().toISOString(),
    };
    notes = [json];
  } else if (path === "/notes/1" && method === "PUT") {
    json = { ...notes[0], ...data };
    notes = [json];
  } else if (path === "/notes" || path === "/days/1/notes") json = notes;
  else throw new Error(`Unexpected API request ${method} ${path}`);
  await route.fulfill({ json });
});
await page.goto("http://127.0.0.1:5178");
await page.getByLabel("Schedule starts from").selectOption("leaderboard");
await expect.poll(() => prefs.progress_basis).toBe("leaderboard");
await page.reload();
await expect(page.getByLabel("Schedule starts from")).toHaveValue(
  "leaderboard",
);
await page.goto("http://127.0.0.1:5178/account");
await page.getByLabel("Email me when someone shares").uncheck();
await expect.poll(() => prefs.email_notifications).toBe(false);
await page.getByLabel("Show my progress").uncheck();
await expect.poll(() => prefs.leaderboard_visible).toBe(false);
await page.getByLabel("Shared start date").fill("2026-09-01");
page.once("dialog", (dialog) => dialog.dismiss());
await page.getByRole("button", { name: "Update for everyone" }).click();
expect(prefs.leaderboard_start_date).toBe("2026-09-20");
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "Update for everyone" }).click();
await expect.poll(() => prefs.leaderboard_start_date).toBe("2026-09-01");
await page.goto("http://127.0.0.1:5178/day/1");
await page
  .getByLabel("Study note", { exact: true })
  .fill("My first shared note");
await page.getByLabel("Shared — visible").check();
await page.getByRole("button", { name: "Save note", exact: true }).click();
await expect.poll(() => notes[0]?.shared).toBe(true);
await expect(
  page.getByText("A shared reflection from Anna.", { exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "Edit entry", exact: true }).click();
await expect(page.getByLabel("Shared — visible")).toBeChecked();
await page.getByLabel("Shared — visible").uncheck();
await page.getByRole("button", { name: "Save changes", exact: true }).click();
await expect.poll(() => notes[0]?.shared).toBe(false);
await page.goto("http://127.0.0.1:5178/journal");
await page
  .getByRole("button", { name: "Community entries", exact: true })
  .click();
await expect(
  page.getByText("A shared reflection from Anna.", { exact: true }),
).toBeVisible();
await page.getByLabel("Person", { exact: true }).selectOption("3");
await expect(
  page.getByText("A shared reflection from Anna.", { exact: true }),
).toHaveCount(0);
await expect(
  page.getByText("A shared study note from James.", { exact: true }),
).toBeVisible();
await page.getByLabel("Search reflections").fill("no match");
await expect(
  page.getByRole("heading", { name: "No matching reflections." }),
).toBeVisible();
await page.goto("http://127.0.0.1:5178/leaderboard");
await expect(
  page.getByRole("heading", { name: "Leaderboard", exact: true }),
).toBeVisible();
await expect(page.getByLabel("Schedule starts from")).toHaveValue(
  "leaderboard",
);
await expect(page.getByText("Anna", { exact: true })).toBeVisible();
await page.getByLabel("Schedule starts from").selectOption("january-1");
await expect.poll(() => prefs.progress_basis).toBe("january-1");
await page.screenshot({
  path: "/tmp/biy-leaderboard-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "/tmp/biy-leaderboard-mobile.png",
  fullPage: true,
});
expect(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
).toBe(true);
expect(errors).toEqual([]);
await browser.close();
console.log("Collaboration browser flows passed (desktop and mobile).");
