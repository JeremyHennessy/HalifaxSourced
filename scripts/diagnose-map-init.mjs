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
page.on("pageerror", (error) => errors.push(`PAGEERROR: ${error.stack || error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`CONSOLE: ${message.text()}`); });

async function installMapProbe() {
  await page.evaluate(() => {
    if (!window.L || window.__halifaxMapProbeInstalled) return;
    const original = window.L.map;
    window.L.map = function probedMap(target, options) {
      const element = typeof target === "string" ? document.getElementById(target) : target;
      if (element?._leaflet_id) {
        console.error(`DUPLICATE_MAP_CONTAINER id=${element.id || "(none)"} hash=${location.hash} leafletId=${element._leaflet_id} stack=${new Error().stack}`);
      }
      return original.call(this, target, options);
    };
    window.__halifaxMapProbeInstalled = true;
  });
}

async function runSequence(round) {
  await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.locator("#globalSearch").fill("Sakaba");
  await page.locator("#globalSearch").press("Enter");
  await page.locator(".restaurant-card", { hasText: "Sakaba" }).first().waitFor();

  await page.locator("#globalSearch").fill("Dartmouth");
  await page.locator("#globalSearch").press("Enter");
  await page.locator(".restaurant-card").first().waitFor();

  for (const feature of ["social", "reservations", "ordering"]) {
    await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
    await installMapProbe();
    await page.locator("#featureFilter").selectOption(feature);
    await page.locator("[data-filter-apply]").click();
    await page.locator(".restaurant-card").first().waitFor();
  }

  await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.locator("#featureFilter").selectOption("social");
  await page.locator("[data-filter-apply]").click();
  const socialHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
  if (!socialHref) throw new Error("Missing social detail href in diagnostic.");
  await page.goto(`${url}/${socialHref}`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.locator(".restaurant-hero").waitFor();

  await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
  await installMapProbe();
  const loadMore = page.locator("[data-event-load-more]");
  if (await loadMore.count()) await loadMore.click();
  const sports = page.locator('[data-event-category="Sports"]');
  if (await sports.count()) {
    await sports.click();
    await page.locator(".event-card").first().waitFor();
  }

  await page.evaluate(() => {
    state.query = "";
    state.cuisine = "all";
    state.neighbourhood = "all";
    state.feature = "all";
    state.page = 1;
    state.sort = "recommended";
  });
  await page.goto(`${url}/#map`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.locator("#mainMap").waitFor();
  await page.waitForTimeout(1200);
  const firstMapRow = page.locator("[data-map-result-id]").first();
  await firstMapRow.focus();
  await firstMapRow.press("Enter");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
  await installMapProbe();
  const filterToggle = page.locator("[data-open-filters]");
  await filterToggle.waitFor();
  await filterToggle.click();
  await page.locator("#neighbourhoodFilter").selectOption("Dartmouth");
  await page.locator("[data-filter-apply]").click();
  await page.locator(".restaurant-card").first().waitFor();
  const detailHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
  if (!detailHref) throw new Error("Missing mobile detail href in diagnostic.");
  await page.goto(`${url}/${detailHref}`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.locator(".restaurant-hero").waitFor();
  await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
  await installMapProbe();
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(`Completed diagnostic sequence ${round}.`);
}

for (let round = 1; round <= 8; round += 1) await runSequence(round);
await page.waitForTimeout(300);
await browser.close();
if (errors.length) {
  console.error(errors.join("\n---\n"));
  process.exit(1);
}
console.log("No browser errors during repeated full multi-route sequences.");
