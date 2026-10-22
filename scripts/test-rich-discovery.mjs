import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { installOfflineResources } from "./lib/offline-browser-resources.mjs";

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
if (!playwright?.chromium) throw new Error("Playwright is required for this regression test. Set PLAYWRIGHT_MODULE if it is installed outside node_modules.");
const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean).find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const resources = await installOfflineResources(context, url);
const page = await context.newPage();
const errors = [];
const responseFailures = [];
page.on("pageerror", (error) => errors.push(error.stack || error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", (response) => { if (response.status() >= 400) responseFailures.push(`${response.status()} ${response.url()}`); });
page.on("requestfailed", (request) => responseFailures.push(`FAILED ${request.url()} ${request.failure()?.errorText || "unknown"}`));
await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
await page.waitForFunction(() => (
  document.readyState === "complete" &&
  window.__halifaxStructuredPlaceFactCount > 0 &&
  window.__halifaxStructuredSpecialCount > 0 &&
  typeof mergeActionLinks === "function" &&
  typeof searchableText === "function" &&
  typeof homeRichSections === "function"
), null, { timeout: 10_000 });
const state = await page.evaluate(() => {
  const structuredRestaurant = restaurants.find((restaurant) => restaurant.structuredFacts && (restaurant.structuredFeatures || []).length);
  const specialRestaurant = restaurants.find((restaurant) => (restaurant.structuredSpecials || []).length);
  const richMarkup = typeof homeRichSections === "function" ? homeRichSections() : null;
  const featureSearch = structuredRestaurant ? searchableText(structuredRestaurant) : "";
  const featureTerm = structuredRestaurant?.structuredFeatures?.[0]?.feature?.replaceAll("_", " ") || null;
  const seaSmokeRestaurant = restaurants.find((restaurant) => normalize(restaurant.name) === normalize("Sea Smoke"));
  const seaSmokeNoSpaceSearch = filteredRestaurants({ query: "seasmoke" }).some((restaurant) => normalize(restaurant.name) === normalize("Sea Smoke"));
  return {
    readyState: document.readyState,
    structuredFactCount: window.__halifaxStructuredPlaceFactCount ?? null,
    structuredHoursCount: window.__halifaxStructuredHoursCount ?? null,
    structuredSpecialCount: window.__halifaxStructuredSpecialCount ?? null,
    verifiedSpecialCount: window.__halifaxVerifiedCurrentSpecialCount ?? null,
    rawStructuredPayloadCount: Array.isArray(window.HALIFAX_STRUCTURED_PLACE_FACTS?.records) ? window.HALIFAX_STRUCTURED_PLACE_FACTS.records.length : null,
    rawSpecialPayloadCount: Array.isArray(window.HALIFAX_STRUCTURED_SPECIALS?.records) ? window.HALIFAX_STRUCTURED_SPECIALS.records.length : null,
    hasStructuredRestaurant: Boolean(structuredRestaurant),
    featureTerm,
    featureIndexed: featureTerm ? featureSearch.includes(featureTerm.toLowerCase()) : false,
    seaSmokeNoSpaceSearch,
    seaSmokeSourceBacked: Boolean(seaSmokeRestaurant?.hasMenu && seaSmokeRestaurant?.hasReservation && seaSmokeRestaurant?.hasSocial && seaSmokeRestaurant?.hasPatio && seaSmokeRestaurant?.phone && seaSmokeRestaurant?.openingHours),
    hasSpecialRestaurant: Boolean(specialRestaurant),
    socialLinkedRestaurantCount: restaurants.filter((restaurant) => (restaurant.socialProfiles || []).some((profile) => safeUrl(profile.url))).length,
    socialCardLinkCount: document.querySelectorAll(".restaurant-card .card-social a").length,
    specialIndexed: specialRestaurant ? searchableText(specialRestaurant).includes(String(specialRestaurant.structuredSpecials[0].title || "").toLowerCase()) : true,
    richFunctionLoaded: typeof homeRichSections === "function",
    richMarkupLength: typeof richMarkup === "string" ? richMarkup.length : -1,
    currentHoursStates: restaurants.reduce((acc, restaurant) => { const key = restaurant.currentHoursState?.state || "missing"; acc[key] = (acc[key] || 0) + 1; return acc; }, {}),
    scriptSrcs: [...document.scripts].map((script) => script.src).filter((src) => /structured|place-facts|rich-(?:search|home)/.test(src)),
    adapters: {
      hoursState: typeof restaurantHoursState,
      mergeActionLinks: typeof mergeActionLinks,
      searchableText: typeof searchableText,
      richHome: typeof homeRichSections
    }
  };
});
// The photo section promises approval, not an unrecorded addition date. Keep
// its existing cards and selection stable at desktop and narrow mobile widths.
const photoSelections = [];
for (const width of [1440, 390, 320]) {
  await page.setViewportSize({ width, height: 1000 });
  const photos = await page.evaluate(() => {
    const section = [...document.querySelectorAll(".home-action-section")]
      .find(node => node.querySelector(".eyebrow")?.textContent === "Approved restaurant photos");
    const selected = approvedThumbnailRestaurants(4).map(restaurant => restaurant.id);
    return { selected, heading: section?.querySelector("h2")?.textContent,
      cards: section?.querySelectorAll(".restaurant-card").length || 0,
      links: section ? [...section.querySelectorAll(".restaurant-card h3 a")].map(link => link.getAttribute("href")) : [],
      obsoleteLabel: document.body.textContent.includes("New thumbnails added"),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert(!photos.obsoleteLabel);
  assert(!photos.horizontalOverflow, `Photo section must preserve the ${width}px mobile layout.`);
  if (photos.selected.length) {
    assert.equal(photos.heading, "Restaurants with approved images");
    assert.equal(photos.cards, photos.selected.length);
    assert.deepEqual(photos.links, photos.selected.map(id => `#restaurant/${encodeURIComponent(id)}`));
  }
  photoSelections.push(photos.selected);
}
assert.deepEqual(photoSelections[1], photoSelections[0]);
assert.deepEqual(photoSelections[2], photoSelections[0]);
resources.assertClean();
if (errors.length) throw new Error(`Rich discovery emitted browser errors:\n${errors.join("\n")}`);
if (responseFailures.length) throw new Error(`Rich discovery resource failures:\n${responseFailures.join("\n")}\nSTATE=${JSON.stringify(state)}`);
if (state.readyState !== "complete") throw new Error(`Application never reached complete ready state: ${JSON.stringify(state)}`);
if (!(state.structuredFactCount > 0)) throw new Error(`Structured facts not loaded: ${JSON.stringify(state)}`);
if (!(state.structuredSpecialCount > 0)) throw new Error(`Structured specials not loaded: ${JSON.stringify(state)}`);
if (!state.hasStructuredRestaurant || !state.featureIndexed) throw new Error(`Structured features are not searchable: ${JSON.stringify(state)}`);
if (!state.seaSmokeNoSpaceSearch || !state.seaSmokeSourceBacked) throw new Error(`Sea Smoke is not searchable/source-backed: ${JSON.stringify(state)}`);
if (!state.hasSpecialRestaurant || !state.specialIndexed) throw new Error(`Structured specials are not searchable: ${JSON.stringify(state)}`);
if (!(state.socialLinkedRestaurantCount > 0) || !(state.socialCardLinkCount > 0)) throw new Error(`Social profiles are not visible on restaurant cards: ${JSON.stringify(state)}`);
if (!state.richFunctionLoaded || state.richMarkupLength < 0) throw new Error(`Rich home renderer not loaded: ${JSON.stringify(state)}`);
console.log(JSON.stringify(state, null, 2));
console.log("Rich discovery regression passed: structured facts, specials, expanded search, and conditional home enrichment are loaded after explicit application readiness without browser errors.");
await browser.close();
