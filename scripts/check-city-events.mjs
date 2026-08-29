import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../data/city-events.js", import.meta.url), "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "data/city-events.js", timeout: 20000 });
const payload = context.window.HALIFAX_CITY_EVENTS || { events: [] };
const events = Array.isArray(payload.events) ? payload.events : [];
const failures = [];
const warnings = [];
const ALLOWED_CITIES = new Set(["halifax", "dartmouth", "bedford"]);
const REGIONAL_SOURCE_CITIES = new Map([
  ["alderney-landing-events", "dartmouth"],
  ["alderney-gate-library-events", "dartmouth"],
  ["woodlawn-library-events", "dartmouth"],
  ["bedford-library-events", "bedford"]
]);

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}
function validDate(value) { return Number.isFinite(Date.parse(String(value ?? ""))); }
function normalize(value) { return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ""); }
function canonicalCity(value) {
  const text = String(value ?? "").toLowerCase();
  if (/\bdartmouth\b/.test(text)) return "dartmouth";
  if (/\bbedford\b/.test(text)) return "bedford";
  if (/\bhalifax\b/.test(text)) return "halifax";
  return null;
}

const ids = new Set();
const keys = new Set();
for (const event of events) {
  if (!event.id || ids.has(event.id)) failures.push({ type: "duplicate_or_missing_event_id", id: event.id, title: event.title });
  ids.add(event.id);
  if (!event.title || !validDate(event.startAt) || !validDate(event.endAt || event.startAt) || !validUrl(event.sourceUrl) || !event.sourceId || !event.sourceName || !event.sourceKind || !event.observedAt) {
    failures.push({ type: "invalid_event_record", id: event.id, title: event.title });
  }
  if (!Array.isArray(event.categories) || !event.categories.length) failures.push({ type: "event_missing_categories", id: event.id, title: event.title });
  if (Object.hasOwn(event, "description") || Object.hasOwn(event, "body") || Object.hasOwn(event, "rawHtml") || Object.hasOwn(event, "content")) {
    failures.push({ type: "raw_event_body_retained", id: event.id, title: event.title });
  }

  const city = canonicalCity(event.city);
  if (!city || !ALLOWED_CITIES.has(city)) failures.push({ type: "event_outside_halifax_metro_city", id: event.id, title: event.title, city: event.city });
  if (event.sourceId === "tourism-ns-events") {
    const locationCity = canonicalCity(`${event.address || ""} ${event.venueName || ""}`);
    if (!locationCity) failures.push({ type: "province_wide_event_missing_local_location_evidence", id: event.id, title: event.title, address: event.address, venueName: event.venueName });
  }
  const expectedRegionalCity = REGIONAL_SOURCE_CITIES.get(event.sourceId);
  if (expectedRegionalCity && city !== expectedRegionalCity) failures.push({ type: "regional_event_wrong_municipality", id: event.id, sourceId: event.sourceId, expected: expectedRegionalCity, actual: city });
  if (expectedRegionalCity && (!Number.isFinite(Number(event.latitude)) || !Number.isFinite(Number(event.longitude)))) failures.push({ type: "regional_event_missing_coordinates", id: event.id, sourceId: event.sourceId });

  const key = `${normalize(event.title)}|${String(event.startAt).slice(0, 10)}|${normalize(event.venueName || event.address || "halifax")}`;
  if (keys.has(key)) warnings.push({ type: "possible_duplicate_event", id: event.id, title: event.title, key });
  keys.add(key);
}

if (!events.length) warnings.push({ type: "city_event_dataset_empty" });
if ((payload.failures || []).length) warnings.push({ type: "event_sources_failed", count: payload.failures.length });
const sports = events.filter((event) => event.categories?.includes("Sports")).length;
const music = events.filter((event) => event.categories?.includes("Music")).length;
const food = events.filter((event) => event.categories?.includes("Food & Drink")).length;
const festivals = events.filter((event) => event.categories?.includes("Festivals")).length;
const municipalityCounts = Object.fromEntries([...ALLOWED_CITIES].map((city) => [city, events.filter((event) => canonicalCity(event.city) === city).length]));
for (const stat of payload.sourceStats || []) {
  if (REGIONAL_SOURCE_CITIES.has(stat.sourceId) && stat.status === "ok" && Number(stat.eventCount) > 0 && !events.some((event) => event.sourceId === stat.sourceId)) failures.push({ type: "regional_source_events_missing_after_sanitize", sourceId: stat.sourceId, eventCount: stat.eventCount });
}
if (events.length && !sports) warnings.push({ type: "no_sports_events_detected" });
if (events.length && !music) warnings.push({ type: "no_music_events_detected" });
if (events.length && !food) warnings.push({ type: "no_food_events_detected" });
if (events.length < 25) warnings.push({ type: "low_city_event_coverage", count: events.length });
if (!payload.scopeAudit) warnings.push({ type: "city_event_scope_audit_missing" });

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    events: events.length,
    sports,
    music,
    food,
    festivals,
    municipalities: municipalityCounts,
    sources: Array.isArray(payload.sourceStats) ? payload.sourceStats.length : 0,
    failedSources: Array.isArray(payload.failures) ? payload.failures.length : 0,
    removedOutOfScope: payload.scopeAudit?.removedOutOfScope ?? null
  },
  scopeAudit: payload.scopeAudit || null,
  sourceStats: payload.sourceStats || [],
  failures,
  warnings
};
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/city-event-integrity-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`City event warnings: ${warnings.map((item) => `${item.type}${item.count !== undefined ? `=${item.count}` : ""}`).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 30), null, 2));
  process.exit(1);
}
console.log("City event integrity checks passed.");
