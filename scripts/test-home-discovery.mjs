import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-30T19:00:00Z'])); }
  static now() { return Date.parse('2026-10-30T19:00:00Z'); }
}
const event = (id, startAt, categories, extra = {}) => ({id, title: id, startAt, endAt: startAt, categories, city: 'Halifax', venueName: 'Fixture venue', sourceName: 'Fixture source', eventUrl: 'https://example.org/' + id, ...extra});
const events = [
  event('today-music', '2026-10-30T22:00:00Z', ['Music']),
  event('weekend-market', '2026-10-31', ['Markets'], { allDay: true }),
  event('weekend-festival', '2026-11-01', ['Festivals'], { allDay: true }),
  event('later-music', '2026-11-06T23:00:00Z', ['Music']),
  event('past-event', '2026-10-29', ['Music'], { allDay: true }),
  event('long-exhibition', '2026-10-01', ['Arts'], { endAt: '2026-11-30', allDay: true }),
  event('sports-season', '2026-10-01', ['Sports'], { title: 'Official sports season', endAt: '2026-11-30', allDay: true })
];
const news = (id, publishedAt, extra = {}) => ({id, title: id, publishedAt, publishedPrecision: 'day', observedAt: '2026-10-30T18:00:00Z', canonicalUrl: 'https://example.org/' + id, sourceName: 'Fixture publisher', source_type: 'official_public_notice', region: 'Halifax', topics: ['Community'], summary: 'Original reviewed annotation', summaryKind: 'reviewed_original', reviewStatus: 'approved', ...extra});
const payload = {version: 1, items: [
  news('old-approved', '2026-10-01'),
  news('newest-approved', '2026-10-30', { title: 'News <script>unsafe()</script>', region: 'Nova Scotia', correctionStatus: 'corrected' }),
  news('middle-approved', '2026-10-29', { source_type: 'newsroom', summaryKind: 'feed_description', summary: 'Copied feed description must not appear' }),
  news('third-approved', '2026-10-28', { source_type: 'library_notice' }),
  news('pending-hidden', '2026-10-31', { reviewStatus: 'pending' }),
  news('unsafe-link-hidden', '2026-10-31', { canonicalUrl: 'javascript:alert(1)' })
]};
const restaurants = Array.from({length: 5}, (_, i) => ({id: 'restaurant-' + i, name: 'Fixture place ' + i, score: 5 - i, cuisines: ['Fixture cuisine'], neighborhood: 'Halifax', inspections: [], specialLinks: [], hasOpening: i === 0}));
const context = vm.createContext({
  console, Date: FixedDate, Intl, URL, URLSearchParams, Set, Map, escapeHtml,
  window: null, appView: {innerHTML: ''}, globalSearch: null, searchForm: null,
  state: {saved: new Set(['restaurant-0']), query: 'Existing restaurant search'},
  activeRestaurants: restaurants, restaurants, structuredEvents: [],
  localStorage: {getItem: () => '[]', setItem() {}},
  location: {hash: '#home'}, history: {replaceState() {}},
  document: {body: {classList: {add() {}, remove() {}, contains() {return false;}}}, querySelectorAll: () => [], querySelector: () => null},
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
  requestAnimationFrame(callback) { callback(); },
  safeUrl: value => /^https:\/\//.test(value || '') ? value : '',
  unique: items => [...new Set(items)],
  countValues: items => [...items.reduce((counts, item) => counts.set(item, (counts.get(item) || 0) + 1), new Map())],
  officialSourceObservationStamp: () => '', permittedImageClass: () => '', mediaImageMarkup: () => '',
  bindCommonActions() {}, toast() {}, eventLeadItems: () => [],
  emptyPageState: message => '<p>' + escapeHtml(message) + '</p>',
  displayEventLabel: label => label,
});
context.window = context;
context.HALIFAX_NEWS = payload;
context.HALIFAX_CITY_EVENTS = {events, failures: [{sourceName: 'Held source', reason: 'robots_disallow'}]};
context.route = () => {
  const [name, query = ''] = context.location.hash.slice(1).split('?');
  return {name, params: new URLSearchParams(query)};
};
for (const file of ['app-news.js', 'app-home.js', 'app-events.js', 'app-event-pagination.js', 'app-event-date-fixes.js', 'app-event-local-sort-fixes.js']) {
  vm.runInContext(read(file), context, {filename: file});
}
const before = JSON.stringify({payload, events, restaurants});
context.renderHome();
const markup = context.appView.innerHTML;
const gateway = markup.match(/<nav class="home-browse-links"[^>]*>([\s\S]*?)<\/nav>/)[1];
const destinations = [...gateway.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(destinations, ['#events?when=today', '#events?when=weekend', '#events?category=Music', '#events?category=Markets', '#events?category=Festivals', '#explore', '#specials', '#news']);
assert(!gateway.includes('Tonight'), 'Do not label Today/evening as the distinct Tonight window');
assert(!gateway.includes('Live music'), 'Music category is broader than live music');
assert(markup.includes('Local stories.<br />Things to do.'));
assert(markup.indexOf("What's on next") < markup.indexOf('Featured restaurants'));
assert(markup.includes('data-home-openings'));
assert.equal((markup.match(/class="restaurant-card"/g) || []).length, 5);
assert(markup.includes('hero-mobile.webp'));
assert.equal((markup.match(/class="news-card"/g) || []).length, 3);
assert(markup.includes('<h3><a href="https://example.org/newest-approved"'));
assert(markup.includes('News &lt;script&gt;unsafe()&lt;/script&gt;'));
assert(!markup.includes('<script>'));
assert(!markup.includes('old-approved'));
assert(!markup.includes('pending-hidden'));
assert(!markup.includes('unsafe-link-hidden'));
assert(!markup.includes('Copied feed description'));
assert(!markup.includes('<img src="https://'));
assert(markup.indexOf('newest-approved') < markup.indexOf('middle-approved'));
for (const text of ['Official announcement', 'Journalism', 'Community notice', 'Nova Scotia', 'Fixture publisher', 'datetime="2026-10-30"', 'Read original', 'Corrected item', 'not a complete or live news service']) assert(markup.includes(text), text);
assert(!markup.includes('class="news-topics"'), 'Compact home cards omit topic chips, not provenance');
assert(context.newsCard(payload.items[0]).includes('<h2>'), 'Full news cards retain h2 headings');
assert(context.newsCard(payload.items[0]).includes('class="news-topics"'));
assert(!context.newsCard(payload.items[0], {headingLevel: 'script'}).includes('<script>'), 'Heading option cannot inject markup');

// Exercise the actual route parser, date windows and facets, not a second filter implementation.
for (const [hash, expected] of [
  ['#events?when=today', ['today-music']],
  ['#events?when=weekend', ['today-music', 'weekend-market', 'weekend-festival']],
  ['#events?category=Music', ['today-music', 'later-music']],
  ['#events?category=Markets', ['weekend-market']],
  ['#events?category=Festivals', ['weekend-festival']],
]) {
  context.location.hash = hash;
  context.syncCityEventStateFromRoute();
  const ids = vm.runInContext('filteredCityEvents(activeCityEvents().filter(isDiscoverableCityEvent)).map(event => event.id)', context);
  assert.deepEqual(Array.from(ids), expected, hash);
}
context.location.hash = '#home';
context.renderHome();
assert.equal(context.appView.innerHTML, markup, 'Repeated rendering adds no duplicate sections or stale event-route filters');
assert.equal(context.state.query, 'Existing restaurant search');
assert.deepEqual([...context.state.saved], ['restaurant-0']);
assert.equal(JSON.stringify({payload, events, restaurants}), before, 'Home cannot mutate accepted data, restaurants or event warnings');

for (const [replacement, expected] of [
  [undefined, 'News data is unavailable'],
  [{version: 2, items: []}, 'News data is unavailable'],
  [{version: 1, items: []}, 'No reviewed news items are available yet'],
  [{version: 1, items: [news('pending', '2026-10-30', {reviewStatus: 'pending'})]}, 'No reviewed news items are available yet'],
]) {
  context.HALIFAX_NEWS = replacement;
  const empty = context.homeNewsSection();
  assert(empty.includes(expected));
  assert(!empty.includes('class="news-card"'));
  assert(empty.includes('href="#news"'));
}
context.HALIFAX_NEWS = payload;
context.acceptedNewsItems = undefined;
assert(context.homeNewsSection().includes('News data is unavailable'));

const index = read('index.html');
assert(index.indexOf('app-news.js') < index.indexOf('app-home.js'));
for (const file of ['app-home.js', 'app-news.js']) assert(index.includes(file + '?v=20261028-news-archive-1'));
assert(index.includes('styles-pages.css?v=20261027-home-discovery-1'));
const css = read('styles-pages.css');
assert(css.includes('.home-browse-links{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))'));
assert(css.includes('@media(max-width:900px){.home-browse-links{grid-template-columns:repeat(2,minmax(0,1fr))}}'));
assert(css.includes('.category-ribbon.home-cuisine-ribbon{margin-top:0}'));
console.log('Home discovery passed: approved news/provenance, honest empty states, exact event deep links, source and saved-state preservation, stable repeated rendering, existing restaurant cards and bounded layout contract.');
