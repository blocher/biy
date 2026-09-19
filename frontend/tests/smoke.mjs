import { chromium } from "@playwright/test";
import fs from "node:fs";
const password = fs
  .readFileSync("../.env", "utf8")
  .match(/^BEN_INITIAL_PASSWORD=(.*)$/m)?.[1];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5178/");
await page.getByLabel("Password", { exact: true }).fill(password);
await page.getByRole("button", { name: "Continue your journey" }).click();
await page.getByRole("link", { name: "Continue Day 1", exact: true }).waitFor();
await page.screenshot({
  path: "../data/screenshots/home-desktop.png",
  fullPage: true,
});
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw new Error("Desktop home overflow");
await page.getByRole("link", { name: "Continue Day 1", exact: true }).click();
await page
  .getByRole("heading", { name: "In the Beginning", exact: true })
  .waitFor();
await page.screenshot({
  path: "../data/screenshots/day-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: /^(Listen to episode|Resume listening)$/ })
  .click();
await page.locator("audio").evaluate(
  (a) =>
    new Promise((resolve, reject) => {
      if (a.readyState >= 1) return resolve();
      a.addEventListener("loadedmetadata", resolve, { once: true });
      setTimeout(() => reject(new Error("Audio metadata timed out")), 15000);
    }),
);
await page.getByRole("slider", { name: "Audio position" }).fill("120");
console.log(
  "Audio seek",
  await page.locator("audio").evaluate((a) => a.currentTime),
);
await page.getByRole("button", { name: "Pause", exact: true }).click();
await page.getByRole("link", { name: "Reader mode", exact: true }).click();
await page
  .getByRole("heading", { name: "Genesis 1-2 and Psalm 19", exact: true })
  .waitFor();
await page.screenshot({
  path: "../data/screenshots/reader-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Larger text" }).click();
await page.getByRole("link", { name: "Exit reader" }).click();
await page.getByRole("button", { name: "Journal", exact: true }).click();
await page
  .getByLabel("Journal entry")
  .fill("Automated acceptance test — delete after verification.");
await page.getByRole("button", { name: "Save journal", exact: true }).click();
await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
await page.reload();
await page.getByRole("button", { name: "Journal", exact: true }).click();
await page
  .getByText("Automated acceptance test — delete after verification.", {
    exact: true,
  })
  .waitFor();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Delete entry" }).click();
await page
  .getByText("Automated acceptance test — delete after verification.", {
    exact: true,
  })
  .waitFor({ state: "detached" });
await page.getByRole("button", { name: "Mark complete", exact: true }).click();
await page.getByRole("button", { name: "Completed", exact: true }).waitFor();
await page.reload();
await page.getByRole("button", { name: "Completed", exact: true }).click();
await page
  .getByRole("button", { name: "Mark complete", exact: true })
  .waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "../data/screenshots/day-mobile.png",
  fullPage: true,
});
await page.screenshot({ path: "../data/screenshots/day-mobile-viewport.png" });
console.log(
  "Day mobile overflow",
  await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  })),
);
await page.goto("http://127.0.0.1:5178/");
await page.getByRole("link", { name: "Continue Day 1", exact: true }).waitFor();
await page.screenshot({
  path: "../data/screenshots/home-mobile.png",
  fullPage: true,
});
await page.screenshot({ path: "../data/screenshots/home-mobile-viewport.png" });
console.log(
  "Home mobile overflow",
  await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  })),
);
console.log("Browser errors", errors);
await browser.close();
if (errors.length) process.exit(1);
