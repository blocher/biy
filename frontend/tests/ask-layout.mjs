import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(
      engine === chromium ? { channel: "chrome", headless: true } : {},
    );
    try {
      for (const [width, height] of [
        [1440, 1000],
        [390, 844],
        [390, 460],
        [320, 568],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          serviceWorkers: "block",
        });
        await page.goto(
          `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/ask-layout.html`,
        );
        await page
          .getByRole("button", { name: "Open Ask", exact: true })
          .click();
        if (width === 320)
          await page.evaluate(
            () => (document.documentElement.dataset.theme = "dark"),
          );
        const input = page.getByLabel("Your question", { exact: true });
        await expect(input).toBeFocused();
        await expect(input).toHaveValue(
          "In John 1:5, I highlighted:\n\n“The light shines in the darkness.”\n\n",
        );
        const opening = await input.inputValue();
        expect(await input.evaluate((el) => el.selectionStart)).toBe(
          opening.length,
        );
        const prefix = opening;
        const bounds = await input.boundingBox();
        const minimum = height > 700 ? height * (width > 650 ? 0.4 : 0.5) : 90;
        if (bounds.height < minimum || bounds.y + bounds.height > height)
          throw Error(`Editor not roomy/visible: ${JSON.stringify(bounds)}`);
        await page.locator(".chat-source-options > summary").click();
        await page.getByLabel("Include outside sources").check();
        await expect(page.locator(".chat-source-options > summary")).toHaveText(
          "Study + outside sources",
        );
        await page.locator(".chat-source-options > summary").click();
        if (width === 390 && height === 844) {
          await input.focus();
          await page.setViewportSize({ width, height: 460 });
          await expect(page.locator(".reading-chat-dialog")).toHaveAttribute(
            "data-compact-viewport",
            "",
          );
          await expect(input).toBeFocused();
          const keyboard = await input.boundingBox();
          expect(keyboard.height).toBeGreaterThan(90);
          expect(keyboard.y + keyboard.height).toBeLessThan(460);
          await page.setViewportSize({ width, height });
          await expect(
            page.locator(".reading-chat-dialog"),
          ).not.toHaveAttribute("data-compact-viewport", "");
        }
        await page.locator(".chat-ideas > summary").click();
        const suggestion = page.locator(".chat-ideas button").first();
        const prompt = (await suggestion.innerText()).trim();
        await suggestion.click();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue(prefix + prompt);
        expect(await input.evaluate((el) => el.selectionStart)).toBe(
          prefix.length + prompt.length,
        );
        await expect(page.locator("output")).toBeEmpty();
        await input.press("Enter");
        await input.pressSequentially("My own detail.");
        await expect(input).toHaveValue(prefix + prompt + "\nMy own detail.");
        await expect(page.locator("output")).toBeEmpty();
        await page.screenshot({
          path: `/tmp/biy-compose-${engine.name()}-${width}-${height}.png`,
        });
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await expect(page.locator("output")).toContainText("I highlighted:");
        await expect(page.locator("output")).toContainText("My own detail.");
        await expect(
          page.getByText("An answer to your question.", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Tell me more about this passage." })
          .click();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("Tell me more about this passage.");
        await page.getByRole("button", { name: "Close Ask" }).click();
        await page
          .getByRole("button", { name: "Open note", exact: true })
          .click();
        const note = page.getByLabel("Your note", { exact: true });
        await expect(note).toBeFocused();
        await expect(note).toHaveValue("A thought to continue.");
        await expect
          .poll(() => note.evaluate((el) => el.selectionStart))
          .toBe(22);
        const nb = await note.boundingBox();
        if (nb.height < minimum || nb.y + nb.height > height)
          throw Error(`Note editor: ${JSON.stringify(nb)}`);
        await note.pressSequentially(" More.");
        await page.getByRole("button", { name: "Save changes" }).click();
        await page
          .getByRole("button", { name: "Open note", exact: true })
          .click();
        await expect(note).toHaveValue("A thought to continue. More.");
        await page.screenshot({
          path: `/tmp/biy-note-${engine.name()}-${width}-${height}.png`,
        });
        await page.close();
        console.log(
          `Passed compose, prompt, send, follow-up, note ${engine.name()} ${width} × ${height}`,
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
