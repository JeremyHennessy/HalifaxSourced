import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const cityEvents = [
  {
    id: "date-only-all-day",
    title: "Date-only all day event",
    startAt: "2026-09-04",
    endAt: "2026-09-04",
    allDay: true,
    categories: ["Community"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "utc-midnight-all-day",
    title: "UTC midnight all day event",
    startAt: "2026-09-04T00:00:00.000Z",
    endAt: "2026-09-04T00:00:00.000Z",
    allDay: true,
    categories: ["Arts"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "timed-evening",
    title: "Timed evening event",
    startAt: "2026-09-04T23:00:00.000Z",
    endAt: "2026-09-05T01:00:00.000Z",
    categories: ["Music"],
    city: "Halifax",
    sourceName: "Test source"
  }
];

const context = vm.createContext({
  console,
  Date,
  Intl,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  addEventListener() {},
  removeEventListener() {},
  window: null,
  document: {
    body: { classList: { add() {}, remove() {}, contains() { return false; } } },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return { click() {}, remove() {} }; }
  },
  localStorage: { getItem() { return "[]"; }, setItem() {} },
  location: { hash: "#events" },
  history: { replaceState() {} },
  Blob: function Blob() {},
  URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
  appView: { innerHTML: "" },
  globalSearch: null,
  searchForm: null,
  restaurants: [],
  activeRestaurants: [],
  recentOfficialPosts: [],
  structuredEvents: [],
  renderHome() {},
  route() { return { name: "events", params: new URLSearchParams() }; },
  safeUrl(value) { return String(value || ""); },
  escapeHtml(value) { return String(value ?? ""); },
  bindCommonActions() {},
  eventLeadItems() { return []; },
  emptyPageState(message) { return `<p>${message}</p>`; },
  displayEventLabel(label, fallback) { return label || fallback; },
  mediaTone() { return "dining"; },
  permittedImageClass() { return ""; },
  mediaImageMarkup() { return ""; },
  toast() {},
  restaurantCard() { return ""; },
  consumerTags() { return []; }
});
context.window = context;
context.HALIFAX_CITY_EVENTS = { events: cityEvents, failures: [] };

for (const file of ["app-events.js", "app-event-pagination.js", "app-event-date-fixes.js"]) {
  const source = await readFile(resolve(file), "utf8");
  vm.runInContext(source, context, { filename: file });
}

const result = vm.runInContext(`(() => {
  const debug = window.__halifaxEventDateDebug;
  const dateOnly = window.HALIFAX_CITY_EVENTS.events[0];
  const utcMidnight = window.HALIFAX_CITY_EVENTS.events[1];
  const timed = window.HALIFAX_CITY_EVENTS.events[2];
  return {
    dateOnlyStart: debug.eventBoundaryKey(dateOnly, "startAt"),
    dateOnlyEnd: debug.eventBoundaryKey(dateOnly, "endAt"),
    utcMidnightStart: debug.eventBoundaryKey(utcMidnight, "startAt"),
    utcMidnightEnd: debug.eventBoundaryKey(utcMidnight, "endAt"),
    dateOnlyToday: debug.eventOverlapsDateRange(dateOnly, "2026-09-04", "2026-09-04"),
    dateOnlyPreviousDay: debug.eventOverlapsDateRange(dateOnly, "2026-09-03", "2026-09-03"),
    utcMidnightToday: debug.eventOverlapsDateRange(utcMidnight, "2026-09-04", "2026-09-04"),
    dateOnlyWhen: structuredEventWhen(dateOnly),
    utcMidnightWhen: structuredEventWhen(utcMidnight),
    timedWhen: structuredEventWhen(timed),
    dateOnlyCard: cityEventCard(dateOnly),
    utcMidnightCard: cityEventCard(utcMidnight),
    dateOnlyTimeKind: eventTimeKind(dateOnly),
    timedTimeKind: eventTimeKind(timed)
  };
})()`, context);

const failures = [];
if (result.dateOnlyStart !== "2026-09-04" || result.dateOnlyEnd !== "2026-09-04") failures.push(`date-only boundary keys shifted: ${JSON.stringify(result)}`);
if (result.utcMidnightStart !== "2026-09-04" || result.utcMidnightEnd !== "2026-09-04") failures.push(`UTC-midnight all-day boundary keys shifted: ${JSON.stringify(result)}`);
if (!result.dateOnlyToday || result.dateOnlyPreviousDay) failures.push(`date-only overlap matched the wrong Halifax day: ${JSON.stringify(result)}`);
if (!result.utcMidnightToday) failures.push(`UTC-midnight all-day event missed its Halifax day: ${JSON.stringify(result)}`);
if (/Sep(?:t)? 3|<strong>3<\/strong>/.test(`${result.dateOnlyWhen} ${result.utcMidnightWhen} ${result.dateOnlyCard} ${result.utcMidnightCard}`)) failures.push(`all-day event rendered as the previous date: ${JSON.stringify(result)}`);
if (!/<strong>4<\/strong>/.test(result.dateOnlyCard) || !/<strong>4<\/strong>/.test(result.utcMidnightCard)) failures.push(`event card date badge did not render Sep 4: ${JSON.stringify(result)}`);
if (result.dateOnlyTimeKind !== "all-day") failures.push(`date-only event should be all-day, got ${result.dateOnlyTimeKind}`);
if (!["evening", "afternoon", "morning"].includes(result.timedTimeKind)) failures.push(`timed event should classify by Halifax clock time, got ${result.timedTimeKind}`);

if (failures.length) {
  throw new Error(failures.join("\n"));
}

console.log("Event date helper regression passed.");
