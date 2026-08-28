import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
if (!playwright?.chromium) throw new Error("Playwright is required for UI verification. Set PLAYWRIGHT_MODULE if it is installed outside node_modules.");

const url = process.env.APP_URL ?? "http://localhost:5173";
const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.locator(".brand-link img").waitFor();
await page.locator("h1", { hasText: "Local flavour" }).waitFor();
const homeCards = await page.locator(".restaurant-card").count();
if (homeCards < 4) throw new Error(`Expected at least 4 home restaurant cards, found ${homeCards}.`);
const totals = await page.evaluate(() => ({ restaurants: window.__halifaxRestaurantCount ?? 0, officialSignals: window.__halifaxOfficialSignalCount ?? 0 }));
if (totals.restaurants < 700 || totals.officialSignals < 100) throw new Error(`Expected preserved discovery data, got ${JSON.stringify(totals)}.`);

await page.locator("#globalSearch").fill("Dartmouth");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
await page.locator(".restaurant-card").first().waitFor();
const exploreCards = await page.locator(".restaurant-card").count();
if (exploreCards < 1 || exploreCards > 12) throw new Error(`Expected paginated explore results, found ${exploreCards}.`);

await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
if (await page.locator(".event-card").count() < 1) throw new Error("Expected at least one event-source lead.");

await page.goto(`${url}/#map`, { waitUntil: "networkidle" });
await page.locator("#mainMap").waitFor();
await page.waitForTimeout(1200);
const mapState = await page.evaluate(() => ({ leaflet: Boolean(window.L), markers: window.__halifaxMapMarkerCount ?? 0 }));
if (!mapState.leaflet || mapState.markers < 100) throw new Error(`Expected populated Leaflet map, got ${JSON.stringify(mapState)}.`);

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
const mobileState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bottomNavVisible: getComputedStyle(document.querySelector(".mobile-tabbar")).display !== "none",
  heroHeight: Math.round(document.querySelector(".home-hero")?.getBoundingClientRect().height || 0)
}));
if (mobileState.overflow > 2 || !mobileState.bottomNavVisible || mobileState.heroHeight < 500) throw new Error(`Expected polished mobile layout, got ${JSON.stringify(mobileState)}.`);

if (consoleErrors.length) throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
await mkdir("artifacts", { recursive: true });
await page.screenshot({ path: resolve("artifacts", "ui-check-desktop.png"), fullPage: true });
await page.screenshot({ path: resolve("artifacts", "ui-check-mobile.png"), fullPage: true });
await browser.close();
console.log("Halifax Sourced UI verified.");
