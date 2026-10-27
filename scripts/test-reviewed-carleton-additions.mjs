import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { isReviewedUnpinnedLocation } from './lib/reviewed-event-locations.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const additions = JSON.parse(await read('data/build/city-event-additions.json'));
const additionsJs = await read('data/city-event-additions.js');
const accepted = JSON.parse(await read('data/build/city-events.json'));
const { corrections } = JSON.parse(await read('data/reviewed-event-locations.json'));
const urls = ['afterwords-the-world-we-long-for-nov2', 'an-evening-with-alan-cross']
  .map(slug => `https://www.thecarleton.ca/events/${slug}/`);
// A later accepted preview may already contain these occurrences. Test the
// missing-record path deliberately, without assuming the main snapshot stays old.
const acceptedFixture = { ...accepted, events: accepted.events.filter(event => !urls.includes(event.eventUrl)) };
const records = urls.map(url => additions.events.find(event => event.eventUrl === url));
assert(records.every(Boolean), 'Both bounded reviewed additions exist');
const ids = new Set(records.map(event => event.id));
const withoutNew = { ...additions, events: additions.events.filter(event => !ids.has(event.id)) };
assert.equal(additions.events.length - withoutNew.events.length, 2);

// Execute only pure helpers from production; never import/run the collector.
const importer = await read('scripts/import-city-events.mjs');
const helpers = vm.createContext({ createHash });
vm.runInContext(importer.slice(importer.indexOf('function atlanticOffset('), importer.indexOf('function parseHumanDateRange(')), helpers);
for (const name of ['hashId', 'sourceEventId']) {
  const declaration = importer.match(new RegExp(`^function ${name}[^\\n]+\\}$`, 'm'))?.[0]
    || importer.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm'))?.[0];
  assert(declaration);
  vm.runInContext(declaration, helpers);
}
for (const [index, event] of records.entries()) {
  const day = index ? 4 : 2;
  const date = { year: 2026, month: 11, day };
  assert.equal(event.startAt, helpers.localIso(date, index ? '7:00pm' : '1:00pm'));
  assert.equal(event.endAt, helpers.localIso(date, index ? '9:00pm' : '2:30pm'));
  assert.equal(event.id, helpers.sourceEventId({ id: 'the-carleton' }, event));
  assert.equal(event.sourceId, 'the-carleton');
  assert.equal(event.sourceKind, 'official_venue_calendar');
  assert.equal(event.sourceUrl, urls[index]);
  assert.equal(event.ticketUrl, null, 'Unvisited ticket destinations remain unknown');
  assert.equal(event.allDay, false);
  assert.equal(event.timeReview.derivedTimeZone, 'America/Halifax');
  assert.equal(event.timeReview.sourceDate, `2026-11-${String(day).padStart(2, '0')}`);
  assert.equal(event.timeReview.sourceStartTime, index ? '7:00pm' : '1:00pm');
  assert.equal(event.timeReview.sourceEndTime, index ? '9:00pm' : '2:30pm');
  assert.match(event.timeReview.basis, /derived.*existing application policy/);
  assert.equal(event.timeReview.reviewedAt, event.reviewedAt);
  const evidence = event.sourceEvidence.find(item => item.basis === 'official_primary');
  assert.equal(evidence.sourceUrl, event.eventUrl);
  assert.equal(evidence.observedAt, event.observedAt);
  assert.equal(evidence.reviewWindow.completedBy, event.observedAt);
  assert(Date.parse(evidence.reviewWindow.startedAt) <= Date.parse(event.observedAt));
  assert(Date.parse(event.observedAt) < Date.parse(event.reviewedAt));
  assert.equal(evidence.sourceCrawlAgeReported, index ? '2 days ago' : 'today');
  assert.equal(evidence.sourceCrawlTimestamp, null, 'Rounded cache age is not an exact publisher-fetch timestamp');
  assert.match(evidence.observationBasis, /Upper bound.*not an exact HTTP fetch timestamp/);
  for (const field of ['description', 'body', 'content', 'rawHtml', 'image', 'imageUrl', 'latitude', 'longitude']) {
    assert(!Object.hasOwn(event, field), `No invented/copied ${field}`);
  }
}
assert(isReviewedUnpinnedLocation(records[0], corrections));
assert.equal(records[0].price, '$8');
assert.equal(records[1].price, '$30 + HST');
assert.equal(records[1].venueName, 'The Carleton');
assert.equal(records[1].address, '1685 Argyle Street, Halifax, NS');
assert.equal(records[1].endAt, '2026-11-05T01:00:00.000Z');

function runtimeMerge(payload, script = additionsJs) {
  const context = vm.createContext({ window: { HALIFAX_CITY_EVENTS: structuredClone(payload) } });
  vm.runInContext(script, context);
  return JSON.parse(JSON.stringify(context.window.HALIFAX_CITY_EVENTS));
}
const definitionEnd = additionsJs.indexOf('`);') + 3;
const oldAdditionsJs = `window.HALIFAX_CITY_EVENT_ADDITIONS = ${JSON.stringify(withoutNew)};` + additionsJs.slice(definitionEnd);
const baselineRuntime = runtimeMerge(acceptedFixture, oldAdditionsJs);
const proposedRuntime = runtimeMerge(acceptedFixture);
assert.deepEqual(proposedRuntime.events.filter(event => !ids.has(event.id)), baselineRuntime.events,
  'New additions do not change existing runtime event records or their evidence clocks');
assert.equal(proposedRuntime.generatedAt, accepted.generatedAt);
const repeatedRuntime = runtimeMerge(proposedRuntime);
assert.deepEqual(repeatedRuntime.events, proposedRuntime.events, 'Repeated runtime addition is idempotent');

// Use the real app formatter/card, not a test formatter. The evening crosses UTC
// midnight but stays on November 4 in Halifax, including calendar end boundary.
const ui = vm.createContext({
  console, Date, Intl, URLSearchParams, setTimeout, clearTimeout,
  localStorage: { getItem() { return '[]'; } }, addEventListener() {}, searchForm: null, globalSearch: null,
  location: { hash: '#events' }, structuredEvents: [], restaurants: [],
  safeUrl(value) { return value || ''; }, escapeHtml(value) { return String(value ?? ''); }
});
ui.window = ui;
ui.HALIFAX_CITY_EVENTS = { events: records };
for (const file of ['app-events.js', 'app-event-pagination.js', 'app-event-date-fixes.js']) {
  vm.runInContext(await read(file), ui, { filename: file });
}
const display = vm.runInContext(`HALIFAX_CITY_EVENTS.events.map(event => ({
  label: structuredEventWhen(event), card: cityEventCard(event),
  startDay: __halifaxEventDateDebug.eventBoundaryKey(event, 'startAt'),
  endDay: __halifaxEventDateDebug.eventBoundaryKey(event, 'endAt')
}))`, ui);
for (const [index, item] of display.entries()) {
  const day = index ? '04' : '02';
  assert.equal(item.startDay, `2026-11-${day}`);
  assert.equal(item.endDay, `2026-11-${day}`);
  assert.match(item.label, index ? /Nov\s*4.*7:00.*p\.?m\.?/i : /Nov\s*2.*1:00.*p\.?m\.?/i);
  assert(item.card.includes(`href="${urls[index]}"`));
  assert(item.card.includes(records[index].venueName));
  assert(item.card.includes(records[index].price));
  assert(!item.card.includes('<img'), 'No publisher image is rendered');
}

const immutablePaths = ['data/build/city-events.json', 'data/city-events.js', 'data/build/city-event-additions.json',
  'data/city-event-additions.js', 'data/reviewed-event-locations.json', 'data/event-source-registry.json'];
const immutableBefore = await Promise.all(immutablePaths.map(read));
const root = await mkdtemp(join(tmpdir(), 'halifax-carleton-additions-test-'));
try {
  const scripts = ['export-catalog', 'apply-city-event-additions', 'sanitize-city-events',
    'resolve-city-event-entities', 'check-city-events', 'check-event-entity-resolution'];
  async function setup(name, reviewed) {
    const dir = join(root, name);
    await mkdir(join(dir, 'scripts'), { recursive: true });
    await cp(new URL('../data', import.meta.url), join(dir, 'data'), { recursive: true });
    await cp(new URL('./lib', import.meta.url), join(dir, 'scripts/lib'), { recursive: true });
    for (const file of [...scripts.map(script => `scripts/${script}.mjs`),
      'app-restaurant-identity.js', 'app-inspection-matching.js', 'restaurant-corrections.js']) {
      await copyFile(new URL('../' + file, import.meta.url), join(dir, file));
    }
    await writeFile(join(dir, 'data/build/city-event-additions.json'), JSON.stringify(reviewed));
    await writeFile(join(dir, 'data/build/city-events.json'), JSON.stringify(acceptedFixture));
    // Do not accidentally validate against a stale checked-in catalog.
    await rm(join(dir, 'data/build/catalog.json'), { force: true });
    run(dir, 'export-catalog');
    return dir;
  }
  function run(dir, script) {
    const result = spawnSync(process.execPath, ['--import', join(dir, 'scripts/lib/deny-source-network.mjs'),
      join(dir, `scripts/${script}.mjs`)], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}\n${result.stdout}`);
  }
  async function project(dir) {
    for (const script of scripts.slice(1)) run(dir, script);
    return JSON.parse(await readFile(join(dir, 'data/build/city-events.json'), 'utf8'));
  }
  const baselineDir = await setup('baseline', withoutNew);
  const proposedDir = await setup('proposed', additions);
  const baseline = await project(baselineDir);
  const proposed = await project(proposedDir);
  assert.equal(proposed.events.length, baseline.events.length + 2);
  assert.deepEqual(proposed.events.filter(event => !ids.has(event.id)), baseline.events,
    'The normal release projection leaves all other accepted event records/clocks unchanged');
  assert(isReviewedUnpinnedLocation(proposed.events.find(event => event.id === records[0].id), corrections));
  assert.deepEqual((await project(proposedDir)).events, proposed.events, 'Repeated release projection is idempotent');

  for (const changedTitle of [false, true]) {
    const fresh = records.map(event => ({ ...event,
      id: changedTitle ? event.id + '-fresh-title' : event.id,
      title: changedTitle ? 'Updated official title: ' + event.title : event.title,
      observedAt: '2026-10-28T12:00:00.000Z',
      venueName: 'The Carleton', address: '1685 Argyle Street, Halifax, NS',
      venueId: 'the-carleton-halifax', restaurantId: 'osm-node-771690675-the-carleton',
      latitude: 44.646, longitude: -63.574, neighbourhood: 'Downtown'
    }));
    const imported = { ...acceptedFixture, events: [...acceptedFixture.events, ...fresh] };
    const browser = runtimeMerge(imported);
    await writeFile(join(proposedDir, 'data/build/city-events.json'), JSON.stringify(imported));
    const projected = await project(proposedDir);
    for (const [index, reviewed] of records.entries()) {
      for (const payload of [browser, projected]) {
        const matches = payload.events.filter(event => event.eventUrl === reviewed.eventUrl && event.startAt === reviewed.startAt);
        assert.equal(matches.length, 1, 'A future reimport cannot duplicate the reviewed occurrence');
        assert.equal(matches[0].id, reviewed.id);
        assert.equal(matches[0].observedAt, fresh[index].observedAt, 'Fresh source observation remains fresh');
        assert.equal(matches[0].title, fresh[index].title);
        if (changedTitle) assert(matches[0].duplicateEventIds.includes(fresh[index].id));
      }
    }
    assert(isReviewedUnpinnedLocation(projected.events.find(event => event.id === records[0].id), corrections),
      'Final resolution removes a reimported organizer pin and wrong venue');
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
assert.deepEqual(await Promise.all(immutablePaths.map(read)), immutableBefore, 'Tests never rewrite accepted inputs');
console.log('Reviewed Carleton additions passed: derived times, cached-view provenance, local cards/source links, unchanged existing records/clocks, release order, idempotence and future-reimport dedupe/location.');
