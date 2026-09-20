// Local acceptance: temporary test account, real site-only answer; does not change members' notes.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const credentials = JSON.parse(
  fs.readFileSync(process.env.BIY_CHAT_SMOKE_ACCOUNT, "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5178/day/1?tab=scripture");
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Continue your journey" }).click();
  const history = page.getByRole("region", {
    name: "Your conversations for this reading",
  });
  await expect(history).toBeVisible();
  const opener = page.getByRole("button", {
    name: "Ask about this reading",
    exact: true,
  });
  await opener.scrollIntoViewIfNeeded();
  const readingScroll = await page.evaluate(() => scrollY);
  await opener.click();
  const originalURL = page.url();
  const dialog = page.getByRole("dialog", { name: "Ask" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  if (Math.abs(box.x - (1440 - box.width) / 2) > 2)
    throw Error("Dialog is not centered");
  await expect(dialog.getByText("Day 1 · Whole Bible scope")).toBeVisible();
  await dialog.getByLabel("Include outside sources").uncheck();
  const question = "Did any user of this site comment on Genesis 1?";
  await dialog.getByLabel("Your question", { exact: true }).fill(question);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await dialog.locator(".chat-answer-text").waitFor({ timeout: 180000 });
  await expect(dialog.locator(".chat-answer-text")).toContainText(/fiat lux/i);
  await expect(dialog.locator(".chat-answer-text")).toContainText(/elizabeth/i);
  if (page.url() !== originalURL) throw Error("Chat changed the reading URL");
  await dialog.locator(".chat-citation").first().click();
  await expect(
    dialog.locator(".chat-sources details[open]").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "../data/screenshots/chat-reading-desktop.png",
  });
  await dialog.getByRole("button", { name: "Close Ask" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  if (Math.abs((await page.evaluate(() => scrollY)) - readingScroll) > 2)
    throw Error("Closing chat changed the reading position");
  await history.getByRole("button", { name: question, exact: true }).click();
  await expect(dialog.locator(".chat-answer-text")).toContainText(/fiat lux/i);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await history.getByRole("button", { name: question, exact: true }).click();
  await expect(dialog.locator(".chat-answer-text")).toContainText(/fiat lux/i);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../data/screenshots/chat-reading-mobile.png",
  });
  if (await dialog.evaluate((el) => el.scrollWidth > el.clientWidth))
    throw Error("Mobile dialog overflow");
  await dialog.getByRole("button", { name: "Close Ask" }).click();
  await page.goto("http://127.0.0.1:5178/day/2");
  await expect(
    history.getByRole("button", { name: question, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Ask about this reading", exact: true })
    .click();
  await expect(dialog.getByText("Day 2 · Whole Bible scope")).toBeVisible();
  await expect(dialog.locator(".chat-answer-text")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("http://127.0.0.1:5178/day/1/reader?tab=scripture");
  await page
    .getByRole("button", { name: "Ask about this reading", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Saved conversations")
    .selectOption({ label: question });
  await expect(dialog.locator(".chat-answer-text")).toContainText(/fiat lux/i);
  await dialog.locator(".chat-citation").first().click();
  const noteLink = dialog
    .locator(".chat-sources details[open]")
    .first()
    .getByRole("link", { name: /Open in study/ });
  await noteLink.click();
  await expect(dialog).not.toBeVisible();
  if (!page.url().includes("#note-4"))
    throw Error("Expected Elizabeth note citation destination");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: live Fiat Lux answer, citations, reading URL preserved, focus/Escape, saved history/reload, day scope, mobile, reader mode, source navigation.",
  );
} catch (e) {
  await page.screenshot({
    path: "../data/screenshots/chat-reading-failure.png",
    fullPage: true,
  });
  console.log("Alerts:", await page.getByRole("alert").allTextContents());
  throw e;
} finally {
  await browser.close();
}
