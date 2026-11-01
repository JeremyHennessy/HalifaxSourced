import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const cityEvents = [];
const context = vm.createContext({
  console,
  Date,
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
  consumerTags() {}
});
context.window = context;
context.HALIFAX_CITY_EVENTS = { events: cityEvents, failures: [] };

for (const file of ["app-home.js", "app-events.js", "app-event-pagination.js", "app-event-date-fixes.js", "app-event-local-sort-fixes.js"]) {
  const source = await readFile(resolve(file), "utf8");
  vm.runInContext(source, context, { filename: file });
}

const cases = [
  ["children-free-adults-paid", "Free for children; adults $20", "paid"],
  ["explicit-not-free", "Not free", "unknown"],
  ["no-free-admission", "No free admission", "unknown"],
  ["free-admission-not-offered", "Free admission is not offered", "unknown"],
  ["free-admission-question", "Free admission?", "unknown"],
  ["free-question", "Free?", "unknown"],
  ["zero-question", "0?", "unknown"],
  ["admission-zero-question", "Admission $0?", "unknown"],
  ["negated-priced-admission", "No $20 admission fee", "unknown"],
  ["parking-before-zero-admission", "$20 parking, admission $0", "unknown"],
  ["zero-admission-for-children", "Admission $0 for children", "unknown"],
  ["member-zero-admission", "Members: $0 admission", "unknown"],
  ["not-complimentary-admission", "Not complimentary admission", "unknown"],
  ["no-complimentary-entry", "No complimentary entry", "unknown"],
  ["member-free-event", "Free event for members", "unknown"],
  ["purchase-required", "Free to attend with purchase", "unknown"],
  ["members-receive-free", "Members receive free admission", "unknown"],
  ["members-only-free", "Free admission, members only", "unknown"],
  ["free-and-paid-entry", "Free admission and paid entry", "unknown"],
  ["no-admission-fee", "No admission fee", "free"],
  ["zero-admission", "$0 admission", "free"],
  ["paid-admission-claim", "Paid admission", "unknown"],
  ["parking-only", "Free parking", "unknown"],
  ["parking-no-charge", "No charge for parking", "unknown"],
  ["conditional-free", "Free for members", "unknown"],
  ["member-free-admission", "Free admission for members", "unknown"],
  ["all-children-free", "Free admission for all children", "unknown"],
  ["entry-with-purchase", "Free entry with purchase", "unknown"],
  ["age-restriction", "Ages 12 and up", "unknown"],
  ["registration-deadline", "Registration closes at 5", "unknown"],
  ["compact-parking-price", "$5parking", "unknown"],
  ["tickets-available", "Tickets available", "unknown"],
  ["zero-tickets-available", "0 tickets available", "unknown"],
  ["free-admission-paid-parking", "Free admission; parking $20", "unknown"],
  ["mixed-concession", "Free for children; adults $20", "paid"],
  ["free-admission-adult-price", "Free admission; adults $20", "paid"],
  ["paid-admission-free-parking", "$20 admission; free parking", "paid"],
  ["free-and-paid-entry-price", "Free admission and paid entry $20", "unknown"],
  ["free-admission", "Free admission", "free"],
  ["free-for-everyone", "Free admission for everyone", "free"],
  ["admission-no-charge", "No charge for admission", "free"],
  ["complimentary-entry", "Complimentary entry", "free"],
  ["plain-price", "$12", "paid"],
  ["plain-zero-price", "0", "free"],
  ["empty-price", "", "unknown"]
];

const events = cases.map(([id, price]) => ({
  id,
  title: id,
  price,
  startAt: "2026-12-01T18:00:00.000Z",
  endAt: "2026-12-01T20:00:00.000Z",
  city: "Halifax",
  categories: ["Community"],
  sourceName: "Synthetic test source",
  eventUrl: "https://example.invalid/event"
}));

const costFilter = vm.runInContext(
  'eventFilterSelect("Price", "eventCostFilter", "all", [["all", "Any price"], ["free", "Free"], ["paid", "Paid"], ["unknown", "Price not listed"]])',
  context
);
assert.match(costFilter, /<label class="event-filter-control"><span>Price<\/span><select id="eventCostFilter">/, "price filter remains explicitly labelled for assistive technology");

for (let i = 0; i < cases.length; i += 1) {
  const [id, sourcePrice, expected] = cases[i];
  const event = events[i];
  assert.equal(vm.runInContext("eventCostKind", context)(event), expected, id);

  vm.runInContext(`cityEventState.cost = ${JSON.stringify(expected)}`, context);
  assert.equal(vm.runInContext("eventPassesFacetFilters", context)(event), true, `${id} appears in its classified filter`);

  const card = vm.runInContext("cityEventCard", context)(event);
  assert.match(card, new RegExp(`data-event-cost="${expected}"`), `${id} card cost data`);
  if (sourcePrice) {
    assert.ok(card.includes(sourcePrice), `${id} preserves source price text`);
    assert.ok(card.includes(`<small>`) && card.includes(sourcePrice), `${id} price remains in readable card text`);
  }
  else assert.ok(card.includes("Price not listed"), `${id} keeps missing price unknown in the card`);
}

for (const [cost, expectedIds] of [
  ["free", ["no-admission-fee", "zero-admission", "free-admission", "free-for-everyone", "admission-no-charge", "complimentary-entry", "plain-zero-price"]],
  ["paid", ["children-free-adults-paid", "mixed-concession", "free-admission-adult-price", "paid-admission-free-parking", "plain-price"]],
  ["unknown", ["explicit-not-free", "no-free-admission", "free-admission-not-offered", "free-admission-question", "free-question", "zero-question", "admission-zero-question", "negated-priced-admission", "parking-before-zero-admission", "zero-admission-for-children", "member-zero-admission", "not-complimentary-admission", "no-complimentary-entry", "member-free-event", "purchase-required", "members-receive-free", "members-only-free", "free-and-paid-entry", "paid-admission-claim", "parking-only", "parking-no-charge", "conditional-free", "member-free-admission", "all-children-free", "entry-with-purchase", "age-restriction", "registration-deadline", "compact-parking-price", "tickets-available", "zero-tickets-available", "free-admission-paid-parking", "free-and-paid-entry-price", "empty-price"]]
]) {
  vm.runInContext(`cityEventState.cost = ${JSON.stringify(cost)}`, context);
  const actualIds = events.filter((event) => vm.runInContext("eventPassesFacetFilters", context)(event)).map((event) => event.id);
  assert.deepEqual(actualIds, expectedIds, `${cost} filter results`);
}

console.log("Event cost classification passed: admission prices outrank free perks, conditional/ancillary free stays unknown, free admission remains free, and cards preserve the source wording.");
