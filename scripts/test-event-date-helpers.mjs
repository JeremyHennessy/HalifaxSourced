import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const RealDate = Date;
const FIXED_NOW = "2026-09-04T15:00:00.000Z";

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(FIXED_NOW);
      return;
    }
    super(...args);
  }

  static now() {
    return new RealDate(FIXED_NOW).getTime();
  }

  static parse(value) {
    return RealDate.parse(value);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
}

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
  },
  {
    id: "past-event",
    title: "Past event",
    startAt: "2026-09-03T15:00:00.000Z",
    endAt: "2026-09-03T17:00:00.000Z",
    categories: ["Music"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "next-seven-boundary",
    title: "Seventh future calendar day event",
    startAt: "2026-09-11T15:00:00.000Z",
    endAt: "2026-09-11T17:00:00.000Z",
    categories: ["Music"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "next-eight-outside",
    title: "Eighth future calendar day event",
    startAt: "2026-09-12T15:00:00.000Z",
    endAt: "2026-09-12T17:00:00.000Z",
    categories: ["Music"],
    city: "Halifax",
    sourceName: "Test source"
  }
];

const context = vm.createContext({
  console,
  Date: FixedDate,
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
  cityEventState.windowDays = "7";
  const nextSevenIds = cityEventsForWindow(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  cityEventState.windowDays = "today";
  const todayIds = cityEventsForWindow(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  return {
    dateOnlyStart: debug.eventBoundaryKey(dateOnly, "startAt"),
    dateOnlyEnd: debug.eventBoundaryKey(dateOnly, "endAt"),
    utcMidnightStart: debug.eventBoundaryKey(utcMidnight, "startAt"),
    utcMidnightEnd: debug.eventBoundaryKey(utcMidnight, "endAt"),
    dateOnlyToday: debug.eventOverlapsDateRange(dateOnly, "2026-09-04", "2026-09-04"),
    dateOnlyPreviousDay: debug.eventOverlapsDateRange(dateOnly, "2026-09-03", "2026-09-03"),
    utcMidnightToday: debug.eventOverlapsDateRange(utcMidnight, "2026-09-04", "2026-09-04"),
    nextSevenRange: debug.eventDateWindowRange("7"),
    todayRange: debug.eventDateWindowRange("today"),
    nextSevenIds,
    todayIds,
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
if (result.todayRange?.startKey !== "2026-09-04" || result.todayRange?.endKey !== "2026-09-04") failures.push(`today range should only cover Sep 4: ${JSON.stringify(result)}`);
if (result.nextSevenRange?.startKey !== "2026-09-04" || result.nextSevenRange?.endKey !== "2026-09-11") failures.push(`next 7 days should include today through the seventh future calendar date: ${JSON.stringify(result)}`);
if (!result.nextSevenIds.includes("next-seven-boundary")) failures.push(`next 7 days should include the Sep 11 boundary event: ${JSON.stringify(result)}`);
if (result.nextSevenIds.includes("next-eight-outside")) failures.push(`next 7 days should exclude the Sep 12 event: ${JSON.stringify(result)}`);
if (result.nextSevenIds.includes("past-event")) failures.push(`next 7 days should exclude prior-day events: ${JSON.stringify(result)}`);
if (result.todayIds.includes("next-seven-boundary")) failures.push(`today filter should not include future boundary events: ${JSON.stringify(result)}`);
if (/Sep(?:t)? 3|<strong>3<\/strong>/.test(`${result.dateOnlyWhen} ${result.utcMidnightWhen} ${result.dateOnlyCard} ${result.utcMidnightCard}`)) failures.push(`all-day event rendered as the previous date: ${JSON.stringify(result)}`);
if (!/<strong>4<\/strong>/.test(result.dateOnlyCard) || !/<strong>4<\/strong>/.test(result.utcMidnightCard)) failures.push(`event card date badge did not render Sep 4: ${JSON.stringify(result)}`);
if (result.dateOnlyTimeKind !== "all-day") failures.push(`date-only event should be all-day, got ${result.dateOnlyTimeKind}`);
if (!["evening", "afternoon", "morning"].includes(result.timedTimeKind)) failures.push(`timed event should classify by Halifax clock time, got ${result.timedTimeKind}`);

if (failures.length) {
  throw new Error(failures.join("\n"));
}

console.log("Event date helper regression passed.");
