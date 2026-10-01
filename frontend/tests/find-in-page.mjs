// Real browser coverage of text indexing and painted highlight alignment.
// npm run test:find-page                  Chromium + WebKit, desktop + mobile
// FIND_BROWSER=chromium npm run test:find-page
// FIND_BROWSER_PATH=/usr/bin/chromium FIND_BROWSER=chromium npm run test:find-page
// Mobile emulation covers viewport/touch/scroll geometry, not physical iOS chrome.
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const names = (process.env.FIND_BROWSER || "chromium,webkit").split(",");
for (const name of names) if (!["chromium", "webkit"].includes(name))
  throw new Error(`Unknown FIND_BROWSER: ${name}`);
const screenshots = new URL("../../data/screenshots/find-in-page/", import.meta.url);
await mkdir(screenshots, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const errors = [];
const metrics = [];
const find = (page) => page.getByRole("search", { name: "Find on this page" });
const input = (page) => find(page).getByRole("searchbox", { name: "Find text on this page" });
const status = (page) => find(page).getByRole("status");

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function open(browser, mobile, fallback = false, standalone = true) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    errors.push(`Unexpected API request: ${route.request().method()} ${route.request().url()}`);
    await route.abort();
  });
  await page.addInitScript(({ fallback, standalone }) => {
    if (fallback) Object.defineProperty(window, "Highlight", { value: undefined, configurable: true });
    if (standalone) {
      const native = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = native(query);
        if (query === "(display-mode: standalone)") Object.defineProperty(result, "matches", { value: true });
        return result;
      };
    }
  }, { fallback, standalone });
  await page.goto(`${origin}/tests/fixtures/find-in-page.html`);
  await page.getByRole("heading", { name: "Find on page regression" }).waitFor();
  return { context, page };
}

async function openFind(page) {
  await page.getByRole("button", { name: "Open reading tools" }).click();
  await page.getByRole("menuitem", { name: "Find on this page" }).click();
  await expect(input(page)).toBeFocused();
}

async function search(page, query, count) {
  await input(page).fill(query);
  await expect(status(page)).toHaveText(count ? `1 of ${count}` : "No matches");
  await settle(page);
}

async function nativeRanges(page, active = false) {
  return page.evaluate((active) => [...(CSS.highlights.get(active ? "biy-page-find-active" : "biy-page-find") || [])].map((range) => ({
    text: range.toString(), start: range.startOffset, end: range.endOffset,
    startId: range.startContainer.parentElement.id,
    endId: range.endContainer.parentElement.id,
  })), active);
}

async function assertCleanup(page) {
  await expect(find(page)).toHaveCount(0);
  await expect(page.locator(".page-find-highlights")).toHaveCount(0);
  expect(await page.evaluate(() => !CSS.highlights || (!CSS.highlights.has("biy-page-find") && !CSS.highlights.has("biy-page-find-active")))).toBe(true);
}

// Decode browser PNGs without adding a test-only image dependency. Screenshot
// pixels, rather than DOM/source snapshots, prove the actual paint stayed on text.
function decodePng(png) {
  const chunks = [];
  let width, height, channels;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      expect(data[8], "PNG bit depth").toBe(8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels, "PNG must be RGB or RGBA").toBeGreaterThan(0);
    }
    if (type === "IDAT") chunks.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= channels ? pixels[at - channels] : 0;
      const b = y ? pixels[at - stride] : 0;
      const c = y && x >= channels ? pixels[at - stride - channels] : 0;
      const prior = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[at] = (raw[y * (stride + 1) + x + 1] + prior) & 255;
    }
  }
  return { width, height, channels, pixels };
}

async function geometry(page) {
  return page.locator("#geometry-word").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const bounds = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rects: [...range.getClientRects()].map(bounds),
      clipped: [...range.getClientRects()].map((rect) => ({
        x: Math.max(left, rect.left), y: Math.max(top, rect.top),
        width: Math.min(right, rect.right) - Math.max(left, rect.left),
        height: Math.min(bottom, rect.bottom) - Math.max(top, rect.top),
      })).filter((rect) => rect.width > 0 && rect.height > 0),
      highlights: [...(CSS.highlights?.get("biy-page-find") || [])].map((range) => ({ text: range.toString(), rects: [...range.getClientRects()].map(bounds) })),
      fallback: [...document.querySelectorAll(".page-find-highlights rect")].map((rect) => bounds(rect.getBoundingClientRect())),
    };
  });
}

async function assertPaint(page, label, fallback) {
  await settle(page);
  const measured = await geometry(page);
  expect(measured.clipped.length, `${label}: match is in visible scrollport`).toBeGreaterThan(0);
  if (fallback) {
    expect(measured.fallback.length, `${label}: SVG rectangle count`).toBe(measured.clipped.length);
    for (let index = 0; index < measured.clipped.length; index++)
      for (const key of ["x", "y", "width", "height"])
        expect(Math.abs(measured.fallback[index][key] - measured.clipped[index][key]), `${label}: fallback ${key}`).toBeLessThan(1.1);
  } else {
    expect(measured.highlights).toEqual([{ text: "lighthouse", rects: measured.rects }]);
    const active = await nativeRanges(page, true);
    expect(active.map((range) => range.text)).toEqual(["lighthouse"]);
  }
  const png = await page.screenshot({ path: new URL(`${label}.png`, screenshots).pathname, animations: "disabled" });
  if (!fallback) {
    const decoded = decodePng(png);
    const scaleX = decoded.width / measured.viewport.width;
    const scaleY = decoded.height / measured.viewport.height;
    let painted = 0, misaligned = 0;
    for (let y = 0; y < decoded.height; y++) for (let x = 0; x < decoded.width; x++) {
      const at = (y * decoded.width + x) * decoded.channels;
      if (decoded.pixels[at] !== 247 || decoded.pixels[at + 1] !== 171 || decoded.pixels[at + 2] !== 72) continue;
      painted++;
      const px = x / scaleX, py = y / scaleY;
      if (!measured.clipped.some((rect) => px >= rect.x - 1 && px <= rect.x + rect.width + 1 && py >= rect.y - 1 && py <= rect.y + rect.height + 1)) misaligned++;
    }
    expect(painted, `${label}: orange highlight pixels actually rendered`).toBeGreaterThan(30);
    expect(misaligned / painted, `${label}: highlight paint outside text Range`).toBeLessThan(0.01);
    metrics.push({ label, painted, misaligned, ...measured });
  } else metrics.push({ label, ...measured });
  return measured;
}

async function checkGeometry(page, label, fallback) {
  await search(page, "lighthouse", 1);
  // Keep the word away from the fixed find bar; center both scroll ancestors.
  await page.locator("#geometry-word").evaluate((element) => element.scrollIntoView({ block: "center" }));
  const initial = await assertPaint(page, `${label}-initial`, fallback);
  await page.evaluate(() => window.scrollBy(0, 37));
  const windowScroll = await assertPaint(page, `${label}-window-scroll`, fallback);
  expect(Math.abs(initial.rects[0].y - windowScroll.rects[0].y)).toBeGreaterThan(30);
  await page.locator("#nested-scroll").evaluate((element) => { element.scrollTop += 29; });
  const nestedScroll = await assertPaint(page, `${label}-nested-scroll`, fallback);
  expect(Math.abs(windowScroll.rects[0].y - nestedScroll.rects[0].y)).toBeGreaterThan(20);
  await page.locator("#geometry-line").evaluate((element) => { element.style.fontSize = "29px"; });
  await page.locator("#geometry-word").evaluate((element) => element.scrollIntoView({ block: "center" }));
  const reflow = await assertPaint(page, `${label}-font-reflow`, fallback);
  expect(reflow.rects[0].width).toBeGreaterThan(initial.rects[0].width * 1.3);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width - 48, height: viewport.height - 65 });
  await page.locator("#geometry-word").evaluate((element) => element.scrollIntoView({ block: "center" }));
  await assertPaint(page, `${label}-viewport-resize`, fallback);
  // A clipped nested word must not paint through the scrollport's edge.
  await page.locator("#geometry-word").evaluate((element) => {
    const scroll = document.getElementById("nested-scroll");
    const word = element.getBoundingClientRect();
    scroll.scrollTop += word.top - scroll.getBoundingClientRect().top + word.height / 2;
  });
  await assertPaint(page, `${label}-nested-clip`, fallback);
}

async function checkBehavior(page, native) {
  await openFind(page);
  await search(page, "beacon", 4);
  if (native) expect((await nativeRanges(page)).map((range) => range.startId)).toEqual(["summary-match", "outline-match", "main-match", "button-match"]);
  await find(page).getByRole("button", { name: "Previous match" }).click();
  await expect(status(page)).toHaveText("4 of 4");
  if (native) expect((await nativeRanges(page, true))[0].startId).toBe("button-match");
  await find(page).getByRole("button", { name: "Next match" }).click();
  await expect(status(page)).toHaveText("1 of 4");
  await input(page).press("Enter");
  await expect(status(page)).toHaveText("2 of 4");
  await input(page).press("Shift+Enter");
  await expect(status(page)).toHaveText("1 of 4");
  await page.locator("#details-match summary").click();
  await expect(status(page)).toHaveText("1 of 5");
  await page.locator("#mutation-target").evaluate((element) => { element.firstChild.data = "A mutated beacon appears."; });
  await expect(status(page)).toHaveText("1 of 6");
  await page.locator("#style-target").evaluate((element) => { element.style.display = "block"; });
  await expect(status(page)).toHaveText("1 of 7");
  await page.locator("main").evaluate((element) => {
    const addition = document.createElement("p");
    addition.id = "inserted-match";
    addition.textContent = "An inserted beacon appears.";
    element.append(addition);
  });
  await expect(status(page)).toHaveText("1 of 8");
  await page.locator("#inserted-match").evaluate((element) => element.remove());
  await expect(status(page)).toHaveText("1 of 7");
  await page.locator("#details-match").evaluate((element) => { element.open = false; });
  await expect(status(page)).toHaveText("1 of 6");
  await search(page, "living word", 1);
  if (native) expect((await nativeRanges(page))[0].text).toBe("living word");
  for (const [query, text, startId, endId] of [
    ["sunrise", "sunrise", "inline-block-start", "inline-block-end"],
    ["moonbeam", "moonbeam", "contents-start", "contents-end"],
    // Range.toString() omits BR; the search index supplies its visual whitespace.
    ["quiet waters", "quietwaters", "break-start", "break-end"],
  ]) {
    await search(page, query, 1);
    if (native) expect((await nativeRanges(page))[0]).toMatchObject({ text, startId, endId });
  }
  await search(page, "quietwaters", 0);
  await search(page, "revealedword", 1);
  if (native) expect((await nativeRanges(page))[0].startId).toBe("visibility-override");
  await search(page, "target", 1);
  if (native) {
    const expected = await page.locator("#unicode-text").textContent();
    const range = (await nativeRanges(page))[0];
    expect(range.text).toBe("TARGET");
    expect(range.start).toBe(expected.indexOf("TARGET"));
    expect(range.end).toBe(expected.indexOf("TARGET") + 6);
  }
  await search(page, "café", 1);
  if (native) expect((await nativeRanges(page))[0].text).toBe("café");
  await search(page, "not present anywhere", 0);
  await expect(find(page).getByRole("button", { name: "Next match" })).toBeDisabled();
  if (native) expect(await nativeRanges(page)).toEqual([]);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 800, height: viewport.height });
  await search(page, "responsiveword", 0);
  await page.setViewportSize({ width: 450, height: viewport.height });
  await expect(status(page)).toHaveText("1 of 1");
  await page.setViewportSize(viewport);
  await search(page, "deepword", 1);
  const deep = await page.locator("#long-paragraph").evaluate((element) => {
    const range = document.createRange();
    const start = element.firstChild.data.indexOf("deepword");
    range.setStart(element.firstChild, start);
    range.setEnd(element.firstChild, start + 8);
    const text = range.getBoundingClientRect(), scroll = element.parentElement.getBoundingClientRect();
    return { top: text.top, bottom: text.bottom, scrollTop: scroll.top, scrollBottom: scroll.bottom, height: innerHeight };
  });
  expect(deep.top, "deep match is scrolled inside its nested scrollport").toBeGreaterThanOrEqual(deep.scrollTop);
  expect(deep.bottom).toBeLessThanOrEqual(deep.scrollBottom);
  expect(deep.top, "deep match clears the fixed Find bar").toBeGreaterThanOrEqual(72);
  expect(deep.bottom).toBeLessThanOrEqual(deep.height);
  await search(page, "beacon", 6);
  await input(page).press("Escape");
  await assertCleanup(page);
  for (const modifier of ["ctrlKey", "metaKey"]) {
    expect(await page.evaluate((modifier) => {
      const event = new KeyboardEvent("keydown", { key: "f", [modifier]: true, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }, modifier)).toBe(true);
    await expect(find(page)).toBeVisible();
    await search(page, "beacon", 6);
    await page.locator("#button-match").focus();
    await page.keyboard.press(modifier === "ctrlKey" ? "Control+f" : "Meta+f");
    await expect(input(page)).toBeFocused();
    expect(await input(page).evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([0, 6]);
    await find(page).getByRole("button", { name: "Close find" }).click();
    await assertCleanup(page);
  }
  await openFind(page);
  await search(page, "beacon", 6);
  await page.getByRole("button", { name: "Change reading target" }).click();
  await assertCleanup(page);
  await openFind(page);
}

try {
  for (const name of names) {
    const browser = await ({ chromium, webkit })[name].launch({
      headless: true,
      ...(process.env.FIND_BROWSER_PATH ? { executablePath: process.env.FIND_BROWSER_PATH } : {}),
    });
    try {
      for (const mobile of [false, true]) {
        const label = `${name}-${mobile ? "mobile" : "desktop"}`;
        const { context, page } = await open(browser, mobile);
        try {
          const native = await page.evaluate(() => !!CSS.highlights && typeof Highlight !== "undefined");
          await checkBehavior(page, native);
          await checkGeometry(page, `${label}-${native ? "native" : "fallback"}`, !native);
          await page.getByRole("button", { name: "Unmount reading" }).click();
          await assertCleanup(page);
          console.log(`PASS ${label}: visible text, live refresh, navigation, Unicode, native shortcuts, cleanup, painted geometry`);
        } catch (error) {
          await page.screenshot({ path: new URL(`${label}-failure.png`, screenshots).pathname }).catch(() => {});
          throw error;
        } finally { await context.close(); }
        const forced = await open(browser, mobile, true);
        try {
          await openFind(forced.page);
          await checkGeometry(forced.page, `${label}-forced-fallback`, true);
          await input(forced.page).press("Escape");
          await assertCleanup(forced.page);
          console.log(`PASS ${label}: forced unsupported-Highlight SVG fallback geometry and cleanup`);
        } catch (error) {
          await forced.page.screenshot({ path: new URL(`${label}-fallback-failure.png`, screenshots).pathname }).catch(() => {});
          throw error;
        } finally { await forced.context.close(); }
      }
      const ordinary = await open(browser, false, false, false);
      try {
        for (const modifier of ["ctrlKey", "metaKey"])
          expect(await ordinary.page.evaluate((modifier) => {
            const event = new KeyboardEvent("keydown", { key: "f", [modifier]: true, bubbles: true, cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
          }, modifier), "ordinary browser retains its native Find shortcut").toBe(false);
        await expect(find(ordinary.page)).toHaveCount(0);
      } finally { await ordinary.context.close(); }
    } finally { await browser.close(); }
  }
  expect(errors, "No browser errors or unexpected API traffic").toEqual([]);
} finally {
  await writeFile(new URL("geometry-results.json", screenshots), JSON.stringify(metrics, null, 2));
  await server.close();
}
