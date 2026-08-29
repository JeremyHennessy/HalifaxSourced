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
  structuredSpecials: window.__halifaxStructuredSpecialCount ?? 0,
  verifiedCurrentSpecials: window.__halifaxVerifiedCurrentSpecialCount ?? 0,
  cityEvents: window.HALIFAX_CITY_EVENTS?.eventCount ?? 0
}));
if (totals.restaurants < 700 || totals.officialSignals < 100) throw new Error(`Expected preserved discovery data, got ${JSON.stringify(totals)}.`);
if (totals.discoveredRestaurants < 1) throw new Error(`Expected reviewed local discovery records, got ${JSON.stringify(totals)}.`);
if (totals.socialProfiles < 100 || totals.relatedLinks < 100 || totals.socialRestaurants < 50) throw new Error(`Expected expanded first-party link coverage, got ${JSON.stringify(totals)}.`);
if (totals.structuredSpecials < 60 || totals.verifiedCurrentSpecials < 40) throw new Error(`Expected reviewed structured specials, got ${JSON.stringify(totals)}.`);
await page.screenshot({ path: resolve("artifacts", "ui-check-desktop.png"), fullPage: true });

// Lifecycle regression: inactive places must fail closed in discovery but keep a
// transparent historical detail page. Location-specific closures must not spill
// onto a currently operating location from the same brand.
await page.locator("#globalSearch").fill("Field Guide");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
if (await page.locator('.restaurant-card[data-restaurant-id="field-guide"]').count()) throw new Error("Permanently closed Field Guide appeared in current Explore results.");
await page.goto(`${url}/#restaurant/field-guide`, { waitUntil: "networkidle" });
await page.locator(".closure-notice", { hasText: "Permanently closed" }).waitFor();
if (!(await page.locator(".closure-notice").innerText()).includes("April 29, 2026")) throw new Error("Field Guide closure date is missing from the historical detail route.");
if (await page.locator(".detail-official-actions").count()) throw new Error("Closed Field Guide rendered current website/menu/reservation/order actions.");
if (await page.locator('.closure-notice a[href*="facebook.com/fieldguidehfx"]').count() !== 1) throw new Error("Field Guide official closure evidence is missing.");
await page.screenshot({ path: resolve("artifacts", "ui-check-closed-detail.png"), fullPage: true });
await page.goto(`${url}/#restaurant/2-doors-down`, { waitUntil: "networkidle" });
await page.locator("h1", { hasText: "2 Doors Down" }).waitFor();
if (await page.locator(".closure-notice").count()) throw new Error("The active Dartmouth 2 Doors Down location inherited the former Halifax closure.");
if (!(await page.locator("#detailInfo").innerText()).includes("149 Hector Gate")) throw new Error("The active Dartmouth 2 Doors Down location evidence is missing.");

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

for (const target of [
  { id: "canteen-on-portland-dartmouth", name: "The Canteen on Portland", action: "Menu" },
  { id: "oxalis-dartmouth", name: "Oxalis Restaurant", action: "Menu" },
  { id: "side-hustle-snack-bar-dartmouth", name: "Side Hustle Snack Bar", action: "Menu", special: "Weekday Happy Hour" },
  { id: "lake-city-cider-dartmouth", name: "Lake City Cider", action: "Order online", special: "$5 Taproom Happy Hour" }
]) {
  await page.goto(`${url}/#restaurant/${target.id}`, { waitUntil: "networkidle" });
  await page.locator("h1", { hasText: target.name }).waitFor();
  if (await page.locator("#detailLinks .detail-subheading", { hasText: "Official social profiles" }).count() !== 1) throw new Error(`Expected official social profiles for ${target.name}.`);
  if (await page.locator("#detailLinks .source-link-row").count() < 2) throw new Error(`Expected source-backed social and related links for ${target.name}.`);
  if ((await page.locator("#detailInfo").innerText()).includes("Hours not available")) throw new Error(`Expected verified hours for ${target.name}.`);
  if (await page.locator("#detailInfo .sidebar-link", { hasText: target.action }).count() < 1) throw new Error(`Expected ${target.action} action for ${target.name}.`);
  if (target.special && await page.locator("#detailSpecials", { hasText: target.special }).count() !== 1) throw new Error(`Expected verified special for ${target.name}.`);
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

await page.goto(`${url}/#specials`, { waitUntil: "networkidle" });
const desktopSpecialsState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  rawUrlHeadings: [...document.querySelectorAll(".special-card h2")].filter((heading) => /^https?:\/\//i.test(heading.textContent.trim())).length
}));
if (desktopSpecialsState.overflow > 2 || desktopSpecialsState.rawUrlHeadings > 0) throw new Error(`Expected polished desktop specials cards, got ${JSON.stringify(desktopSpecialsState)}.`);

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
await page.goto(`${url}/#restaurant/osm-node-7139174640-kajohn-thai`, { waitUntil: "networkidle" });
if (await page.locator("#detailUpdates .official-update-card").count() !== 2) throw new Error("Expected two reviewed Kajohn Thai official updates.");
if (await page.locator("#detailUpdates .official-update-media").count() !== 2) throw new Error("Expected retained media on both reviewed Kajohn Thai updates.");
const kajohnMedia = page.locator("#detailUpdates .official-update-media").first();
await kajohnMedia.scrollIntoViewIfNeeded();
await page.waitForFunction(() => {
  const image = document.querySelector("#detailUpdates .official-update-media");
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
});
await page.locator(".toast").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
await page.screenshot({ path: resolve("artifacts", "ui-check-iphone-kajohn-updates.png"), fullPage: false });
await page.goto(`${url}/#restaurant/lake-city-cider-dartmouth`, { waitUntil: "networkidle" });
await page.locator("#detailLinks .source-link-row").first().waitFor();
const dartmouthResolutionState = await page.evaluate(() => {
  const restaurant = restaurants.find((item) => item.id === "lake-city-cider-dartmouth");
  return {
    address: restaurant?.address || "",
    neighborhood: restaurant?.neighborhood || "",
    website: restaurant?.website || "",
    reviewState: restaurant?.reviewedPlaceResolution?.reviewState || ""
  };
});
if (!/35 Portland Street/i.test(dartmouthResolutionState.address) || dartmouthResolutionState.neighborhood !== "Downtown Dartmouth" || !/lakecitycider\.ca/.test(dartmouthResolutionState.website) || dartmouthResolutionState.reviewState !== "resolved-by-evidence") throw new Error(`Expected the reviewed Downtown Dartmouth overlay in the rendered restaurant model, got ${JSON.stringify(dartmouthResolutionState)}.`);
await captureIphone("dartmouth-new-place");

await page.goto(`${url}/#restaurant/osm-node-4420843802-le-bistro-by-liz`, { waitUntil: "networkidle" });
await page.locator("h1", { hasText: "Le Bistro by Liz" }).waitFor();
const springGardenResolutionState = await page.evaluate(() => {
  const restaurant = restaurants.find((item) => item.id === "osm-node-4420843802-le-bistro-by-liz");
  return {
    address: restaurant?.address || "",
    neighborhood: restaurant?.neighborhood || "",
    phone: restaurant?.phone || "",
    hours: restaurant?.openingHours || "",
    menuUrl: restaurant?.reviewedPlaceResolution?.menuUrl || "",
    reviewState: restaurant?.reviewedPlaceResolution?.reviewState || ""
  };
});
if (!/1333 South Park Street/i.test(springGardenResolutionState.address) || springGardenResolutionState.neighborhood !== "Spring Garden" || springGardenResolutionState.phone.replace(/\D/g, "").slice(-10) !== "9024238428" || !/Monday/i.test(springGardenResolutionState.hours) || !/lebistrohalifax\.com\/menus/.test(springGardenResolutionState.menuUrl) || springGardenResolutionState.reviewState !== "resolved-by-evidence") throw new Error(`Expected the reviewed Spring Garden overlay in the rendered restaurant model, got ${JSON.stringify(springGardenResolutionState)}.`);
if (await page.locator("#detailInfo .sidebar-link", { hasText: "Menu" }).count() < 1) throw new Error("Expected the official Le Bistro menu action on the reviewed Spring Garden detail page.");
await captureIphone("spring-garden-reviewed");

for (const target of [
  { id: "osm-node-13262595504-mappatura-bistro", title: "Mappatura Bistro", address: "5883 Spring Garden", menu: "mappaturabistro.ca/menu", socialProfiles: 2 },
  { id: "osm-node-26041177-your-father-s-moustache", title: "Your Father's Moustache", address: "5686 Spring Garden", menu: "yourfathersmoustache.ca/our-menu" },
  { id: "osm-node-5161526522-sushi-nami-royale", title: "Sushi Nami Royale", address: "1458 Queen", menu: "sushinami.ca/downtown-halifax", socialProfiles: 3 },
  { id: "osm-node-3791840157-krave-burger", title: "Krave Burger", address: "5680 Spring Garden", menu: "kraveburger.com/menu" },
  { id: "osm-node-3799422457-cora", title: "Cora", address: "1535 Dresden", menu: "chezcora.com/en/menu" }
]) {
  await page.goto(`${url}/#restaurant/${target.id}`, { waitUntil: "networkidle" });
  await page.locator("h1", { hasText: target.title }).waitFor();
  const state = await page.evaluate((restaurantId) => {
    const restaurant = restaurants.find((item) => item.id === restaurantId);
    return {
      neighborhood: restaurant?.neighborhood || "",
      resolution: restaurant?.reviewedPlaceResolution || null
    };
  }, target.id);
  if (state.neighborhood !== "Spring Garden" || state.resolution?.reviewState !== "resolved-by-evidence" || !state.resolution.address?.includes(target.address) || !state.resolution.menuUrl?.includes(target.menu)) throw new Error(`Expected location-specific Spring Garden evidence for ${target.title}, got ${JSON.stringify(state)}.`);
  if (await page.locator("#detailInfo .sidebar-link", { hasText: "Menu" }).count() < 1) throw new Error(`Expected the official Menu action for ${target.title}.`);
  if (target.socialProfiles && (state.resolution.socialProfiles?.length || 0) < target.socialProfiles) throw new Error(`Expected ${target.socialProfiles} official-site-linked social profiles for ${target.title}.`);
  if (target.id === "osm-node-13262595504-mappatura-bistro") {
    const mobileActionClearance = await page.evaluate(() => {
      const actions = document.querySelector(".mobile-essential-actions")?.getBoundingClientRect();
      const tabbar = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
      return actions && tabbar ? Math.round(tabbar.top - actions.bottom) : null;
    });
    if (mobileActionClearance === null || mobileActionClearance < 8) throw new Error(`Expected at least 8px between dense mobile restaurant actions and the fixed tab bar, got ${mobileActionClearance}px.`);
    await captureIphone("spring-garden-batch-2");
  }
}

await page.goto(`${url}/#restaurant/the-narrows`, { waitUntil: "networkidle" });
await page.locator(".restaurant-hero-photo").waitFor();
await page.waitForFunction(() => {
  const image = document.querySelector(".restaurant-hero-photo");
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
});
const attributionState = await page.evaluate(() => ({
  label: document.querySelector(".media-attribution")?.textContent || "",
  href: document.querySelector(".media-attribution")?.getAttribute("href") || "",
  target: document.querySelector(".media-attribution")?.getAttribute("target") || ""
}));
if (!/CC BY-SA|Wikimedia Commons/i.test(attributionState.label) || !/commons\.wikimedia\.org/.test(attributionState.href) || attributionState.target !== "_blank") throw new Error(`Expected visible, safely linked licensed-image attribution, got ${JSON.stringify(attributionState)}.`);
await captureIphone("licensed-attribution");

const brokenImageErrorStart = consoleErrors.length;
await page.evaluate(() => {
  const image = window.HALIFAX_RESTAURANT_MEDIA.records.find((record) => record.restaurantId === "the-narrows");
  image.__qaOriginalUrl = image.url;
  image.url = "./assets/restaurants/qa-intentionally-missing.jpg";
  renderRestaurantDetail("the-narrows");
});
await page.waitForFunction(() => !document.querySelector(".restaurant-hero-photo") && !document.querySelector(".restaurant-hero")?.classList.contains("has-permitted-image"));
const brokenImageErrors = consoleErrors.splice(brokenImageErrorStart);
if (brokenImageErrors.length !== 1 || !/404 \(Not Found\)/.test(brokenImageErrors[0])) throw new Error(`Expected exactly one intentional missing-image 404, got ${JSON.stringify(brokenImageErrors)}.`);
await captureIphone("broken-image-fallback");
await page.evaluate(() => {
  const image = window.HALIFAX_RESTAURANT_MEDIA.records.find((record) => record.restaurantId === "the-narrows");
  image.url = image.__qaOriginalUrl;
  delete image.__qaOriginalUrl;
});

await page.goto(`${url}/#restaurant/field-guide`, { waitUntil: "networkidle" });
await page.locator(".closure-notice", { hasText: "Permanently closed" }).waitFor();
const closedState = await page.evaluate(() => ({
  badge: document.querySelector(".title-badges")?.textContent || "",
  notice: document.querySelector(".closure-notice")?.textContent || "",
  actionText: document.querySelector(".mobile-essential-actions")?.textContent || "",
  visibleActionLabels: [...document.querySelectorAll(".mobile-essential-actions a,.mobile-essential-actions button")].filter((node) => { const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden"; }).map((node) => node.textContent.trim())
}));
if (!/Permanently closed/i.test(closedState.badge) || !/April 29, 2026/.test(closedState.notice) || /menu|order|reserv/i.test(closedState.actionText)) throw new Error(`Expected an archived Field Guide detail without current commerce actions, got ${JSON.stringify(closedState)}.`);
if (new Set(closedState.visibleActionLabels).size !== closedState.visibleActionLabels.length) throw new Error(`Duplicate visible mobile actions found on closed detail: ${JSON.stringify(closedState.visibleActionLabels)}.`);
await captureIphone("closed-field-guide");
await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
await page.locator("#globalSearch").fill("Field Guide");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
await page.locator(".results-area").waitFor();
if (await page.locator(".restaurant-card", { hasText: "Field Guide" }).count()) throw new Error("Closed Field Guide leaked into active discovery results.");

await page.goto(`${url}/#restaurant/highwayman`, { waitUntil: "networkidle" });
await page.locator("h1", { hasText: "Highwayman" }).waitFor();
await page.evaluate(() => {
  const restaurant = restaurants.find((item) => item.id === "highwayman");
  const inactiveArrayFields = ["menuLinks", "reservationLinks", "orderingLinks", "specialLinks", "eventLinks", "relatedLinks", "structuredSpecials", "currentVerifiedSpecials", "structuredEvents", "officialUpdates", "specials", "events"];
  const inactiveBooleanFields = ["hasMenu", "hasSpecial", "hasEvent", "hasOpening", "hasReservation", "hasOrdering"];
  restaurant.__qaOriginalOperatingStatus = restaurant.operatingStatus;
  restaurant.__qaOriginalOperatingStatusEvidence = restaurant.operatingStatusEvidence;
  restaurant.__qaOriginalClosureDate = restaurant.closureDate;
  restaurant.__qaOriginalInactiveFields = Object.fromEntries([...inactiveArrayFields, ...inactiveBooleanFields].map((key) => [key, restaurant[key]]));
  restaurant.operatingStatus = "moved";
  restaurant.closureDate = "2026-08-01";
  restaurant.operatingStatusEvidence = { sourceUrl: "https://www.highwaymanhfx.com/", claim: "QA fixture: moved to a new location." };
  for (const key of inactiveArrayFields) restaurant[key] = [];
  for (const key of inactiveBooleanFields) restaurant[key] = false;
  renderRestaurantDetail("highwayman");
});
await page.locator(".closure-notice", { hasText: "Moved" }).waitFor();
if (!/Moved/.test(await page.locator(".title-badges").innerText())) throw new Error("Moved lifecycle fixture did not render an archived status badge.");
if (await page.locator(".detail-official-actions").count() || await page.locator(".mobile-essential-actions").count()) throw new Error("Moved lifecycle fixture rendered current commerce actions.");
if (await page.locator("#detailLinks .detail-subheading", { hasText: "Restaurant links" }).count()) throw new Error("Moved lifecycle fixture rendered current related commerce links.");
await captureIphone("moved-restaurant");
await page.evaluate(() => {
  const restaurant = restaurants.find((item) => item.id === "highwayman");
  restaurant.operatingStatus = restaurant.__qaOriginalOperatingStatus;
  restaurant.operatingStatusEvidence = restaurant.__qaOriginalOperatingStatusEvidence;
  restaurant.closureDate = restaurant.__qaOriginalClosureDate;
  Object.assign(restaurant, restaurant.__qaOriginalInactiveFields);
  delete restaurant.__qaOriginalOperatingStatus;
  delete restaurant.__qaOriginalOperatingStatusEvidence;
  delete restaurant.__qaOriginalClosureDate;
  delete restaurant.__qaOriginalInactiveFields;
});
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
const mobileMore = page.locator("#mobileMore");
await mobileMore.click();
const moreState = await page.evaluate(() => ({
  expanded: document.querySelector("#mobileMore")?.getAttribute("aria-expanded"),
  open: document.querySelector("[data-mobile-more-sheet]")?.classList.contains("is-open"),
  destinations: [...document.querySelectorAll("[data-mobile-more-sheet] a")].map((link) => link.getAttribute("href"))
}));
if (moreState.expanded !== "true" || !moreState.open || !["#specials", "#menus", "#saved"].every((href) => moreState.destinations.includes(href))) throw new Error(`Expected complete mobile More navigation, got ${JSON.stringify(moreState)}.`);
await captureIphone("more-navigation");
await page.locator("[data-mobile-more-close]").click();
await page.locator("[data-mobile-more-sheet]").waitFor({ state: "hidden" });
const closedMoreState = await page.evaluate(() => ({
  expanded: document.querySelector("#mobileMore")?.getAttribute("aria-expanded"),
  open: document.querySelector("[data-mobile-more-sheet]")?.classList.contains("is-open"),
  visibility: getComputedStyle(document.querySelector("[data-mobile-more-sheet]")).visibility
}));
if (closedMoreState.expanded !== "false" || closedMoreState.open || closedMoreState.visibility !== "hidden") throw new Error(`Expected mobile More navigation to close completely, got ${JSON.stringify(closedMoreState)}.`);

await page.locator("#globalSearch").fill("Highwayman");
await page.locator("#globalSearch").press("Enter");
await page.waitForURL(/#explore/);
if (await page.locator(".restaurant-card", { hasText: "Highwayman" }).count() < 1) throw new Error("Expected mobile global search results for Highwayman.");
await captureIphone("search-results");
await page.locator("#globalSearch").fill("");
await page.locator("#globalSearch").press("Enter");

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
  overviewVisible: getComputedStyle(document.querySelector(".mobile-detail-overview")).display !== "none",
  actionCount: document.querySelectorAll(".mobile-essential-actions a,.mobile-essential-actions button").length,
  fixedActionBars: [...document.querySelectorAll(".mobile-detail-actions")].filter((node) => getComputedStyle(node).position === "fixed" && getComputedStyle(node).display !== "none").length,
  heroHeight: Math.round(document.querySelector(".restaurant-hero")?.getBoundingClientRect().height || 0),
  visibleActionLabels: [...document.querySelectorAll(".hero-actions a,.hero-actions button,.mobile-essential-actions a,.mobile-essential-actions button,.mobile-detail-actions a,.mobile-detail-actions button")].filter((node) => { const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0; }).map((node) => node.textContent.trim().replace(/\s+/g, " "))
}));
if (detailState.overflow > 2 || !detailState.overviewVisible || detailState.actionCount < 1 || detailState.fixedActionBars !== 0 || detailState.heroHeight > 390) throw new Error(`Expected usable mobile restaurant hierarchy without overlapping fixed actions, got ${JSON.stringify(detailState)}.`);
if (new Set(detailState.visibleActionLabels).size !== detailState.visibleActionLabels.length) throw new Error(`Duplicate visible mobile detail actions found: ${JSON.stringify(detailState.visibleActionLabels)}.`);
if (await page.locator("#detailLinks .source-link-row").count() < 1) throw new Error("Expected source-backed social links in the mobile detail evidence.");
await captureIphone("detail");

await page.goto(`${url}/#events`, { waitUntil: "networkidle" });
await page.locator(".event-filter-panel").waitFor({ state: "attached" });
const eventFilterOpen = page.locator("[data-event-filter-open]");
await eventFilterOpen.click();
if (await eventFilterOpen.getAttribute("aria-expanded") !== "true" || !(await page.locator("[data-event-filter-panel]").evaluate((node) => node.classList.contains("is-open")))) throw new Error("Expected mobile event filter drawer to open.");
await captureIphone("events-filter-drawer");
await page.locator("[data-event-filter-close]").last().click();
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

await page.goto(`${url}/#specials`, { waitUntil: "networkidle" });
const specialsState = await page.evaluate(() => ({
  verifiedSections: document.querySelectorAll(".special-card.is-verified").length,
  leadSections: document.querySelectorAll(".special-card.is-lead").length,
  visible: document.querySelectorAll(".special-card").length,
  controls: document.querySelectorAll("[data-specials-filter-form] input,[data-specials-filter-form] select").length
}));
if (specialsState.controls < 3 || specialsState.visible < 2 || specialsState.visible > 12 || specialsState.verifiedSections < 1 || specialsState.leadSections < 1) throw new Error(`Expected separated, paginated mobile specials discovery, got ${JSON.stringify(specialsState)}.`);
await page.locator("#specialsKind").selectOption("leads");
await page.locator("[data-specials-filter-form] .button.primary").click();
if (await page.locator(".special-card.is-verified").count()) throw new Error("Official-source lead filter rendered verified-special cards.");

await page.goto(`${url}/#menus`, { waitUntil: "networkidle" });
const menuState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  visible: document.querySelectorAll(".restaurant-card").length,
  controls: document.querySelectorAll("[data-menu-search] input,[data-menu-search] select").length,
  loadMore: Boolean(document.querySelector("[data-menus-more]"))
}));
if (menuState.overflow > 2 || menuState.controls < 3 || menuState.visible < 1 || menuState.visible > 18 || !menuState.loadMore) throw new Error(`Expected filtered, paginated mobile menus, got ${JSON.stringify(menuState)}.`);
await captureIphone("menus");
const menuFirstName = await page.locator(".restaurant-card h3").first().innerText();
await page.locator("[data-menu-search] input").fill(menuFirstName);
await page.locator("[data-menu-search]").press("Enter");
if (await page.locator(".restaurant-card").count() < 1) throw new Error("Exact mobile menu search returned no results.");
await captureIphone("menu-search");

await page.goto(`${url}/#saved`, { waitUntil: "networkidle" });
if (await page.locator(".empty-state").count() !== 1) throw new Error("Expected mobile Saved empty state before saving a place.");
await captureIphone("saved-empty");
await page.goto(`${url}/#explore`, { waitUntil: "networkidle" });
const saveForQa = page.locator("[data-save-id]").first();
await saveForQa.click();
await page.goto(`${url}/#saved`, { waitUntil: "networkidle" });
if (await page.locator(".restaurant-card").count() !== 1) throw new Error("Expected one populated Saved card after saving from Explore.");
await captureIphone("saved-populated");

await page.goto(`${url}/#map`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const mapModeState = await page.evaluate(() => ({ buttons: document.querySelectorAll("[data-map-mode]").length, mapVisible: getComputedStyle(document.querySelector("#mainMap")).display !== "none" }));
if (mapModeState.buttons !== 2 || !mapModeState.mapVisible) throw new Error(`Expected explicit mobile Map/List modes, got ${JSON.stringify(mapModeState)}.`);
await page.locator('[data-map-mode="list"]').click();
if (!(await page.locator(".map-split").evaluate((node) => node.classList.contains("mode-list")))) throw new Error("Mobile map did not switch to List mode.");
await captureIphone("map-list");

await page.setViewportSize({ width: 390, height: 667 });
await page.goto(`${url}/#restaurant/field-guide`, { waitUntil: "networkidle" });
const shortPhoneState = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  heroHeight: Math.round(document.querySelector(".restaurant-hero")?.getBoundingClientRect().height || 0),
  tabbarBottom: Math.round(document.querySelector(".mobile-tabbar")?.getBoundingClientRect().bottom || 0),
  viewportHeight: window.innerHeight,
  fixedDetailActions: [...document.querySelectorAll(".mobile-detail-actions")].some((node) => getComputedStyle(node).display !== "none")
}));
if (shortPhoneState.overflow > 2 || shortPhoneState.heroHeight > 320 || Math.abs(shortPhoneState.tabbarBottom - shortPhoneState.viewportHeight) > 2 || shortPhoneState.fixedDetailActions) throw new Error(`Expected usable short-height iPhone layout, got ${JSON.stringify(shortPhoneState)}.`);
await captureIphone("short-height-detail");
await page.setViewportSize({ width: 390, height: 844 });

const externalTargetState = await page.evaluate(() => ({
  external: [...document.querySelectorAll('main a[href^="http"]')].length,
  unsafeTargets: [...document.querySelectorAll('main a[href^="http"]')].filter((link) => link.target !== "_blank" || !String(link.rel).includes("noreferrer")).length
}));
if (!externalTargetState.external || externalTargetState.unsafeTargets) throw new Error(`Expected safe external-link targets, got ${JSON.stringify(externalTargetState)}.`);

await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.screenshot({ path: resolve("artifacts", "ui-check-mobile.png"), fullPage: true });

if (consoleErrors.length) throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
await browser.close();
console.log("Halifax Sourced UI verified: discovery, social links, booking/ordering, functional event filters, event search, saved events, calendar export, map/list sync, desktop, and mobile navigation.");
