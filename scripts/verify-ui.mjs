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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.message));
await mkdir("artifacts", { recursive: true });
async function captureIphone(name) {
  await page.locator(".toast").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.screenshot({ path: resolve("artifacts", `ui-check-iphone-${name}.png`), fullPage: true });
}

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.locator(".brand-link img").waitFor();
await page.locator("h1", { hasText: "Local flavour" }).waitFor();
const homeCards = await page.locator(".restaurant-card").count();
if (homeCards < 4) throw new Error(`Expected at least 4 home restaurant cards, found ${homeCards}.`);
const totals = await page.evaluate(() => ({
  restaurants: window.__halifaxRestaurantCount ?? 0,
  officialSignals: window.__halifaxOfficialSignalCount ?? 0,
  discoveredRestaurants: window.__halifaxDiscoveredRestaurantCount ?? 0,
  socialProfiles: window.__halifaxFirstPartySocialProfileCount ?? 0,
  relatedLinks: window.__halifaxFirstPartyRelatedLinkCount ?? 0,
  socialRestaurants: window.__halifaxSocialLinkedRestaurantCount ?? 0,
  reservationRestaurants: window.__halifaxReservationLinkedRestaurantCount ?? 0,
  orderingRestaurants: window.__halifaxOrderingLinkedRestaurantCount ?? 0,
  cityEvents: window.HALIFAX_CITY_EVENTS?.eventCount ?? 0
}));
if (totals.restaurants < 700 || totals.officialSignals < 100) throw new Error(`Expected preserved discovery data, got ${JSON.stringify(totals)}.`);
if (totals.discoveredRestaurants < 1) throw new Error(`Expected reviewed local discovery records, got ${JSON.stringify(totals)}.`);
if (totals.socialProfiles < 100 || totals.relatedLinks < 100 || totals.socialRestaurants < 50) throw new Error(`Expected expanded first-party link coverage, got ${JSON.stringify(totals)}.`);
await page.screenshot({ path: resolve("artifacts", "ui-check-desktop.png"), fullPage: true });

// New-opening discovery must be searchable without weakening the established catalogue checks.
await page.locator("#globalSearch").fill("Sakaba");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
await page.locator(".restaurant-card", { hasText: "Sakaba" }).first().waitFor();

for (const name of ["Darty Brewing Co.", "Maria's Pantry"]) {
  await page.locator("#globalSearch").fill(name);
  await page.locator("#globalSearch").press("Enter");
  await page.waitForURL(/#explore/);
  const card = page.locator(".restaurant-card", { hasText: name }).first();
  await card.waitFor();
  if (await card.locator(".card-social a").count() < 2) throw new Error(`Expected verified Facebook and Instagram links for ${name}.`);
  const href = await card.locator('h3 a[href^="#restaurant/"]').getAttribute("href");
  await page.goto(`${url}/${href}`, { waitUntil: "networkidle" });
  if (await page.locator("#detailLinks .source-link-row").count() < 2) throw new Error(`Expected source-backed social detail links for ${name}.`);
  if (!/\d/.test(await page.locator("#detailInfo").innerText())) throw new Error(`Expected verified consumer facts for ${name}.`);
}

await page.locator("#globalSearch").fill("Dartmouth");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
await page.locator(".restaurant-card").first().waitFor();
const exploreCards = await page.locator(".restaurant-card").count();
if (exploreCards < 1 || exploreCards > 12) throw new Error(`Expected paginated explore results, found ${exploreCards}.`);

// First-party social, booking, and ordering links should be real Explore filters, not display-only metadata.
for (const feature of ["social", "reservations", "ordering"]) {
  await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
  await page.locator("#featureFilter").selectOption(feature);
  await page.locator("[data-filter-apply]").click();
  await page.locator(".restaurant-card").first().waitFor();
  const count = await page.locator(".restaurant-card").count();
  if (count < 1) throw new Error(`Expected Explore results for ${feature} feature filter.`);
}

await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
await page.locator("#featureFilter").selectOption("social");
await page.locator("[data-filter-apply]").click();
const socialDetailHref = await page.locator('.restaurant-card h3 a[href^="#restaurant/"]').first().getAttribute("href");
if (!socialDetailHref) throw new Error("Expected a restaurant detail route from the social filter.");
await page.goto(`${url}/${socialDetailHref}`, { waitUntil: "networkidle" });
await page.locator("#detailLinks").waitFor();
if (await page.locator("#detailLinks .source-link-row").count() < 1) throw new Error("Expected official social or related links on a social-linked restaurant detail page.");

// Event discovery: every filter must change actual result state, not just visual controls.
await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
await page.locator(".event-filter-panel").waitFor();
const eventState = await page.evaluate(() => ({
  loaded: window.HALIFAX_CITY_EVENTS?.eventCount ?? 0,
  rendered: document.querySelectorAll(".event-card").length,
  filters: document.querySelectorAll("[data-event-category]").length,
  windows: document.querySelectorAll("[data-event-window]").length,
  selects: document.querySelectorAll(".event-filter-grid select").length,
  matched: window.__halifaxEventFilterState?.matched ?? 0,
  mobileEventsNav: Boolean(document.querySelector('.mobile-tabbar [data-route-link="events"]'))
}));
if (eventState.loaded > 0) {
  if (eventState.rendered < 1 || eventState.rendered > 24) throw new Error(`Expected paginated city event cards (1-24), got ${JSON.stringify(eventState)}.`);
  if (eventState.filters < 2 || eventState.windows < 6 || eventState.selects < 6) throw new Error(`Expected expanded category/date/advanced event controls, got ${JSON.stringify(eventState)}.`);
  if (!eventState.mobileEventsNav) throw new Error("Expected Events in the mobile primary navigation.");

  const categoryButton = page.locator('[data-event-category]:not([data-event-category="All"])').first();
  const category = await categoryButton.getAttribute("data-event-category");
  if (!category) throw new Error("Expected at least one event category filter.");
  await categoryButton.click();
  await page.waitForFunction((value) => window.__halifaxEventFilterState?.category === value, category);
  const categoryCards = await page.locator(".event-card").evaluateAll((nodes, value) => nodes.map((node) => String(node.dataset.eventCategories || "").split("|").includes(value)), category);
  if (categoryCards.length && categoryCards.some((matches) => !matches)) throw new Error(`Category filter ${category} rendered a card outside that category.`);

  const categoryMatched = await page.evaluate(() => window.__halifaxEventFilterState?.matched ?? 0);
  await page.locator('[data-event-window="7"]').click();
  await page.waitForFunction(() => window.__halifaxEventFilterState?.windowDays === "7");
  const windowMatched = await page.evaluate(() => window.__halifaxEventFilterState?.matched ?? 0);
  if (windowMatched > categoryMatched) throw new Error(`7-day event window expanded results unexpectedly: category=${categoryMatched}, window=${windowMatched}.`);

  await page.locator("[data-event-clear]").click();
  await page.waitForFunction(() => window.__halifaxEventFilterState?.category === "All" && window.__halifaxEventFilterState?.windowDays === "all");

  const cityOptions = await page.locator("#eventCityFilter option").evaluateAll((options) => options.map((option) => option.value).filter((value) => value !== "all"));
  if (cityOptions.length) {
    const city = cityOptions[0];
    await page.locator("#eventCityFilter").selectOption(city);
    await page.waitForFunction((value) => window.__halifaxEventFilterState?.city === value, city);
    const cityCards = await page.locator(".event-card").evaluateAll((nodes, value) => nodes.map((node) => node.dataset.eventCity === value), city);
    if (cityCards.length && cityCards.some((matches) => !matches)) throw new Error(`Area filter ${city} rendered an event from another area.`);
  }

  await page.locator("[data-event-clear]").click();
  await page.locator("#eventCostFilter").selectOption("paid");
  await page.waitForFunction(() => window.__halifaxEventFilterState?.cost === "paid");
  const paidCards = await page.locator(".event-card").evaluateAll((nodes) => nodes.map((node) => node.dataset.eventCost));
  if (paidCards.length && paidCards.some((value) => value !== "paid")) throw new Error("Paid event filter rendered a non-paid event.");

  await page.locator("[data-event-clear]").click();
  const firstEventTitle = await page.locator(".event-card h3").first().innerText();
  await page.locator("#eventSearchInput").fill(firstEventTitle);
  await page.locator("[data-event-search-form]").press("Enter");
  await page.waitForFunction((value) => window.__halifaxEventFilterState?.query === value, firstEventTitle);
  if (await page.locator(".event-card").count() < 1) throw new Error("Exact event-title search returned no event cards.");

  // The global search becomes event-aware while the Events route is active.
  await page.locator("#globalSearch").fill(firstEventTitle);
  await page.locator("#globalSearch").press("Enter");
  await page.waitForFunction((value) => location.hash.startsWith("#events") && window.__halifaxEventFilterState?.query === value, firstEventTitle);
  if (!String(page.url()).includes("#events")) throw new Error("Global search navigated away from Events while searching event content.");

  await page.locator("[data-event-clear]").click();
  const firstSaveButton = page.locator("[data-save-event-id]").first();
  const savedEventId = await firstSaveButton.getAttribute("data-save-event-id");
  if (!savedEventId) throw new Error("Expected save controls on event cards.");
  await firstSaveButton.click();
  if (await firstSaveButton.getAttribute("aria-pressed") !== "true") throw new Error("Event save action did not update saved state.");
  await page.locator("#eventSavedFilter").check();
  await page.waitForFunction(() => window.__halifaxEventFilterState?.savedOnly === true);
  const savedCards = await page.locator(".event-card").evaluateAll((nodes, id) => nodes.map((node) => node.dataset.eventId === id), savedEventId);
  if (!savedCards.length || savedCards.some((matches) => !matches)) throw new Error("Saved-only event filter did not restrict results to the saved event.");

  await page.locator("[data-event-clear]").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-event-calendar]").first().click();
  const calendarDownload = await downloadPromise;
  if (!calendarDownload.suggestedFilename().endsWith(".ics")) throw new Error(`Expected .ics event calendar download, got ${calendarDownload.suggestedFilename()}.`);

  const loadMore = page.locator("[data-event-load-more]");
  if (await loadMore.count()) {
    const before = await page.locator(".event-card").count();
    await loadMore.click();
    const after = await page.locator(".event-card").count();
    if (after <= before) throw new Error(`Expected Load More to increase visible events, before=${before}, after=${after}.`);
  }
} else if (eventState.rendered < 1 || eventState.rendered > 24) {
  throw new Error(`Expected event-source fallback cards (1-24), got ${JSON.stringify(eventState)}.`);
}
await page.screenshot({ path: resolve("artifacts", "ui-check-events.png"), fullPage: true });

// Explore filters intentionally persist across routes. Reset test state before asserting a full-map population.
await page.evaluate(() => {
  state.query = "";
  state.cuisine = "all";
  state.neighbourhood = "all";
  state.feature = "all";
  state.page = 1;
  state.sort = "recommended";
});
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
await page.goto(`${url}/#restaurant/magnolia-halifax`, { waitUntil: "networkidle" });
const magnoliaSpecialState = await page.evaluate(() => {
  const restaurant = restaurants.find((item) => item.id === "magnolia-halifax");
  return { exists: Boolean(restaurant), structuredSpecials: restaurant?.structuredSpecials?.length || 0 };
});
if (!magnoliaSpecialState.exists || magnoliaSpecialState.structuredSpecials < 2) throw new Error(`Expected Magnolia discovery specials to resolve into the canonical model, got ${JSON.stringify(magnoliaSpecialState)}.`);
await page.goto(`${url}/#restaurant/osm-node-11751643550-cafe-lunette`, { waitUntil: "networkidle" });
await page.locator("#detailUpdates .official-update-card").first().waitFor();
if (await page.locator("#detailUpdates .official-update-card").count() < 3) throw new Error("Expected official Café Lunette feed updates on restaurant detail.");
await captureIphone("official-updates");
await page.goto(`${url}/#restaurant/osm-node-10038454787-bird-s-nest-cafe`, { waitUntil: "networkidle" });
const officialMedia = page.locator("#detailUpdates .official-update-media").first();
await officialMedia.waitFor();
await officialMedia.scrollIntoViewIfNeeded();
await page.waitForFunction(() => {
  const image = document.querySelector("#detailUpdates .official-update-media");
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
});
await page.locator(".toast").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
await page.screenshot({ path: resolve("artifacts", "ui-check-iphone-official-update-media.png"), fullPage: false });
await page.goto(`${url}/#restaurant/marias-pantry-dartmouth`, { waitUntil: "networkidle" });
await page.locator("#detailLinks .source-link-row").first().waitFor();
await captureIphone("dartmouth-new-place");
await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.waitForTimeout(150);
const mobileState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  bottomNavVisible: getComputedStyle(document.querySelector(".mobile-tabbar")).display !== "none",
  heroHeight: Math.round(document.querySelector(".home-hero")?.getBoundingClientRect().height || 0)
}));
if (mobileState.overflow > 2 || !mobileState.bottomNavVisible || mobileState.heroHeight < 500) throw new Error(`Expected polished mobile layout, got ${JSON.stringify(mobileState)}.`);
if (await page.locator(".source-coverage-strip").count() !== 1) throw new Error("Expected fresh source coverage on mobile Home.");
await captureIphone("home");

await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
const mobileFilterToggle = page.locator("[data-open-filters]");
await mobileFilterToggle.waitFor();
await mobileFilterToggle.click();
if (await mobileFilterToggle.getAttribute("aria-expanded") !== "true") throw new Error("Expected mobile filter drawer to open and expose expanded state.");
if (!(await page.locator("[data-filter-drawer]").evaluate((node) => node.classList.contains("is-open")))) throw new Error("Expected mobile filter drawer to be visible.");
await page.locator("#neighbourhoodFilter").selectOption("Dartmouth");
await page.locator("#featureFilter").selectOption("social");
await page.locator("[data-filter-apply]").click();
await page.locator(".restaurant-card").first().waitFor();
if (await page.locator(".restaurant-card").count() < 1) throw new Error("Expected Dartmouth results after applying mobile filters.");
if (await page.evaluate(() => document.body.classList.contains("filter-drawer-open"))) throw new Error("Expected mobile filter drawer to close after applying filters.");
await captureIphone("explore");

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
if (await page.locator("#detailLinks .source-link-row").count() < 1) throw new Error("Expected source-backed social links in the mobile detail evidence.");
await captureIphone("detail");

await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
await page.locator(".event-filter-panel").waitFor();
const mobileEventState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  filterGridWidth: Math.round(document.querySelector(".event-filter-grid")?.getBoundingClientRect().width || 0),
  viewport: document.documentElement.clientWidth,
  eventsNavActive: document.querySelector('.mobile-tabbar [data-route-link="events"]')?.classList.contains("is-active") || false
}));
if (mobileEventState.overflow > 2 || mobileEventState.filterGridWidth > mobileEventState.viewport || !mobileEventState.eventsNavActive) throw new Error(`Expected usable mobile event discovery, got ${JSON.stringify(mobileEventState)}.`);
await captureIphone("events");

for (const routeName of ["specials", "map"]) {
  await page.goto(`${url}/#${routeName}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(routeName === "map" ? 1200 : 150);
  const routeState = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  if (routeState.overflow > 2) throw new Error(`Expected ${routeName} to fit the iPhone viewport, got ${JSON.stringify(routeState)}.`);
  await captureIphone(routeName);
}

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.screenshot({ path: resolve("artifacts", "ui-check-mobile.png"), fullPage: true });

if (consoleErrors.length) throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
await browser.close();
console.log("Halifax Sourced UI verified: discovery, social links, booking/ordering, functional event filters, event search, saved events, calendar export, map/list sync, desktop, and mobile navigation.");
