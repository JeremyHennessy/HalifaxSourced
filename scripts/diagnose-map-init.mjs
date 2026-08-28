import { existsSync } from "node:fs";

let playwright;
try { playwright = await import("playwright"); } catch {}
if (!playwright?.chromium) throw new Error("Playwright is required for this diagnostic.");

const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const browserPaths = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/chromium"].filter(Boolean);
const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack || error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`); });

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.goto(`${url}/#explore`, { waitUntil: "domcontentloaded" });
  await page.locator("#featureFilter").waitFor();
  for (const feature of ["social", "reservations", "ordering", "all"]) {
    await page.locator("#featureFilter").selectOption(feature);
    await page.locator("[data-filter-apply]").click();
    await page.locator("#featureFilter").waitFor();
  }
  await page.goto(`${url}/#events`, { waitUntil: "domcontentloaded" });
}

await page.waitForTimeout(250);
await browser.close();
if (errors.length) {
  console.error(errors.join("\n---\n"));
  process.exit(1);
}
console.log("No browser errors during repeated Explore rerenders.");
