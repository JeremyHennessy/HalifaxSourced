import { existsSync } from "node:fs";

let playwright;
try { playwright = await import("playwright"); } catch {}
if (!playwright?.chromium) throw new Error("Playwright is required for this diagnostic.");

const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/chromium"].filter(Boolean).find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });

for (let attempt = 1; attempt <= 6; attempt += 1) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
  await page.locator("#exploreMiniMap").waitFor();
  await page.evaluate(() => {
    renderExplore();
    renderExplore();
  });
  await page.waitForTimeout(100);
  console.log(`attempt=${attempt} errors=${errors.length}`);
  for (const error of errors) console.log(error);
  await page.close();
  if (!errors.some((error) => error.includes("Map container is already initialized"))) {
    throw new Error(`Expected duplicate-map reproduction in attempt ${attempt}, got: ${errors.join(" | ") || "no browser error"}`);
  }
}

await browser.close();
console.log("Confirmed: same-frame Explore rerenders schedule duplicate mini-map initialization against the newest container.");
