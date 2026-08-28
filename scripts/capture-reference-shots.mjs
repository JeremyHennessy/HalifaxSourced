import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  "file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  "file:///root/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
].filter(Boolean);

let playwright;
for (const candidate of candidates) {
  try {
    if (candidate.startsWith("file://") && !existsSync(new URL(candidate))) continue;
    playwright = await import(candidate);
    break;
  } catch {}
}
if (!playwright) {
  try { playwright = await import("playwright"); } catch {}
}
if (!playwright?.chromium) throw new Error("Playwright is required for reference capture.");

const baseUrl = (process.env.APP_URL ?? "https://jeremyhennessy.github.io/HalifaxSourced").replace(/\/$/, "");
const outputDir = resolve("artifacts", "reference");
await mkdir(outputDir, { recursive: true });

const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

const metrics = {};
async function go(hash, waitSelector) {
  await page.goto(`${baseUrl}/${hash}`, { waitUntil: "networkidle" });
  if (waitSelector) await page.locator(waitSelector).first().waitFor({ state: "visible" });
  await page.waitForTimeout(hash === "#map" ? 1400 : 250);
}
async function capture(name) {
  metrics[name] = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    route: location.hash,
    restaurantCards: document.querySelectorAll(".restaurant-card").length,
    eventCards: document.querySelectorAll(".event-card").length,
    mapMarkers: window.__halifaxMapMarkerCount ?? null
  }));
  await page.screenshot({ path: resolve(outputDir, `${name}.png`), fullPage: true });
}

await go("#home", ".home-hero");
await capture("home-desktop-1440");

await go("#explore", ".restaurant-card");
const detailHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
if (!detailHref) throw new Error("Could not resolve a restaurant detail route from Explore.");
await capture("explore-desktop-1440");

await go(detailHref, ".restaurant-hero");
await capture("restaurant-detail-desktop-1440");

await go("#events", ".event-card");
await capture("events-desktop-1440");

await go("#map", "#mainMap");
await capture("map-desktop-1440");

await page.setViewportSize({ width: 390, height: 844 });
await go("#home", ".home-hero");
await capture("home-mobile-390");

await page.setViewportSize({ width: 393, height: 852 });
await go(detailHref, ".restaurant-hero");
await capture("restaurant-detail-mobile-393");

await writeFile(resolve(outputDir, "capture-metrics.json"), JSON.stringify(metrics, null, 2));
await browser.close();
console.log(`Reference screenshots captured in ${outputDir}`);
