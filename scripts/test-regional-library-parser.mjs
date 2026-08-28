import { parseRegionalLibraryPage } from "./regional-library-lib.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const source = {
  id: "halifax-public-libraries",
  name: "Halifax Public Libraries",
  kind: "public_library_calendar",
  url: "https://halifax.bibliocommons.com/v2/events"
};
const woodlawn = { code: "W", name: "Woodlawn Public Library", city: "Dartmouth" };
const html = `
<h3><a href="/events/woodlawn-movie">Movie: Jumanji</a></h3>
<div>Saturday, August 29 on August 29, 2026, 2:15pm–4:15pm 2:15pm to 4:15pm</div>
<div>Woodlawn Public Library Event location: Woodlawn Public Library</div>
<div>Free tickets will be given out. Movies All Ages.</div>
<h3><a href="/events/central-talk">Central Talk</a></h3>
<div>Saturday, August 29 on August 29, 2026, 4:00pm–5:00pm 4:00pm to 5:00pm</div>
<div>Central Library Event location: Central Library</div>
<h3><a href="/events/cancelled">Cancelled Program</a></h3>
<div>Cancelled Saturday, August 29 on August 29, 2026, 6:00pm–7:00pm 6:00pm to 7:00pm</div>
<div>Woodlawn Public Library Event location: Woodlawn Public Library</div>
`;
const events = parseRegionalLibraryPage({
  html,
  resolvedUrl: "https://halifax.bibliocommons.com/v2/events?locations=W&page=1",
  filter: woodlawn,
  source,
  rangeStart: Date.parse("2026-08-28T00:00:00Z"),
  rangeEnd: Date.parse("2027-01-01T00:00:00Z"),
  observedAt: "2026-08-28T22:00:00Z"
});
assert(events.length === 1, `Expected exactly one Woodlawn event, got ${events.length}.`);
const event = events[0];
assert(event.title === "Movie: Jumanji", `Unexpected title: ${event.title}`);
assert(event.city === "Dartmouth", `Expected Dartmouth, got ${event.city}.`);
assert(event.venueName === "Woodlawn Public Library", `Unexpected venue: ${event.venueName}`);
assert(event.startAt === "2026-08-29T17:15:00.000Z", `Expected Halifax 2:15pm ADT -> 17:15Z, got ${event.startAt}.`);
assert(event.endAt === "2026-08-29T19:15:00.000Z", `Expected Halifax 4:15pm ADT -> 19:15Z, got ${event.endAt}.`);
assert(event.free === true && event.price === "Free", "Explicit free evidence should be retained.");
assert(event.ticketUrl === null, "A library calendar source is not a ticket URL.");
assert(event.eventUrl === "https://halifax.bibliocommons.com/events/woodlawn-movie", `Unexpected event URL ${event.eventUrl}.`);
assert(event.categories.includes("Arts"), `Movie should classify as Arts, got ${event.categories.join(",")}.`);
assert(event.associationBasis === "bibliocommons_location_filter:W", "Location-filter evidence basis missing.");

const allDayHtml = `
<h3><a href="/events/bedford-exhibit">Community Art Exhibit</a></h3>
<div>All day, Sunday, August 30 to Monday, August 31 from August 30, 2026 to August 31, 2026</div>
<div>Bedford Public Library Event location: Bedford Public Library</div>
<div>Arts & Crafts</div>
`;
const allDay = parseRegionalLibraryPage({
  html: allDayHtml,
  resolvedUrl: "https://halifax.bibliocommons.com/v2/events?locations=BED&page=1",
  filter: { code: "BED", name: "Bedford Public Library", city: "Bedford" },
  source,
  rangeStart: Date.parse("2026-08-28T00:00:00Z"),
  rangeEnd: Date.parse("2027-01-01T00:00:00Z")
});
assert(allDay.length === 1 && allDay[0].allDay === true, "All-day range should parse.");
assert(allDay[0].city === "Bedford", "Bedford source filter must set Bedford city.");

const outOfRange = parseRegionalLibraryPage({
  html,
  resolvedUrl: "https://halifax.bibliocommons.com/v2/events?locations=W&page=1",
  filter: woodlawn,
  source,
  rangeStart: Date.parse("2026-09-01T00:00:00Z"),
  rangeEnd: Date.parse("2027-01-01T00:00:00Z")
});
assert(outOfRange.length === 0, "Out-of-range events must be excluded.");

console.log("Regional library parser regression passed: branch enforcement, Halifax time, free evidence, exact URLs, all-day ranges, cancellation and date scope are preserved.");
