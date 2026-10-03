// Mocked acceptance coverage: no account, import, AI, or remote document calls.
import { chromium, webkit, expect } from "@playwright/test";
import fs from "node:fs";
const base = process.env.BIY_TEST_URL || "http://127.0.0.1:5183";
const out = "/tmp/biy-catechism-references";
fs.mkdirSync(out, { recursive: true });
const text = (value) => ({ type: "text", text: value });
const p = (number, value) => ({
  number,
  text: value,
  source_url: "https://app.ascensionpress.com/catechism/one/2/2/4",
  provenance: { source: "Ascension" },
  content: {
    schema: 1,
    before: [],
    blocks: [{ kind: "paragraph", children: [text(value)] }],
    notes: [],
    context: [{ level: 3, text: "Chapter Two: I Believe in Jesus Christ" }],
    cross_references: [],
  },
});
const first = p(
  631,
  "A reading paragraph with a biblical citation and a document citation.",
);
first.content.before = [
  {
    kind: "heading",
    level: 4,
    children: [text("He Descended Into Hell; on the Third Day He Rose Again")],
  },
];
first.content.blocks[0].children.push({ type: "note", id: "n1", text: "476" });
first.content.blocks.push({
  kind: "quote",
  children: [
    text("A quotation from the liturgy."),
    { type: "note", id: "n2", text: "477" },
  ],
});
first.content.notes = [
  {
    id: "n1",
    label: "476",
    children: [
      { type: "bible", text: "Eph 4:9-10", reference: "Ephesians 4:9-10" },
      text("; cf. a related source."),
    ],
  },
  {
    id: "n2",
    label: "477",
    children: [text("Roman Missal, Easter Vigil 19, Exsultet.")],
  },
];
first.content.cross_references = [1033];
const related = p(
  1033,
  "The full cross-referenced Catechism paragraph is available here.",
);
related.content.cross_references = [631];
const paragraphs = [
  first,
  ...Array.from({ length: 5 }, (_, i) =>
    p(
      632 + i,
      "This longer reading keeps the reader in place while exploring a reference. ".repeat(
        5,
      ),
    ),
  ),
];
const detail = {
  edition: "catechism",
  number: 90,
  readings: ["CCC 631-636"],
  era: "Part One: What We Believe",
  color: "#00798c",
  completed_at: null,
  scripture: [],
  catechism: paragraphs,
  episode: null,
};
for (const mobile of [false, true]) {
  detail.catechism = paragraphs;
  const browser = await (mobile ? webkit : chromium).launch(
    mobile ? {} : { channel: "chrome" },
  );
  const page = await browser.newPage({
    serviceWorkers: "block",
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const errors = [];
  const calls = [];
  let failBible = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, method: route.request().method() });
    let json = {};
    if (url.pathname === "/api/session")
      json = { user: { username: "reader", is_admin: false }, csrf: "mock" };
    else if (url.pathname === "/api/preferences")
      json = { bible_enabled: true, catechism_enabled: true };
    else if (url.pathname === "/api/library")
      json = {
        edition: "catechism",
        days: [detail],
        extras: [],
        next_day: 90,
        completed: 0,
      };
    else if (url.pathname === "/api/days/90") json = detail;
    else if (url.pathname === "/api/catechism/paragraphs/1033")
      json = {
        paragraph: related,
        context_url: "/catechism/day/145/reader?tab=catechism#ccc-1033",
      };
    else if (url.pathname === "/api/catechism/paragraphs/631")
      json = {
        paragraph: first,
        context_url: "/catechism/day/90/reader?tab=catechism#ccc-631",
      };
    else if (url.pathname === "/api/catechism/bible-reference") {
      if (failBible)
        return route.fulfill({
          status: 503,
          json: { detail: "Reference temporarily unavailable." },
        });
      json = {
        translation: "RSV-2CE",
        context_url: "/bible/day/20/reader?tab=scripture#verse-ephesians-4-9",
        passage: {
          reference: "Ephesians 4:9-10",
          groups: [
            {
              book: "Ephesians",
              missing: false,
              verses: [
                { chapter: 4, verse: 9, text: "The first referenced verse." },
                { chapter: 4, verse: 10, text: "The final referenced verse." },
              ],
            },
          ],
        },
      };
    } else if (
      url.pathname.endsWith("/notes") ||
      url.pathname === "/api/shared-notes"
    )
      json = [];
    else if (url.pathname === "/api/chat/conversations")
      json = { items: [], has_more: false };
    return route.fulfill({ json });
  });
  await page.addInitScript(() =>
    localStorage.setItem("daily-companion-edition", "catechism"),
  );
  await page.goto(`${base}/catechism/day/90/reader?tab=catechism`);
  const marker = page.getByRole("button", {
    name: "Footnote 476 for CCC 631",
    exact: true,
  });
  await marker.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await marker.click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "CCC 631 · Note 476" }),
  ).toBeVisible();
  // The first footnote tap must reveal Scripture and retain the note context.
  await expect(panel).toContainText("The final referenced verse.");
  await expect(panel).toContainText("cf. a related source.");
  await panel.getByRole("button", { name: "Eph 4:9-10", exact: true }).click();
  await expect(panel).toContainText("RSV-2CE");
  await expect(panel).toContainText("The final referenced verse.");
  await page.screenshot({
    path: `${out}/${mobile ? "mobile" : "desktop"}-bible.png`,
  });
  await panel
    .getByRole("button", { name: "Back to previous reference" })
    .click();
  await expect(panel).toContainText("cf. a related source.");
  await panel.getByRole("button", { name: "Close references" }).click();
  await expect(panel).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
  if (!mobile) await expect(marker).toBeFocused();
  const refs = page
    .locator(".catechism-paragraph")
    .first()
    .getByRole("button", { name: /^References/ });
  await refs.click();
  await expect(panel).toContainText("Roman Missal, Easter Vigil 19, Exsultet.");
  await panel.getByRole("button", { name: "CCC 1033", exact: true }).click();
  await expect(panel).toContainText(
    "The full cross-referenced Catechism paragraph",
  );
  await panel.getByRole("button", { name: "CCC 631", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Catechism 631", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Footnote 476 for CCC 631", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "CCC 631 · Note 476" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: "Show reference labels" }).click();
  await expect(
    page.getByRole("button", { name: "Note 477", exact: true }),
  ).toBeVisible();
  // Retry path, dark theme, and narrow mobile overflow.
  failBible = true;
  await marker.click();
  await expect(panel.getByRole("alert")).toContainText(
    "Reference temporarily unavailable",
  );
  failBible = false;
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel).toContainText("The final referenced verse.");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  if (mobile) await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth))
    .toBe(true);
  await page.screenshot({
    path: `${out}/${mobile ? "mobile" : "desktop"}-dark.png`,
  });
  await panel.getByRole("button", { name: "Close references" }).click();
  await expect(page).toHaveURL(/catechism\/day\/90\/reader\?tab=catechism$/);
  if (errors.length) throw new Error(errors.join("\n"));
  if (calls.some((c) => c.method !== "GET"))
    throw new Error("Reference reading changed account state");
  console.log(
    `${mobile ? "Mobile WebKit" : "Desktop Chromium"}: references, nesting, ranges, retry, scroll, dark mode passed`,
  );
  if (process.env.BIY_CATECHISM_QA_SOURCE) {
    const actual = JSON.parse(
      fs.readFileSync(process.env.BIY_CATECHISM_QA_SOURCE, "utf8"),
    );
    detail.catechism = actual
      .filter((p) => p.number >= 631 && p.number <= 636)
      .map((p) => ({ ...p, provenance: { source: "Ascension" } }));
    await page.goto(`${base}/catechism/day/90/reader?tab=catechism`);
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "light"),
    );
    await page
      .locator("#ccc-631")
      .scrollIntoViewIfNeeded({ timeout: 10000 })
      .catch(async (error) => {
        console.error(
          "Source QA page:",
          await page.locator("body").innerText(),
          errors,
        );
        throw error;
      });
    await page.screenshot({
      path: `${out}/${mobile ? "mobile" : "desktop"}-source-reading.png`,
    });
    await page
      .locator(".catechism-paragraph")
      .first()
      .getByRole("button", { name: /^References/ })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Roman Missal");
    await page.screenshot({
      path: `${out}/${mobile ? "mobile" : "desktop"}-source-notes.png`,
    });
  }
  await browser.close();
}
