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

async function open(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const saved = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
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
    "Reading selection acceptance passed: repeated desktop drags and keyboard; touch at 390px/320px; native collapse/handle changes; mocked note payload; opposite dock; viewport/scroll; dismissal; unmount.",
  );
} finally {
  await browser.close();
  await server.close();
}
