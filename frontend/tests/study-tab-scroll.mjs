import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, query, resets] of [[390, "", true], [1440, "", false], [390, "?reader", false], [390, "#passage", false]]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/study-tab-scroll.html${query}`);
    await page.evaluate(() => scrollTo(0, 1500));
    await page.getByRole("button", { name: "Commentary", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Commentary start" })).toBeVisible();
    if (resets) {
      const panel = await page.locator("#study-panel").boundingBox();
      expect(Math.abs(panel.y - 102)).toBeLessThan(1);
    } else expect(await page.evaluate(() => scrollY)).toBe(1500);
    await page.close();
  }
  console.log("Mobile tab resets and desktop/reader/hash exclusions passed.");
} finally { await browser.close(); await server.close(); }
