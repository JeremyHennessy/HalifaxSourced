import { existsSync } from "node:fs";

let playwright;
try { playwright = await import("playwright"); } catch {}
if (!playwright?.chromium) throw new Error("Playwright is required for this regression test.");

const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/chromium"].filter(Boolean).find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });

for (let attempt = 1; attempt <= 2; attempt += 1) {
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
  if (errors.length) throw new Error(`Explore mini-map lifecycle attempt ${attempt} emitted browser errors:\n${errors.join("\n")}`);
  const initialized = await page.locator("#exploreMiniMap").evaluate((node) => Boolean(node._leaflet_id));
  if (!initialized) throw new Error(`Explore mini-map lifecycle attempt ${attempt} did not initialize the current map container.`);
  console.log(`attempt=${attempt} initialized=${initialized}`);
  await page.close();
}

await browser.close();
console.log("Explore mini-map lifecycle regression passed: stale same-frame renders do not initialize the newest map container.");
