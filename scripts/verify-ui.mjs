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

const url = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
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
await mkdir("artifacts", { recursive: true });

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.locator(".brand-link img").waitFor();
await page.locator("h1", { hasText: "Local flavour" }).waitFor();
const homeCards = await page.locator(".restaurant-card").count();
if (homeCards < 4) throw new Error(`Expected at least 4 home restaurant cards, found ${homeCards}.`);
const totals = await page.evaluate(() => ({ restaurants: window.__halifaxRestaurantCount ?? 0, officialSignals: window.__halifaxOfficialSignalCount ?? 0 }));
if (totals.restaurants < 700 || totals.officialSignals < 100) throw new Error(`Expected preserved discovery data, got ${JSON.stringify(totals)}.`);
await page.screenshot({ path: resolve("artifacts", "ui-check-desktop.png"), fullPage: true });

await page.locator("#globalSearch").fill("Dartmouth");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
await page.locator(".restaurant-card").first().waitFor();
const exploreCards = await page.locator(".restaurant-card").count();
if (exploreCards < 1 || exploreCards > 12) throw new Error(`Expected paginated explore results, found ${exploreCards}.`);

await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
const eventCards = await page.locator(".event-card").count();
if (eventCards < 1 || eventCards > 8) throw new Error(`Expected curated event-source leads (1-8), found ${eventCards}.`);

await page.goto(`${url}/#map`, { waitUntil: "networkidle" });
await page.locator("#mainMap").waitFor();
await page.waitForTimeout(1200);
const mapState = await page.evaluate(() => ({ leaflet: Boolean(window.L), markers: window.__halifaxMapMarkerCount ?? 0 }));
if (!mapState.leaflet || mapState.markers < 100) throw new Error(`Expected populated Leaflet map, got ${JSON.stringify(mapState)}.`);
const firstMapRow = page.locator("[data-map-result-id]").first();
await firstMapRow.focus();
await firstMapRow.press("Enter");
if (!(await firstMapRow.evaluate((node) => node.classList.contains("is-highlighted")))) throw new Error("Expected keyboard activation to synchronize a list row with its map marker.");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.waitForTimeout(150);
const mobileState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bottomNavVisible: getComputedStyle(document.querySelector(".mobile-tabbar")).display !== "none",
  heroHeight: Math.round(document.querySelector(".home-hero")?.getBoundingClientRect().height || 0)
}));
if (mobileState.overflow > 2 || !mobileState.bottomNavVisible || mobileState.heroHeight < 500) throw new Error(`Expected polished mobile layout, got ${JSON.stringify(mobileState)}.`);

await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
const mobileFilterToggle = page.locator("[data-open-filters]");
await mobileFilterToggle.waitFor();
await mobileFilterToggle.click();
if (await mobileFilterToggle.getAttribute("aria-expanded") !== "true") throw new Error("Expected mobile filter drawer to open and expose expanded state.");
if (!(await page.locator("[data-filter-drawer]").evaluate((node) => node.classList.contains("is-open")))) throw new Error("Expected mobile filter drawer to be visible.");
await page.locator("#neighbourhoodFilter").selectOption("Dartmouth");
await page.locator("[data-filter-apply]").click();
await page.locator(".restaurant-card").first().waitFor();
if (await page.locator(".restaurant-card").count() < 1) throw new Error("Expected Dartmouth results after applying mobile filters.");
if (await page.evaluate(() => document.body.classList.contains("filter-drawer-open"))) throw new Error("Expected mobile filter drawer to close after applying filters.");

const detailHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
if (!detailHref) throw new Error("Expected restaurant detail route from filtered results.");
await page.goto(`${url}/${detailHref}`, { waitUntil: "networkidle" });
await page.locator(".restaurant-hero").waitFor();
const detailState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  stickyActions: getComputedStyle(document.querySelector(".mobile-detail-actions")).display !== "none",
  actionCount: document.querySelectorAll(".mobile-detail-actions a").length
}));
if (detailState.overflow > 2 || !detailState.stickyActions || detailState.actionCount < 1) throw new Error(`Expected usable mobile restaurant actions, got ${JSON.stringify(detailState)}.`);

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.screenshot({ path: resolve("artifacts", "ui-check-mobile.png"), fullPage: true });

if (consoleErrors.length) throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
await browser.close();
console.log("Halifax Sourced UI verified: routes, search, filters, map/list sync, desktop, and mobile detail actions.");
