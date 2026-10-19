import { readFile } from "node:fs/promises";
import vm from "node:vm";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

async function loadWindowScript(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}

const reviewed = await loadWindowScript("data/reviewed-place-resolutions.js");
const resolutions = reviewed.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.records || [];
const sushi = resolutions.find((record) => record.restaurantId === "osm-node-11552061304-sushi-shige");
check(sushi?.operatingStatus === "permanently_closed", "Sushi Shige must be permanently closed.");
check(sushi?.closureDate === "2026-09-19", "Sushi Shige closure date must match the owner announcement.");
check(sushi?.operatingStatusEvidence?.sourceUrl === "https://www.shige.ca/post/with-millions-of-thanks", "Sushi Shige must retain the owner closure URL.");
check(/superseding the earlier temporary-break notice/i.test(sushi?.operatingStatusEvidence?.claim || ""), "Sushi Shige closure evidence must supersede the temporary break.");

const appCore = await readFile(new URL("../app-core.js", import.meta.url), "utf8");
check(appCore.includes("restaurant.closureDate = resolution.closureDate || restaurant.closureDate"), "The app must apply reviewed closure dates.");
check(appCore.includes("restaurant.operatingStatusEvidence = resolution.operatingStatusEvidence || restaurant.operatingStatusEvidence"), "The app must apply reviewed lifecycle evidence.");
const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
check(index.includes("reviewed-place-resolutions.js?v=20261019-lifecycle-corrections"), "Reviewed lifecycle corrections must invalidate the browser cache.");
check(index.includes("discovered-restaurants.js?v=20261019-location-corrections"), "Location corrections must invalidate the browser cache.");
check(index.includes("structured-specials.js?v=20261019-dated-offers"), "Dated-offer corrections must invalidate the browser cache.");

const discovery = JSON.parse(await readFile(new URL("../data/discovery-overrides.json", import.meta.url), "utf8"));
const heal = discovery.approved?.find((record) => record.id === "heal-wellness-bayers-lake");
const waaris = discovery.approved?.find((record) => record.id === "waaris-dartmouth");
check(heal?.address === "218 Chain Lake Drive, Halifax, NS" && heal?.website === "https://healwellness.ca/locations/" && heal?.openingStatus === "open", "HEAL Bayers Lake must use the official location identity.");
check(!heal?.coordinates, "HEAL coordinates must remain unset until authoritative coordinates are preserved.");
check(waaris?.address === "151 Hector Gate, Dartmouth, NS B3B 0E5" && waaris?.website === "https://www.thewaaris.com/" && waaris?.openingStatus === "open", "WAARIS must use its official Dartmouth identity.");
check(!waaris?.coordinates, "WAARIS coordinates must remain unset until authoritative coordinates are preserved.");

const specials = JSON.parse(await readFile(new URL("../data/reviewed-structured-specials.json", import.meta.url), "utf8")).records || [];
const teas = specials.filter((record) => record.restaurantId === "osm-node-11751560115-seaport-social" && /Afternoon Tea/.test(record.title));
const october = teas.find((record) => record.validTo === "2026-10-17");
const november = teas.find((record) => record.validFrom === "2026-11-14" && record.validTo === "2026-11-14");
check(teas.length === 2, "Seaport Social tea dates must be separate records.");
check(october?.title.includes("October 17"), "The expired October 17 tea must remain explicit historical evidence.");
check(november?.title.includes("November 14") && november?.price === 55 && november?.startTime === "14:00" && november?.endTime === "16:00", "The November 14 tea must retain its official date, price and time.");

const builtSpecials = JSON.parse(await readFile(new URL("../data/build/structured-specials.json", import.meta.url), "utf8")).records || [];
check(builtSpecials.find((record) => record.title === "Afternoon Tea — October 17")?.status === "expired", "The controlled build must classify the October 17 tea as expired.");
check(builtSpecials.find((record) => record.title === "Afternoon Tea — November 14")?.status === "source_lead", "The controlled build must keep the future November 14 tea out of current offers.");
const builtDiscovery = JSON.parse(await readFile(new URL("../data/build/discovered-restaurants.json", import.meta.url), "utf8")).restaurants || [];
check(builtDiscovery.some((record) => record.id === "heal-wellness-bayers-lake" && record.openingStatus === "open"), "The controlled discovery build must include HEAL Bayers Lake.");
check(builtDiscovery.some((record) => record.id === "waaris-dartmouth" && record.openingStatus === "open"), "The controlled discovery build must include WAARIS.");
const coverage = JSON.parse(await readFile(new URL("../data/build/content-coverage-report.json", import.meta.url), "utf8"));
check(coverage.restaurantCoverage?.archivedLifecyclePlaces === 2, "Canonical coverage must count both reviewed archived records.");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Data trust corrections: 22 assertions passed.");
