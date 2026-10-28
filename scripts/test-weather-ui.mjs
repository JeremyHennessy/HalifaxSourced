import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../app-weather.js');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fixedNow = Date.parse('2026-10-28T00:50:00Z');
const timers = new Map(); let timerId = 0; let networkCalls = 0;
const context = {
  window: {}, Date, Intl, URL, escapeHtml, appView: { innerHTML: '' },
  document: { querySelector: () => null }, route: () => ({ name: 'weather' }),
  setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
  clearTimeout(id) { timers.delete(id); },
  fetch() { networkCalls++; throw Error('Weather UI must remain offline'); }
};
vm.createContext(context);
vm.runInContext(read('../weather-contract.js'), context);
vm.runInContext(read('../data/weather.js'), context);
vm.runInContext(source, context);
const data = context.window.HalifaxWeather;
const evaluated = context.window.HalifaxWeatherContract.evaluate(data, fixedNow);
const page = context.weatherPageMarkup(data, evaluated, fixedNow);
assert.match(page, /Recorded manual snapshot · no automatic refresh/);
assert.match(page, /Data Source: Environment and Climate Change Canada/);
assert.match(page, /data-service licence/i);
assert.match(page, /No warnings listed at the recorded check/);
assert.match(page, /not an all-HRM or all-hazards all-clear/);
assert.match(page, /Halifax Stanfield Int&#39;l Airport/);
assert.match(page, /Shearwater Airport/);
assert.equal((page.match(/id="weatherForecastHeading"/g) || []).length, 1);
assert.match(page, /not separate neighbourhood predictions/);
assert.match(page, /2026-10-27T19:00:00Z/);
assert.match(page, /2026-10-28T00:43:33\.585Z/);
assert.match(page, /Tuesday night/);
assert.doesNotMatch(page, />Tonight</, 'Do not move the publisher-relative period label to the viewing date');
assert.doesNotMatch(page, /0 ?mm/, 'No precipitation amount is available in the source contract');

assert.equal(context.weatherNumber(0.75, '%'), '0.75%');
assert.equal(context.weatherNumber(1, '%'), '1%');
assert.equal(context.weatherNumber(0, '°C'), '0°C');
for (const value of [null, undefined, NaN, Infinity, '', '1', false]) assert.equal(context.weatherNumber(value, '°C'), 'Not available');
assert.equal(context.weatherTime(null), 'Time unavailable');
assert.equal(context.weatherTime('not a date'), 'Time unavailable');
assert.match(context.weatherTime('2026-07-01T12:00:00Z'), /9:00:00.*ADT/);
assert.match(context.weatherTime('2026-12-01T12:00:00Z'), /8:00:00.*AST/);
const beforeFallback = context.weatherTime('2026-11-01T04:30:00Z');
const afterFallback = context.weatherTime('2026-11-01T05:30:00Z');
assert.match(beforeFallback, /1:30:00.*ADT/);
assert.match(afterFallback, /1:30:00.*AST/);
assert.notEqual(beforeFallback, afterFallback, 'Repeated fall-back hour must retain its zone');

const rows = [
  { validAt: '2026-10-28T00:00:00Z', temperatureC: -1, precipitationProbabilityPercent: 0.75, condition: 'Old hour' },
  { validAt: '2026-10-28T01:00:00Z', temperatureC: null, precipitationProbabilityPercent: 1, condition: 'Future hour' }
];
assert.doesNotMatch(context.weatherHourlyMarkup(rows, 'fresh', fixedNow), /Old hour/);
assert.match(context.weatherHourlyMarkup(rows, 'fresh', fixedNow), /Future hour/);
const staleRows = context.weatherHourlyMarkup(rows, 'stale', fixedNow);
assert.match(staleRows, /Old hour/);
assert.match(staleRows, /0\.75%/);
assert.match(staleRows, /Historical hourly forecast values — not a current forecast/);
assert.match(staleRows, /Not available/);
const old = context.window.HalifaxWeatherContract.evaluate(data, Date.parse('2026-10-29T04:00:00Z'));
const oldPage = context.weatherPageMarkup(data, old, Date.parse('2026-10-29T04:00:00Z'));
assert.match(oldPage, /This forecast is stale/);
assert.match(oldPage, /Historical reading retained for context; not current conditions/);
assert.match(oldPage, /Warning status unavailable/);
assert.doesNotMatch(oldPage, /No warnings listed at the recorded check/);
assert.match(oldPage, /2026-10-27T19:00:00Z/, 'Stale evidence retains original issue time');
const failed = structuredClone(data); failed.lastAttempt = { status: 'failed', attemptedAt: '2026-10-28T00:49:00Z', completedAt: '2026-10-28T00:49:10Z' };
const failedPage = context.weatherPageMarkup(failed, context.window.HalifaxWeatherContract.evaluate(failed, fixedNow), fixedNow);
assert.match(failedPage, /Latest request failed — previous data retained/);
assert.match(failedPage, /Warning status unavailable/);
assert.doesNotMatch(failedPage, /No warnings listed at the recorded check/);
const notice = context.weatherWarningMarkup({ status: 'notice', checkedAt: data.lastKnownGood.retrievedAt, sourceUpdatedAts: [], items: [{ text: '<script>Unsafe warning body</script>' }] });
assert.match(notice, /Official weather notice listed/);
assert.doesNotMatch(notice, /Unsafe warning body|No warnings/);
for (const status of [undefined, 'stale', 'unknown', 'fresh']) assert.match(context.weatherWarningMarkup({ status }), /Warning status unavailable/);
const noData = context.weatherPageMarkup(undefined, undefined, fixedNow);
assert.match(noData, /Regional forecast unavailable/);
assert.match(noData, /Station observations are unavailable/);
assert.doesNotMatch(noData, /No warnings listed/);

const malicious = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
const hostileForecast = { ...data.lastKnownGood.forecast, sourceUrl: 'javascript:alert(1)', periods: [{ publisherPeriodLabel: malicious, summary: malicious }], hourly: [{ validAt: '2026-10-28T01:00:00Z', condition: malicious, windDirection: malicious, temperatureC: malicious }] };
const escaped = context.weatherForecastMarkup({ status: 'fresh', data: hostileForecast }, fixedNow) + context.weatherObservationMarkup({ status: 'fresh', stationName: malicious, windDirection: malicious, sourceUrl: 'https://evil.example/collect', temperatureC: null });
assert.match(escaped, /&lt;script&gt;/);
assert.doesNotMatch(escaped, /<script>|<img|href="javascript:|evil\.example|NaN|undefined/);
assert.match(escaped, /Not available/);
assert.equal(context.weatherOfficialUrl('https://weather.gc.ca@evil.example/'), 'https://weather.gc.ca/en/location/index.html?coords=44.65,-63.6');
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|new\s+(?:WebSocket|Image)\s*\(/, 'No source transport in the browser weather module');
context.renderWeather(); assert.equal(timers.size, 1);
context.renderWeather(); assert.equal(timers.size, 1, 'Repeated render replaces its timer');
const queued = [...timers.values()][0]; assert.equal(queued.ms, 30000);
let renderedWrites = 0; let renderedMarkup = context.appView.innerHTML;
Object.defineProperty(context.appView, 'innerHTML', { get: () => renderedMarkup, set: value => { renderedWrites++; renderedMarkup = value; }, configurable: true });
timers.clear(); queued.callback();
assert.equal(renderedWrites, 0, 'Unchanged freshness must not rewrite the live region or disrupt focus');
assert.equal(timers.size, 1, 'Unchanged freshness schedules only one further check');
context.clearWeatherViewRefresh(); assert.equal(timers.size, 0);
assert.equal(networkCalls, 0);

const html = read('../index.html');
const desktopNav = html.match(/<nav class="desktop-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
assert.equal([...desktopNav.matchAll(/<a /g)].length, 7, 'Do not add an eighth desktop link');
assert.doesNotMatch(desktopNav, /#weather/);
assert.match(html, /<footer[\s\S]*href="#weather"/);
assert.match(html, /data-mobile-more-sheet[\s\S]*href="#weather"/);
for (const dependency of ['weather-contract.js', 'data/weather.js', 'app-core.js']) assert(html.indexOf(dependency) < html.indexOf('app-weather.js'));
assert(html.indexOf('app-weather.js') < html.indexOf('app-init.js'));
assert.match(html, /styles-weather\.css\?v=/);
const css = read('../styles-weather.css');
assert.doesNotMatch(css, /\.news-|\.desktop-nav|\.mobile-tabbar/, 'Weather CSS stays component-scoped');
assert.match(css, /overflow-x:auto/);

const core = read('../app-core.js');
const routeFunction = core.slice(core.indexOf('function renderRoute()'), core.indexOf('function updateNav('));
let weatherRenders = 0; let cleanups = 0;
const integrated = {
  state: { query: 'Cafe', cuisine: 'Seafood', page: 3, discoveryReturnHash: '#explore?q=Cafe&page=3' }, globalSearch: { value: '' }, restaurants: [],
  destroyMap() {}, updateNav() {}, clearWeatherViewRefresh() { cleanups++; },
  route: () => ({ name: 'weather', params: new URLSearchParams('q=do-not-overwrite&page=9') }),
  document: { querySelector: () => null }, window: { scrollTo() {} }, renderWeather() { weatherRenders++; }
};
vm.createContext(integrated); vm.runInContext(routeFunction, integrated); integrated.renderRoute();
assert.equal(integrated.state.query, 'Cafe'); assert.equal(integrated.state.cuisine, 'Seafood'); assert.equal(integrated.state.page, 3);
assert.equal(integrated.state.discoveryReturnHash, '#explore?q=Cafe&page=3'); assert.equal(integrated.globalSearch.value, 'Cafe');
assert.equal(integrated.document.title, 'Halifax weather | Halifax Sourced'); assert.equal(weatherRenders, 1); assert.equal(cleanups, 1);
console.log('Weather UI offline contract passed: timestamp/DST, fractional percentages/nulls, stale/failed warnings, safe text/links, one regional product, route state, local freshness timer and navigation.');
