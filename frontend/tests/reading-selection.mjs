// Isolated acceptance: real ReadingCapture/NoteEditorDialog and CSS, mocked chat
// and API. Never signs in or changes a user's database. Native iOS menus cannot
// be reproduced by desktop browser emulation; verify those on an iPhone too.
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const engine = process.env.SELECTION_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless: true,
  timeout: 30000,
  ...(process.env.SELECTION_BROWSER_PATH
    ? { executablePath: process.env.SELECTION_BROWSER_PATH }
    : {}),
});
const screenshots = new URL(
  "../../data/screenshots/selection/",
  import.meta.url,
);
await mkdir(screenshots, { recursive: true });
const errors = [];

async function open(options, { standalone = false } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  if (standalone) await page.addInitScript(() => {
    const native = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = native(query);
      if (query === "(display-mode: standalone)")
        Object.defineProperty(result, "matches", { value: true });
      return result;
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const saved = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/search") {
      await route.fulfill({ json: { results: [{
        key: "scripture:test",
        kind: "scripture",
        title: "John 1:5",
        excerpt: "The light shines in the darkness.",
        url: "/tests/fixtures/reading-selection.html?result=1#lower",
      }] } });
      return;
    }
    if (
      request.method() !== "POST" ||
      !new URL(request.url()).pathname.endsWith("/notes")
    ) {
      errors.push(
        `Unexpected API request: ${request.method()} ${request.url()}`,
      );
      await route.abort();
      return;
    }
    const value = request.postDataJSON();
    saved.push(value);
    await route.fulfill({ json: { id: 1, ...value } });
  });
  await page.goto(`${origin}/tests/fixtures/reading-selection.html`);
  await page.getByRole("heading", { name: "Reading tools" }).waitFor();
  return { context, page, saved };
}

async function select(
  page,
  id,
  { touch = true, start = 0, end, pointer = true } = {},
) {
  return page.locator(`#${id}`).evaluate(
    (element, args) => {
      if (args.pointer)
        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerType: args.touch ? "touch" : "mouse",
          }),
        );
      const range = document.createRange();
      range.setStart(element.firstChild, args.start);
      range.setEnd(element.firstChild, args.end ?? element.firstChild.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      if (args.pointer)
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerType: args.touch ? "touch" : "mouse",
          }),
        );
      return selection.toString().replace(/\s+/g, " ").trim();
    },
    { touch, start, end, pointer },
  );
}

const toolbar = (page) =>
  page.getByRole("toolbar", { name: "Use highlighted text" });
const collapse = (page) =>
  page.evaluate(() => {
    getSelection().removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
  });

try {
  // Desktop: actual keyboard extension, clamped inline placement, keyboard action.
  {
    const { context, page } = await open({
      viewport: { width: 1280, height: 900 },
    });
    await select(page, "upper", { touch: false, end: 9 });
    await expect(toolbar(page)).toHaveAttribute("data-placement", "inline");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    const extended = await page.evaluate(() =>
      getSelection().toString().trim(),
    );
    expect(extended.length).toBeGreaterThan(9);
    await page.screenshot({
      animations: "disabled",
      path: new URL("desktop.png", screenshots).pathname,
    });
    await toolbar(page)
      .getByRole("button", { name: "Ask", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Ask draft")).toContainText(extended);
    await expect(page.getByLabel("Ask draft")).toContainText("John 1:5");
    await expect(toolbar(page)).toHaveCount(0);
    await context.close();
  }

  // Exercise actual desktop drags repeatedly, including replacing a previous
  // highlight. Programmatic ranges alone miss the browser's event ordering.
  {
    const { context, page } = await open({
      viewport: { width: 1280, height: 900 },
    });
    for (let attempt = 0; attempt < 10; attempt++) {
      const points = await page.locator("#upper").evaluate((element, index) => {
        const text = element.firstChild;
        const caret = (offset) => {
          const range = document.createRange();
          range.setStart(text, offset);
          range.setEnd(text, offset + 1);
          const rect = range.getBoundingClientRect();
          return { x: rect.left + 1, y: rect.top + rect.height / 2 };
        };
        return { start: caret(index % 2 ? 27 : 0), end: caret(index % 2 ? 46 : 19) };
      }, attempt);
      await page.mouse.move(points.start.x, points.start.y);
      await page.mouse.down();
      await page.mouse.move(points.end.x, points.end.y, { steps: 6 });
      await page.mouse.up();
      await expect(toolbar(page)).toBeVisible();
    }
    await context.close();
  }

  // The plus menu keeps highlight actions separate from the two search modes.
  {
    const { context, page } = await open({ viewport: { width: 1280, height: 900 } });
    await page.getByRole("button", { name: "Open reading tools" }).click();
    await expect(page.getByRole("menuitem")).toHaveCount(4);
    await page.getByRole("menuitem", { name: "Find on this page" }).click();
    const find = page.getByRole("search", { name: "Find on this page" });
    await expect(find).toBeVisible();
    await find.getByRole("searchbox", { name: "Find text on this page" }).fill("light");
    await expect(find.getByRole("status")).toHaveText("1 of 3");
    const nativeFind = await page.evaluate(() => !!CSS.highlights && typeof Highlight !== "undefined");
    const nativeFindText = () => page.evaluate(() => [...(CSS.highlights.get("biy-page-find") || [])].map((range) => range.toString()));
    if (nativeFind) await expect.poll(nativeFindText).toEqual(["light", "light", "light"]);
    else await expect.poll(() => page.locator(".page-find-highlights rect").count()).toBeGreaterThan(0);
    await page.screenshot({ path: new URL("find-desktop.png", screenshots).pathname });
    await find.getByRole("button", { name: "Next match" }).click();
    await expect(find.getByRole("status")).toHaveText("2 of 3");
    await find.getByRole("searchbox", { name: "Find text on this page" }).fill("not-in-the-reading");
    await expect(find.getByRole("status")).toHaveText("No matches");
    await find.getByRole("searchbox", { name: "Find text on this page" }).fill("living word");
    await expect(find.getByRole("status")).toHaveText("1 of 1");
    if (nativeFind) await expect.poll(nativeFindText).toEqual(["living word"]);
    else await expect.poll(() => page.locator(".page-find-highlights rect").count()).toBeGreaterThan(0);
    await find.getByRole("button", { name: "Close find" }).click();
    await expect(page.locator(".page-find-highlights")).toHaveCount(0);
    if (nativeFind) expect(await page.evaluate(() => !CSS.highlights.has("biy-page-find") && !CSS.highlights.has("biy-page-find-active"))).toBe(true);

    await page.getByRole("button", { name: "Open reading tools" }).click();
    await page.getByRole("menuitem", { name: "Search the site" }).click();
    const site = page.getByRole("dialog", { name: "Search the site" });
    await expect(site).toBeVisible();
    await site.getByRole("searchbox", { name: "Search readings and commentary" }).fill("light");
    await expect(site.getByRole("link", { name: /John 1:5/ })).toBeVisible();
    await page.screenshot({ path: new URL("site-search-desktop.png", screenshots).pathname });
    expect(new URL(page.url()).searchParams.has("result")).toBe(false);
    await site.getByRole("button", { name: "Close site search" }).click();
    await expect(site).not.toBeVisible();
    expect(new URL(page.url()).searchParams.has("result")).toBe(false);
    await page.getByRole("button", { name: "Open reading tools" }).click();
    await page.getByRole("menuitem", { name: "Search the site" }).click();
    await expect(site.getByRole("link", { name: /John 1:5/ })).toBeVisible();
    await site.getByRole("link", { name: /John 1:5/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("result")).toBe("1");
    await expect(site).not.toBeVisible();
    await context.close();
  }

  {
    const { context, page } = await open(
      { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      { standalone: true },
    );
    const intercepted = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "f", ctrlKey: true, bubbles: true, cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(intercepted).toBe(true);
    await expect(page.getByRole("search", { name: "Find on this page" })).toBeVisible();
    await page.getByRole("button", { name: "Close find" }).tap();
    await page.getByRole("button", { name: "Open reading tools" }).tap();
    await page.getByRole("menuitem", { name: "Search the site" }).tap();
    const site = page.getByRole("dialog", { name: "Search the site" });
    await site.getByRole("searchbox", { name: "Search readings and commentary" }).fill("light");
    await expect(site.getByRole("link", { name: /John 1:5/ })).toBeVisible();
    await page.screenshot({ path: new URL("site-search-mobile.png", screenshots).pathname });
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, "offsetTop", { value: 120, configurable: true });
      Object.defineProperty(visualViewport, "height", { value: 360, configurable: true });
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(async () => {
      const rect = await site.boundingBox();
      return rect.y + rect.height;
    }).toBeLessThanOrEqual(480);
    await context.close();
  }

  // Starting another mouse drag can collapse the previous range before the
  // browser publishes the new one. The final mouse-up must still show tools.
  {
    const { context, page } = await open({
      viewport: { width: 1280, height: 900 },
    });
    await select(page, "upper", { touch: false, end: 9 });
    await expect(toolbar(page)).toBeVisible();
    await page.locator("#lower").evaluate((element) => {
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      const selection = getSelection();
      selection.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, 14);
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByLabel("Ask draft")).toContainText("John 1:9");
    await context.close();
  }

  for (const width of [390, 320]) {
    const { context, page, saved } = await open({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const quote = await select(page, "upper");
    await expect(toolbar(page)).toHaveAttribute(
      "data-placement",
      "dock-bottom",
    );
    const bounds = await toolbar(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 12);
    expect(bounds.y).toBeGreaterThan(700);
    for (const button of await toolbar(page).getByRole("button").all()) {
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    const nativeMenuAllowed = await page
      .locator("#upper")
      .evaluate((element) =>
        element.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        ),
      );
    expect(nativeMenuAllowed).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: new URL(`mobile-${width}-bottom.png`, screenshots).pathname,
    });

    // A menu/focus can collapse the live native range before a touch click.
    await collapse(page);
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByRole("button", { name: "Take note" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByText("From John 1:5", { exact: true }).click();
    await expect(page.locator(".reading-note-selection")).toContainText(quote);
    await page
      .getByLabel("Your note", { exact: true })
      .fill("Mocked selection acceptance");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      quote,
      citation: "John 1:5",
      source_url: "/tests/fixtures/reading-selection.html#verse-john-1-5",
    });

    // Native handle changes update quote AND provenance without pointer-up.
    await select(page, "upper", { end: 9 });
    const nextQuote = await select(page, "lower", { pointer: false });
    await expect(toolbar(page)).toHaveAttribute("data-placement", "dock-top");
    await page.screenshot({
      animations: "disabled",
      path: new URL(`mobile-${width}-top.png`, screenshots).pathname,
    });
    await collapse(page);
    await toolbar(page).getByRole("button", { name: "Ask", exact: true }).tap();
    await expect(page.getByLabel("Ask draft")).toContainText(nextQuote);
    await expect(page.getByLabel("Ask draft")).toContainText("John 1:9");
    await context.close();
  }

  {
    const { context, page } = await open({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await select(page, "lower");
    // Scroll the retained range into the upper half: dock follows the opposite edge.
    await page.evaluate(() => scrollTo(0, 450));
    await expect(toolbar(page)).toHaveAttribute(
      "data-placement",
      "dock-bottom",
    );
    // Simulate Safari's moving/resizing visual viewport on the same event target.
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({
        offsetTop: 120,
        offsetLeft: 20,
        width: 320,
        height: 330,
      })) {
        Object.defineProperty(visualViewport, key, {
          value,
          configurable: true,
        });
      }
      visualViewport.dispatchEvent(new Event("resize"));
      visualViewport.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(async () => {
        const bounds = await toolbar(page).boundingBox();
        return bounds.y + bounds.height;
      })
      .toBeLessThanOrEqual(450);
    const bounds = await toolbar(page).boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(450);
    expect(bounds.x).toBeGreaterThanOrEqual(32);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(328);
    await toolbar(page)
      .getByRole("button", { name: "Dismiss selection tools" })
      .tap();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("selectionchange"));
      window.dispatchEvent(new Event("resize"));
    });
    await expect(toolbar(page)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open reading tools", exact: true })
      .tap();
    await page.getByRole("menuitem", { name: "Ask about this reading" }).tap();
    await expect(page.getByLabel("Ask draft")).toHaveText("No selected quote");
    await context.close();
  }

  {
    const { context, page } = await open({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await select(page, "upper");
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      document.dispatchEvent(new Event("selectionchange")),
    );
    await expect(toolbar(page)).toHaveCount(0);
    await select(page, "upper");
    await page.getByRole("button", { name: "Navigate reading" }).tap();
    await expect(toolbar(page)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open reading tools", exact: true })
      .tap();
    await page.getByRole("menuitem", { name: "Take a note" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("From Day 2", { exact: true })).toBeVisible();
    await expect(page.locator(".reading-note-selection p")).toHaveCount(0);
    await context.close();
  }

  {
    const { context, page } = await open({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await select(page, "upper");
    // Pending pointer-up/viewport frames must not resurrect actions after unmount.
    await page.evaluate(() => {
      document.querySelector("#upper").dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      window.dispatchEvent(new Event("resize"));
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Unmount reading")
        .click();
    });
    await expect(page.locator(".reading-capture-surface")).toHaveCount(0);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("selectionchange"));
      window.dispatchEvent(new Event("scroll"));
      visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect(toolbar(page)).toHaveCount(0);
    await context.close();
  }

  expect(errors).toEqual([]);
  console.log(
    "Reading selection acceptance passed: four-action menu, exact page find, site-search modal and navigation, standalone shortcut, mobile viewport, desktop drags and keyboard, touch selection, note payload, dismissal, unmount.",
  );
} finally {
  await browser.close();
  await server.close();
}
