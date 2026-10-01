import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const engine = process.env.COMPLETION_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({ headless: true });

try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${origin}/tests/fixtures/completion-dialog.html`);
    await page.getByRole("button", { name: "Mark complete" }).click();
    const dialog = page.getByRole("dialog", { name: "Day 1 complete" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2))
      .toBeLessThan(2);
    expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2))
      .toBeLessThan(2);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    await page.close();
  }
  console.log("Completion dialog centered across desktop and mobile viewports.");
} finally {
  await browser.close();
  await server.close();
}
