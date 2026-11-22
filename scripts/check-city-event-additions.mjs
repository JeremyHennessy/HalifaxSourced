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
  if (event.supersedesEventIds && (!Array.isArray(event.supersedesEventIds) || event.supersedesEventIds.some((id) => !id || id === event.id))) errors.push(`invalid superseded event ids for ${event.id || event.title || "<missing>"}`);
  if (Object.hasOwn(event, "description") || Object.hasOwn(event, "body") || Object.hasOwn(event, "rawHtml") || Object.hasOwn(event, "content")) errors.push(`raw body field retained for ${event.id || event.title || "<missing>"}`);
  if (!Array.isArray(event.sourceEvidence) || !event.sourceEvidence.some((source) => source.basis === "official_primary" && validUrl(source.sourceUrl))) errors.push(`missing official-primary evidence for ${event.id || event.title || "<missing>"}`);
  for (const source of [...(event.alternateSources || []), ...(event.sourceEvidence || [])]) {
    if (!source.sourceId || !source.sourceName || !validUrl(source.sourceUrl)) errors.push(`invalid linked source on ${event.id || event.title || "<missing>"}`);
    if (source.sourceId && source.sourceId !== event.sourceId && !sourceIds.has(source.sourceId)) errors.push(`linked source ${source.sourceId} on ${event.id || event.title || "<missing>"} is not declared.`);
  }
}

const context = vm.createContext({ window: {}, Date, console });
vm.runInContext(await readFile(cityEventsJsUrl, "utf8"), context, { filename: "data/city-events.js", timeout: 20000 });
const sourceEvents = JSON.parse(JSON.stringify(context.window.HALIFAX_CITY_EVENTS?.events || []));
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

const garnetRogersUrl = "https://www.thecarleton.ca/events/garnet-rogers-2/";
const garnetRogersEvents = mergedEvents.filter((event) => event.eventUrl === garnetRogersUrl);
if (garnetRogersEvents.length !== 1) errors.push(`expected one current Garnet Rogers Friday record after supersession, found ${garnetRogersEvents.length}.`);
const garnetRogers = garnetRogersEvents[0];
if (garnetRogers) {
  const sourceGarnetRogers = sourceEvents.find((event) => event.eventUrl === garnetRogersUrl && event.startAt === garnetRogers.startAt);
  const reviewedGarnetRogers = additions.events.find((event) => event.eventUrl === garnetRogersUrl && event.startAt === garnetRogers.startAt);
  const sourceObservedAt = Date.parse(String(sourceGarnetRogers?.observedAt || ""));
  const reviewedObservedAt = Date.parse(String(reviewedGarnetRogers?.observedAt || ""));
  const expectedTitle = Number.isFinite(sourceObservedAt) && (!Number.isFinite(reviewedObservedAt) || sourceObservedAt >= reviewedObservedAt)
    ? sourceGarnetRogers?.title
    : reviewedGarnetRogers?.title;
  if (garnetRogers.id !== "the-carleton-876ba7e576b6c6fe") errors.push("current Garnet Rogers Friday event id did not survive runtime merge.");
  if (!(garnetRogers.supersedesEventIds || []).includes("the-carleton-d2693c5a7b5c42a3")) errors.push("prior Garnet Rogers Friday event id was not preserved as superseded identity.");
  if (expectedTitle && garnetRogers.title !== expectedTitle) errors.push("freshest Garnet Rogers Friday official title did not survive runtime merge.");
  if (sourceGarnetRogers?.id
    && sourceGarnetRogers.id !== garnetRogers.id
    && !(garnetRogers.supersedesEventIds || []).includes(sourceGarnetRogers.id)
    && !(garnetRogers.duplicateEventIds || []).includes(sourceGarnetRogers.id)) {
    errors.push("fresh source-generated Garnet Rogers Friday alias was not preserved.");
  }
}
if (mergedEvents.some((event) => event.id === "the-carleton-d2693c5a7b5c42a3")) errors.push("superseded Garnet Rogers Friday record remained in the runtime event list.");

const gremlins = mergedEvents.filter((event) => event.title === "Movie: Gremlins" && event.startAt.startsWith("2026-12-09"));
if (gremlins.length !== 1) errors.push(`expected one current Movie: Gremlins record after reviewed supersession, found ${gremlins.length}.`);
if (gremlins[0]?.id !== "halifax-public-libraries-8481b1bba8ed1139"
  || gremlins[0]?.startAt !== "2026-12-09T22:30:00.000Z"
  || gremlins[0]?.endAt !== "2026-12-10T00:15:00.000Z"
  || gremlins[0]?.eventUrl !== "https://halifax.bibliocommons.com/v2/events/6af623c99bd80b004519050f") {
  errors.push("current Movie: Gremlins official replacement identity, time, or source URL did not survive the runtime merge.");
}
if (mergedEvents.some((event) => event.id === "halifax-public-libraries-138e27ae3fd0e498")) {
  errors.push("superseded Movie: Gremlins 6:00 p.m. record remained in the runtime event list.");
}

for (const expected of [
  {
    id: "halifax-public-libraries-8e14b0aef3f87c61",
    supersededId: "halifax-public-libraries-9c39d562c2db3b61",
    title: "Art Club: Styrofoam Printmaking",
    startAt: "2026-12-15T19:30:00.000Z",
    endAt: "2026-12-15T20:30:00.000Z",
    eventUrl: "https://halifax.bibliocommons.com/v2/events/6ae25640de300e00451d8d44"
  },
  {
    id: "halifax-public-libraries-fa5f4f22ecc26faa",
    supersededId: "halifax-public-libraries-963779298d9c1eac",
    title: "Job Search Support with Job Junction",
    startAt: "2026-12-15T17:00:00.000Z",
    endAt: "2026-12-15T18:00:00.000Z",
    eventUrl: "https://halifax.bibliocommons.com/v2/events/6ab3f8eb0fe10113c0032ce4"
  },
  {
    id: "halifax-public-libraries-f3911fb20bb37160",
    supersededId: "halifax-public-libraries-80426a6400b2c193",
    title: "Book Club: The Lion Women of Tehran",
    startAt: "2027-03-17T16:00:00.000Z",
    endAt: "2027-03-17T17:00:00.000Z",
    eventUrl: "https://halifax.bibliocommons.com/v2/events/6a149483f56bd86e00b1fe6e"
  }
]) {
  const current = mergedEvents.filter((event) => event.id === expected.id);
  if (current.length !== 1
    || current[0]?.title !== expected.title
    || current[0]?.startAt !== expected.startAt
    || current[0]?.endAt !== expected.endAt
    || current[0]?.eventUrl !== expected.eventUrl
    || !(current[0]?.supersedesEventIds || []).includes(expected.supersededId)) {
    errors.push(`official library reschedule did not preserve the reviewed replacement for ${expected.id}`);
  }
  if (mergedEvents.some((event) => event.id === expected.supersededId)) {
    errors.push(`superseded official library occurrence remained in the runtime event list: ${expected.supersededId}`);
  }
}

const coryTetfordUrl = "https://www.thecarleton.ca/events/cory-tetford-nov20/";
const coryTetfordEndAt = "2026-11-21T02:00:00.000Z";
const coryTetfordHasEnded = Date.now() >= Date.parse(coryTetfordEndAt);
const coryTetfordEvents = mergedEvents.filter((event) => event.eventUrl === coryTetfordUrl);
if ((!coryTetfordHasEnded && coryTetfordEvents.length !== 1) || (coryTetfordHasEnded && coryTetfordEvents.length > 1)) {
  errors.push(`expected ${coryTetfordHasEnded ? "at most one retained" : "one current"} Cory Tetford Friday source record after availability reverted to sold out, found ${coryTetfordEvents.length}.`);
}
const coryTetford = coryTetfordEvents[0];
if (coryTetford && (coryTetford.id !== "the-carleton-d871ebe44c3f516a"
  || coryTetford?.title !== "SOLD OUT: Cory Tetford – Friday"
  || coryTetford?.startAt !== "2026-11-21T00:00:00.000Z"
  || coryTetford?.endAt !== coryTetfordEndAt)) {
  errors.push("current Cory Tetford Friday official availability title, identity, or time did not survive the runtime merge.");
}
if (mergedEvents.some((event) => event.id === "the-carleton-fc397e87057fd82a")) {
  errors.push("stale four-ticket Cory Tetford Friday replacement remained in the runtime event list.");
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
