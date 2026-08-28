import { existsSync } from "node:fs";

let playwright;
try { playwright = await import("playwright"); } catch {}
if (!playwright?.chromium) throw new Error("Playwright is required for this regression test.");
const url = (process.env.APP_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/chromium"].filter(Boolean).find((path) => existsSync(path));
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const responseFailures = [];
page.on("pageerror", (error) => errors.push(error.stack || error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", (response) => { if (response.status() >= 400) responseFailures.push(`${response.status()} ${response.url()}`); });
page.on("requestfailed", (request) => responseFailures.push(`FAILED ${request.url()} ${request.failure()?.errorText || "unknown"}`));
await page.goto(`${url}/#home`, { waitUntil: "networkidle" });
const state = await page.evaluate(() => {
  const structuredRestaurant = restaurants.find((restaurant) => restaurant.structuredFacts && (restaurant.structuredFeatures || []).length);
  const specialRestaurant = restaurants.find((restaurant) => (restaurant.structuredSpecials || []).length);
  const richMarkup = typeof homeRichSections === "function" ? homeRichSections() : null;
  const featureSearch = structuredRestaurant ? searchableText(structuredRestaurant) : "";
  const featureTerm = structuredRestaurant?.structuredFeatures?.[0]?.feature?.replaceAll("_", " ") || null;
  return {
    structuredFactCount: window.__halifaxStructuredPlaceFactCount ?? null,
    structuredHoursCount: window.__halifaxStructuredHoursCount ?? null,
    structuredSpecialCount: window.__halifaxStructuredSpecialCount ?? null,
    verifiedSpecialCount: window.__halifaxVerifiedCurrentSpecialCount ?? null,
    rawStructuredPayloadCount: Array.isArray(window.HALIFAX_STRUCTURED_PLACE_FACTS?.records) ? window.HALIFAX_STRUCTURED_PLACE_FACTS.records.length : null,
    rawSpecialPayloadCount: Array.isArray(window.HALIFAX_STRUCTURED_SPECIALS?.records) ? window.HALIFAX_STRUCTURED_SPECIALS.records.length : null,
    hasStructuredRestaurant: Boolean(structuredRestaurant),
    featureTerm,
    featureIndexed: featureTerm ? featureSearch.includes(featureTerm.toLowerCase()) : false,
    hasSpecialRestaurant: Boolean(specialRestaurant),
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
if (errors.length) throw new Error(`Rich discovery emitted browser errors:\n${errors.join("\n")}`);
if (responseFailures.length) throw new Error(`Rich discovery resource failures:\n${responseFailures.join("\n")}\nSTATE=${JSON.stringify(state)}`);
if (!(state.structuredFactCount > 0)) throw new Error(`Structured facts not loaded: ${JSON.stringify(state)}`);
if (!(state.structuredSpecialCount > 0)) throw new Error(`Structured specials not loaded: ${JSON.stringify(state)}`);
if (!state.hasStructuredRestaurant || !state.featureIndexed) throw new Error(`Structured features are not searchable: ${JSON.stringify(state)}`);
if (!state.hasSpecialRestaurant || !state.specialIndexed) throw new Error(`Structured specials are not searchable: ${JSON.stringify(state)}`);
if (!state.richFunctionLoaded || state.richMarkupLength < 0) throw new Error(`Rich home renderer not loaded: ${JSON.stringify(state)}`);
console.log(JSON.stringify(state, null, 2));
console.log("Rich discovery regression passed: structured facts, specials, expanded search, and conditional home enrichment are loaded without browser errors.");
await browser.close();
