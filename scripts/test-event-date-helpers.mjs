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
    id: "ongoing-multiday",
    title: "Ongoing multi-day festival",
    startAt: "2026-09-02",
    endAt: "2026-09-06",
    allDay: true,
    categories: ["Festivals"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "long-running-exhibit",
    title: "Long-running exhibit",
    startAt: "2026-09-01",
    endAt: "2026-11-30",
    allDay: true,
    categories: ["Arts"],
    city: "Halifax",
    sourceName: "Test source"
  },
  {
    id: "sports-season-summary",
    title: "Halifax Tides FC 2026 Season",
    startAt: "2026-04-25T18:00:00.000Z",
    endAt: "2026-10-26T20:00:00.000Z",
    categories: ["Sports"],
    city: "Halifax",
    venueName: "Wanderers Grounds",
    sourceName: "Tourism Nova Scotia Events",
    sourceKind: "official_tourism_calendar"
  },
  {
    id: "sports-local-game",
    title: "Halifax Tides vs Ottawa Rapid FC",
    startAt: "2026-09-07T18:00:00.000Z",
    endAt: "2026-09-07T20:00:00.000Z",
    categories: ["Sports"],
    city: "Halifax",
    venueName: "Wanderers Grounds",
    sourceName: "Halifax Tides Home Schedule",
    sourceKind: "official_sports_schedule"
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
  requestAnimationFrame(callback) { callback(); },
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

for (const file of ["app-events.js", "app-event-pagination.js", "app-event-date-fixes.js", "app-event-local-sort-fixes.js"]) {
  const source = await readFile(resolve(file), "utf8");
  vm.runInContext(source, context, { filename: file });
}

const result = vm.runInContext(`(() => {
  const debug = window.__halifaxEventDateDebug;
  const dateOnly = window.HALIFAX_CITY_EVENTS.events[0];
  const utcMidnight = window.HALIFAX_CITY_EVENTS.events[1];
  const timed = window.HALIFAX_CITY_EVENTS.events[2];
  const ongoing = window.HALIFAX_CITY_EVENTS.events[3];
  const longRunning = window.HALIFAX_CITY_EVENTS.events[4];
  const sportsSeason = window.HALIFAX_CITY_EVENTS.events[5];
  const sportsGame = window.HALIFAX_CITY_EVENTS.events[6];
  cityEventState.windowDays = "7";
  cityEventState.sort = "soonest";
  cityEventState.category = "All";
  cityEventState.duration = "short";
  const nextSevenIds = cityEventsForWindow(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  const sortedNextSevenIds = filteredCityEvents(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  const longRunningMatches = matchingLongRunningCityEvents(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  cityEventState.duration = "long";
  const longDurationIds = filteredCityEvents(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  cityEventState.duration = "all";
  cityEventState.category = "Sports";
  const sportsIds = filteredCityEvents(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  cityEventState.category = "All";
  cityEventState.duration = "short";
  cityEventState.windowDays = "today";
  const todayIds = cityEventsForWindow(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  const filteredTodayIds = filteredCityEvents(window.HALIFAX_CITY_EVENTS.events).map((event) => event.id);
  return {
    dateOnlyStart: debug.eventBoundaryKey(dateOnly, "startAt"),
    dateOnlyEnd: debug.eventBoundaryKey(dateOnly, "endAt"),
    utcMidnightStart: debug.eventBoundaryKey(utcMidnight, "startAt"),
    utcMidnightEnd: debug.eventBoundaryKey(utcMidnight, "endAt"),
    ongoingStart: debug.eventBoundaryKey(ongoing, "startAt"),
    ongoingEnd: debug.eventBoundaryKey(ongoing, "endAt"),
    ongoingSortKey: debug.eventLocalSortKey(ongoing),
    ongoingCalendarDays: debug.eventCalendarDayKeys(ongoing),
    longDurationDays: debug.eventInclusiveDurationDays(longRunning),
    longDurationKind: debug.eventDurationKind(longRunning),
    shortDurationKind: debug.eventDurationKind(ongoing),
    sportsSeasonDetected: debug.eventLooksLikeSportsSeason(sportsSeason),
    sportsSeasonDiscoverable: isDiscoverableCityEvent(sportsSeason),
    sportsGameDiscoverable: isDiscoverableCityEvent(sportsGame),
    dateOnlyToday: debug.eventOverlapsDateRange(dateOnly, "2026-09-04", "2026-09-04"),
    dateOnlyPreviousDay: debug.eventOverlapsDateRange(dateOnly, "2026-09-03", "2026-09-03"),
    utcMidnightToday: debug.eventOverlapsDateRange(utcMidnight, "2026-09-04", "2026-09-04"),
    ongoingToday: debug.eventOverlapsDateRange(ongoing, "2026-09-04", "2026-09-04"),
    nextSevenRange: debug.eventDateWindowRange("7"),
    todayRange: debug.eventDateWindowRange("today"),
    nextSevenIds,
    sortedNextSevenIds,
    longRunningMatches,
    longDurationIds,
    sportsIds,
    todayIds,
    filteredTodayIds,
    dateOnlyWhen: structuredEventWhen(dateOnly),
    utcMidnightWhen: structuredEventWhen(utcMidnight),
    timedWhen: structuredEventWhen(timed),
    longRunningWhen: structuredEventWhen(longRunning),
    dateOnlyCard: cityEventCard(dateOnly),
    utcMidnightCard: cityEventCard(utcMidnight),
    longRunningCard: cityEventCard(longRunning),
    calendar: simpleCalendar([ongoing]),
    dateOnlyTimeKind: eventTimeKind(dateOnly),
    timedTimeKind: eventTimeKind(timed)
  };
})()`, context);

const failures = [];
if (result.dateOnlyStart !== "2026-09-04" || result.dateOnlyEnd !== "2026-09-04") failures.push(`date-only boundary keys shifted: ${JSON.stringify(result)}`);
if (result.utcMidnightStart !== "2026-09-04" || result.utcMidnightEnd !== "2026-09-04") failures.push(`UTC-midnight all-day boundary keys shifted: ${JSON.stringify(result)}`);
if (result.ongoingStart !== "2026-09-02" || result.ongoingEnd !== "2026-09-06") failures.push(`multi-day boundary keys shifted: ${JSON.stringify(result)}`);
if (result.ongoingSortKey !== "2026-09-04") failures.push(`ongoing multi-day event should sort as today: ${JSON.stringify(result)}`);
if (result.longDurationDays <= 7 || result.longDurationKind !== "long") failures.push(`long-running duration should be detected: ${JSON.stringify(result)}`);
if (result.shortDurationKind !== "short") failures.push(`1-7 day event should remain in short event scope: ${JSON.stringify(result)}`);
if (!result.sportsSeasonDetected || result.sportsSeasonDiscoverable) failures.push(`sports season summary should be hidden from discovery: ${JSON.stringify(result)}`);
if (!result.sportsGameDiscoverable || !result.sportsIds.includes("sports-local-game")) failures.push(`specific local sports game should remain visible: ${JSON.stringify(result)}`);
if (result.sportsIds.includes("sports-season-summary")) failures.push(`sports filter should not render season summaries: ${JSON.stringify(result)}`);
if (!result.dateOnlyToday || result.dateOnlyPreviousDay) failures.push(`date-only overlap matched the wrong Halifax day: ${JSON.stringify(result)}`);
if (!result.utcMidnightToday) failures.push(`UTC-midnight all-day event missed its Halifax day: ${JSON.stringify(result)}`);
if (!result.ongoingToday) failures.push(`ongoing multi-day event should overlap today: ${JSON.stringify(result)}`);
if (result.todayRange?.startKey !== "2026-09-04" || result.todayRange?.endKey !== "2026-09-04") failures.push(`today range should only cover Sep 4: ${JSON.stringify(result)}`);
if (result.nextSevenRange?.startKey !== "2026-09-04" || result.nextSevenRange?.endKey !== "2026-09-11") failures.push(`next 7 days should include today through the seventh future calendar date: ${JSON.stringify(result)}`);
if (!result.nextSevenIds.includes("next-seven-boundary")) failures.push(`next 7 days should include the Sep 11 boundary event: ${JSON.stringify(result)}`);
if (result.nextSevenIds.includes("next-eight-outside")) failures.push(`next 7 days should exclude the Sep 12 event: ${JSON.stringify(result)}`);
if (result.nextSevenIds.includes("past-event")) failures.push(`next 7 days should exclude prior-day events: ${JSON.stringify(result)}`);
if (!result.nextSevenIds.includes("ongoing-multiday")) failures.push(`next 7 days should include ongoing multi-day events: ${JSON.stringify(result)}`);
if (result.sortedNextSevenIds.includes("long-running-exhibit")) failures.push(`default next 7 days should keep long-running records separate: ${JSON.stringify(result)}`);
if (!result.longRunningMatches.includes("long-running-exhibit")) failures.push(`separate long-running prompt should count matching long-running records: ${JSON.stringify(result)}`);
if (!result.longDurationIds.includes("long-running-exhibit")) failures.push(`long-running filter should reveal long-running records: ${JSON.stringify(result)}`);
if (result.longDurationIds.includes("sports-season-summary")) failures.push(`long-running filter should still hide sports season summaries: ${JSON.stringify(result)}`);
if (!result.todayIds.includes("ongoing-multiday") || !result.filteredTodayIds.includes("ongoing-multiday")) failures.push(`today filters should include ongoing 1-7 day events: ${JSON.stringify(result)}`);
if (result.filteredTodayIds.includes("long-running-exhibit")) failures.push(`today default scope should separate long-running events: ${JSON.stringify(result)}`);
if (result.todayIds.includes("next-seven-boundary")) failures.push(`today filter should not include future boundary events: ${JSON.stringify(result)}`);
if (result.sortedNextSevenIds.indexOf("ongoing-multiday") === -1 || result.sortedNextSevenIds.indexOf("ongoing-multiday") > result.sortedNextSevenIds.indexOf("next-seven-boundary")) failures.push(`ongoing 1-7 day events should sort before later future events: ${JSON.stringify(result)}`);
for (const key of ["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]) {
  if (!result.ongoingCalendarDays.includes(key)) failures.push(`calendar day range missed ${key}: ${JSON.stringify(result)}`);
}
for (const day of ["2", "3", "4", "5", "6"]) {
  if (!new RegExp(`>\\*${day}<\\/span>`).test(result.calendar)) failures.push(`calendar markup did not mark Sep ${day}: ${JSON.stringify(result)}`);
}
if (/Sep(?:t)? 3|<strong>3<\/strong>/.test(`${result.dateOnlyWhen} ${result.utcMidnightWhen} ${result.dateOnlyCard} ${result.utcMidnightCard}`)) failures.push(`all-day event rendered as the previous date: ${JSON.stringify(result)}`);
if (!/<strong>4<\/strong>/.test(result.dateOnlyCard) || !/<strong>4<\/strong>/.test(result.utcMidnightCard)) failures.push(`event card date badge did not render Sep 4: ${JSON.stringify(result)}`);
if (!/Ongoing through/.test(result.longRunningWhen) || !/ONGOING/.test(result.longRunningCard) || !/Long-running/.test(result.longRunningCard)) failures.push(`long-running event card should show ongoing range language: ${JSON.stringify(result)}`);
if (result.dateOnlyTimeKind !== "all-day") failures.push(`date-only event should be all-day, got ${result.dateOnlyTimeKind}`);
if (!["evening", "afternoon", "morning"].includes(result.timedTimeKind)) failures.push(`timed event should classify by Halifax clock time, got ${result.timedTimeKind}`);

if (failures.length) {
  throw new Error(failures.join("\n"));
}

console.log("Event date helper regression passed.");