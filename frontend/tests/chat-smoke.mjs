import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const credentials = process.env.BIY_CHAT_SMOKE_ACCOUNT
  ? JSON.parse(fs.readFileSync(process.env.BIY_CHAT_SMOKE_ACCOUNT, "utf8"))
  : {
      username: "ben",
      password: fs
        .readFileSync("../.env", "utf8")
        .match(/^BEN_INITIAL_PASSWORD=(.*)$/m)?.[1],
    };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5178/chat?day=1");
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Continue your journey" }).click();
  await page
    .getByRole("heading", { name: "Ask", exact: true })
    .waitFor();
  await expect(page.getByText("Day 1 · Whole Bible scope")).toBeVisible();
  await page.getByLabel("Include outside sources").uncheck();
  await page
    .getByLabel("Your question", { exact: true })
    .fill(
      "Summarize the Day 1 readings and the main teaching from Fr. Mike. Cite Scripture and the commentary.",
    );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".chat-answer-text").waitFor({ timeout: 180000 });
  await expect(page.locator(".chat-citation").first()).toBeVisible();
  await page.locator(".chat-citation").first().click();
  await expect(
    page.locator(".chat-sources details[open]").first(),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../data/screenshots/chat-desktop.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Desktop overflow");
  await page.reload();
  await page.locator(".chat-answer-text").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../data/screenshots/chat-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "Chat smoke passed: live answer, citations, persistence, desktop/mobile layout.",
  );
  console.log("Conversation URL:", page.url());
} catch (e) {
  await page.screenshot({
    path: "../data/screenshots/chat-failure.png",
    fullPage: true,
  });
  console.log(
    "UI errors:",
    errors,
    "alerts:",
    await page.locator('[role="alert"]').allTextContents(),
    "URL:",
    page.url(),
  );
  throw e;
} finally {
  await browser.close();
}
