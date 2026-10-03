import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
    [390, 460],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/ask-layout.html`,
    );
    await page.getByText("Open Ask", { exact: true }).click();
    const input = page.getByLabel("Your question", { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    const bounds = await input.boundingBox();
    if (bounds.height < 90 || bounds.y + bounds.height > height)
      throw Error(`Input outside visible viewport: ${JSON.stringify(bounds)}`);
    await input.fill("What does light mean here?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("output")).toContainText("I highlighted:");
    await expect(page.locator("output")).toContainText(
      "What does light mean here?",
    );
    await page.screenshot({ path: `/tmp/biy-ask-${width}-${height}.png` });
    await page.close();
    console.log(`Passed Ask layout ${width} × ${height}`);
  }
} finally {
  await browser.close();
  await server.close();
}
