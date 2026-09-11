import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const additionsJsonUrl = new URL("../data/build/city-event-additions.json", import.meta.url);
const additionsJsUrl = new URL("../data/city-event-additions.js", import.meta.url);
const cityEventsJsUrl = new URL("../data/city-events.js", import.meta.url);
const reportUrl = new URL("../artifacts/city-event-additions-report.json", import.meta.url);

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validDate(value) {
  return Number.isFinite(Date.parse(String(value ?? "")));
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventDateKey(value) {
  const text = String(value ?? "").trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (dateOnly) return dateOnly[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function eventKey(event) {
  return [
    normalize(event?.title),
    eventDateKey(event?.startAt),
    normalize(event?.venueName || event?.address || event?.city || "halifax")
  ].join("|");
}

const additions = JSON.parse(await readFile(additionsJsonUrl, "utf8"));
const sourceIds = new Set((additions.sources || []).map((source) => source.sourceId).filter(Boolean));
const errors = [];
const warnings = [];
const eventIds = new Set();
const eventKeys = new Set();

if (!Array.isArray(additions.sources) || !additions.sources.length) errors.push("city-event-additions must define at least one source.");
if (!Array.isArray(additions.events) || !additions.events.length) errors.push("city-event-additions must define at least one event.");

for (const source of additions.sources || []) {
  if (!source.sourceId || !source.sourceName || !validUrl(source.sourceUrl) || !source.authority) {
    errors.push(`invalid addition source: ${source.sourceId || source.sourceName || "<missing>"}`);
  }
}

for (const event of additions.events || []) {
  const key = eventKey(event);
  if (!event.id || eventIds.has(event.id)) errors.push(`duplicate or missing addition event id: ${event.id || "<missing>"}`);
  if (eventKeys.has(key)) errors.push(`duplicate addition event key: ${key}`);
  eventIds.add(event.id);
  eventKeys.add(key);

  if (!event.title || !validDate(event.startAt) || !validDate(event.endAt || event.startAt)) errors.push(`invalid title or date for ${event.id || "<missing>"}`);
  if (!event.city || !/\b(halifax|dartmouth|bedford)\b/i.test(`${event.city} ${event.address || ""} ${event.venueName || ""}`)) errors.push(`missing Halifax-metro evidence for ${event.id || event.title || "<missing>"}`);
  if (!event.sourceId || !event.sourceName || !event.sourceKind || !validUrl(event.sourceUrl) || !event.observedAt) errors.push(`invalid source fields for ${event.id || event.title || "<missing>"}`);
  if (!Array.isArray(event.categories) || !event.categories.length) errors.push(`missing categories for ${event.id || event.title || "<missing>"}`);
  if (Object.hasOwn(event, "description") || Object.hasOwn(event, "body") || Object.hasOwn(event, "rawHtml") || Object.hasOwn(event, "content")) errors.push(`raw body field retained for ${event.id || event.title || "<missing>"}`);
  if (!Array.isArray(event.sourceEvidence) || !event.sourceEvidence.some((source) => source.basis === "official_primary" && validUrl(source.sourceUrl))) errors.push(`missing official-primary evidence for ${event.id || event.title || "<missing>"}`);
  for (const source of [...(event.alternateSources || []), ...(event.sourceEvidence || [])]) {
    if (!source.sourceId || !source.sourceName || !validUrl(source.sourceUrl)) errors.push(`invalid linked source on ${event.id || event.title || "<missing>"}`);
    if (source.sourceId && source.sourceId !== event.sourceId && !sourceIds.has(source.sourceId)) errors.push(`linked source ${source.sourceId} on ${event.id || event.title || "<missing>"} is not declared.`);
  }
}

const context = vm.createContext({ window: {}, Date, console });
vm.runInContext(await readFile(cityEventsJsUrl, "utf8"), context, { filename: "data/city-events.js", timeout: 20000 });
const beforeEvents = Array.isArray(context.window.HALIFAX_CITY_EVENTS?.events) ? context.window.HALIFAX_CITY_EVENTS.events.length : 0;
vm.runInContext(await readFile(additionsJsUrl, "utf8"), context, { filename: "data/city-event-additions.js", timeout: 20000 });
const jsAdditions = context.window.HALIFAX_CITY_EVENT_ADDITIONS;
const mergedPayload = context.window.HALIFAX_CITY_EVENTS || { events: [] };
const mergedEvents = Array.isArray(mergedPayload.events) ? mergedPayload.events : [];

if (JSON.stringify(jsAdditions) !== JSON.stringify(additions)) errors.push("data/city-event-additions.js is not in sync with data/build/city-event-additions.json.");
if (mergedPayload.eventCount !== mergedEvents.length) errors.push(`runtime city-event addition count mismatch: ${mergedPayload.eventCount} vs ${mergedEvents.length}`);
const tasteAsiaEvents = mergedEvents.filter((event) => String(event.id || "") === "taste-asia-2026-food-culture-festival" || /taste asia/i.test(String(event.title || "")));
if (!tasteAsiaEvents.length) errors.push("runtime additions did not expose Taste Asia 2026.");
if (tasteAsiaEvents.length > 1) warnings.push(`multiple Taste Asia-like events after merge: ${tasteAsiaEvents.length}`);
const tasteAsia = tasteAsiaEvents.find((event) => event.id === "taste-asia-2026-food-culture-festival") || tasteAsiaEvents[0];
if (tasteAsia) {
  if (eventDateKey(tasteAsia.startAt) !== "2026-09-10" || eventDateKey(tasteAsia.endAt) !== "2026-09-13") errors.push("Taste Asia 2026 date range did not survive runtime merge.");
  if (!String(tasteAsia.venueName || "").toLowerCase().includes("salter")) errors.push("Taste Asia 2026 venue did not survive runtime merge.");
  if (!(tasteAsia.categories || []).includes("Food & Drink") || !(tasteAsia.categories || []).includes("Festivals")) errors.push("Taste Asia 2026 must remain visible in Food & Drink and Festivals filters.");
  if (!validUrl(tasteAsia.sourceUrl) || !validUrl(tasteAsia.eventUrl)) errors.push("Taste Asia 2026 source/event URLs are invalid after runtime merge.");
}

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(reportUrl, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceCount: Array.isArray(additions.sources) ? additions.sources.length : 0,
  additionEventCount: Array.isArray(additions.events) ? additions.events.length : 0,
  beforeEvents,
  afterRuntimeMergeEvents: mergedEvents.length,
  tasteAsiaRuntimeRecords: tasteAsiaEvents.length,
  warnings,
  errors
}, null, 2) + "\n");

if (warnings.length) console.warn(warnings.join("\n"));
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`City event additions validated: sources=${sourceIds.size}, additions=${eventIds.size}, runtime-total=${mergedEvents.length}.`);
