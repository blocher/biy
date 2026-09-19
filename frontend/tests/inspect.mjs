import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5178");
await page
  .getByLabel("Password", { exact: true })
  .fill(
    fs.readFileSync("../.env", "utf8").match(/^BEN_INITIAL_PASSWORD=(.*)$/m)[1],
  );
await page.getByRole("button", { name: "Continue your journey" }).click();
await page.getByRole("link", { name: "Continue Day 1", exact: true }).waitFor();
console.log(
  await page.evaluate(() =>
    ["page-flow", "hero", "header", "hero-headline", "hero-progress"].map(
      (id) => {
        const n = document.getElementById(id),
          s = getComputedStyle(n),
          r = n.getBoundingClientRect();
        return {
          id,
          x: r.x,
          y: r.y,
          width: r.width,
          position: s.position,
          left: s.left,
          transform: s.transform,
          margin: s.margin,
          padding: s.padding,
          gridRow: s.gridRow,
          display: s.display,
        };
      },
    ),
  ),
);
console.log(
  await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((n) => n.getBoundingClientRect().right > innerWidth + 1)
      .map((n) => ({
        id: n.id,
        tag: n.tagName,
        right: n.getBoundingClientRect().right,
      }))
      .slice(0, 20),
  ),
);
await page.screenshot({ path: "../data/screenshots/home-viewport.png" });
await page.goto("http://127.0.0.1:5178/day/1");
await page
  .getByRole("heading", { name: "In the Beginning", exact: true })
  .waitFor();
await page.screenshot({ path: "../data/screenshots/day-viewport.png" });
await browser.close();
