import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const { chromium } = await import(
  "file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);

const url = process.env.APP_URL ?? "http://localhost:5173";
const screenshotPath = resolve("artifacts", "ui-check.png");
const browserPaths = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

const executablePath = browserPaths.find((path) => existsSync(path));
const browser = await chromium.launch({
  headless: true,
  executablePath
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

page.on("pageerror", (error) => {
  consoleErrors.push(error.message);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("h1", { hasText: "Halifax Sourced" }).waitFor();

const cardCount = await page.locator(".restaurant-card").count();
if (cardCount < 8) {
  throw new Error(`Expected at least 8 restaurant cards, found ${cardCount}.`);
}

await page.locator("#search").fill("Dartmouth");
const dartmouthCount = await page.locator(".restaurant-card").count();
if (dartmouthCount < 2) {
  throw new Error(`Expected Dartmouth search results, found ${dartmouthCount}.`);
}

await page.locator("#search").fill("");
const mapState = await page.evaluate(() => ({
  markers: window.__halifaxMapMarkerCount ?? 0,
  canvases: document.querySelectorAll(".leaflet-overlay-pane canvas").length,
  tiles: document.querySelectorAll(".leaflet-tile-loaded").length,
  leaflet: Boolean(window.L)
}));
if (!mapState.leaflet || mapState.markers < 100 || mapState.canvases < 1 || mapState.tiles < 1) {
  throw new Error(`Expected expanded Leaflet map, got ${JSON.stringify(mapState)}.`);
}

await page.locator('button[data-filter="events"]').click();
const eventCards = await page.locator(".restaurant-card").count();
if (eventCards < 1) {
  throw new Error("Expected at least one event-capable restaurant.");
}

await page.locator('button[data-filter="all"]').click();
await page.locator('button[data-view="admin"]').click();
const adminCards = await page.locator(".admin-card").count();
if (adminCards < 100) {
  throw new Error(`Expected expanded admin review queue, found ${adminCards}.`);
}
await page.locator('button[data-view="public"]').click();

const overlay = await page
  .locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")
  .count();
if (overlay > 0) {
  throw new Error("Framework error overlay detected.");
}

if (consoleErrors.length) {
  throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
}

await mkdir("artifacts", { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });
await browser.close();

console.log(`UI verified. Screenshot saved to ${screenshotPath}`);
