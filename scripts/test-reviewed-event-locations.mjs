import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { applyReviewedEventLocation, isReviewedUnpinnedLocation, validEventCoordinates } from './lib/reviewed-event-locations.mjs';
import { preservePublishedEventIds } from './lib/canonical-event-dedupe.mjs';

const { corrections } = JSON.parse(await readFile(new URL('../data/reviewed-event-locations.json', import.meta.url), 'utf8'));
const libraryCorrection = corrections.find(item => item.venueName === 'Scott Manor House');
const venueCorrection = corrections.find(item => item.sourceId === 'the-carleton');
assert(libraryCorrection && venueCorrection);

// Derive the reviewed occurrence using the production Halifax local-time policy,
// without running the collector or claiming the source printed UTC/a timezone.
const importer = await readFile(new URL('./import-city-events.mjs', import.meta.url), 'utf8');
const localTime = vm.createContext({});
vm.runInContext(importer.slice(importer.indexOf('function atlanticOffset('), importer.indexOf('function parseHumanDateRange(')), localTime);
assert.equal(venueCorrection.startAt, localTime.localIso({ year: 2026, month: 11, day: 2 }, '1:00pm'));
assert.equal(venueCorrection.endAt, localTime.localIso({ year: 2026, month: 11, day: 2 }, '2:30pm'));
assert.equal(venueCorrection.startAt, '2026-11-02T17:00:00.000Z');
assert.equal(venueCorrection.endAt, '2026-11-02T18:30:00.000Z');
assert.equal(venueCorrection.sourceKind, 'official_venue_calendar');
assert.equal(venueCorrection.eventUrl, 'https://www.thecarleton.ca/events/afterwords-the-world-we-long-for-nov2/');
assert.equal(venueCorrection.sourceUrl, venueCorrection.eventUrl);

const libraryOriginal = {
  id: 'published', duplicateEventIds: ['saved-alias'], title: 'PD Day: Halloween Haunt Party',
  eventUrl: libraryCorrection.eventUrl, startAt: libraryCorrection.startAt, endAt: libraryCorrection.endAt,
  sourceKind: 'official_library_location_calendar', sourceId: 'bedford-library-events',
  sourceName: 'Bedford Public Library', sourceUrl: 'https://www.halifaxpubliclibraries.ca/locations/bedford-public-library/',
  city: 'Bedford', venueName: 'Bedford Public Library', address: '15 Dartmouth Road, Bedford',
  venueId: 'bedford-library', latitude: 44.7314, longitude: -63.6571, neighbourhood: 'branch', restaurantId: 'stale',
  observedAt: '2026-10-21T18:35:10.942Z', categories: ['Community']
};
// Synthetic import fixture only: this event is not added to the accepted dataset.
const venueOriginal = {
  id: 'carleton-import-id', duplicateEventIds: ['carleton-saved-alias'], title: 'AfterWords: The World We Long For',
  eventUrl: venueCorrection.eventUrl, startAt: venueCorrection.startAt, endAt: venueCorrection.endAt,
  sourceKind: 'official_venue_calendar', sourceId: 'the-carleton', sourceName: 'The Carleton',
  sourceUrl: venueCorrection.eventUrl, city: 'Halifax', venueName: 'The Carleton', address: '1685 Argyle Street',
  venueId: 'the-carleton', latitude: 44.646, longitude: -63.574, neighbourhood: 'Downtown Halifax', restaurantId: 'carleton-restaurant',
  observedAt: '2026-10-25T12:00:00.000Z', fetchedAt: '2026-10-25T12:00:00.000Z',
  lastAttemptAt: '2026-10-25T12:00:00.000Z', categories: ['Arts']
};
const locationKeys = ['latitude', 'longitude', 'venueId', 'neighbourhood', 'restaurantId'];
function corrected(original, correction) {
  const expected = {
    ...structuredClone(original), venueName: correction.venueName, address: correction.address, city: correction.city,
    locationReview: {
      sourceUrl: correction.sourceUrl, reviewedAt: correction.reviewedAt,
      coordinateStatus: correction === venueCorrection ? 'unverified_offsite_venue_location' : 'unverified_non_branch_location'
    }
  };
  for (const key of locationKeys) delete expected[key];
  return expected;
}
const originals = [libraryOriginal, venueOriginal];
const expected = [corrected(libraryOriginal, libraryCorrection), corrected(venueOriginal, venueCorrection)];
for (const [index, original] of originals.entries()) {
  const event = structuredClone(original);
  assert(applyReviewedEventLocation(event, corrections));
  assert(isReviewedUnpinnedLocation(event, corrections));
  assert.deepEqual(event, expected[index], 'Only location fields/review may change; identity, aliases and observation clocks survive');
  assert(applyReviewedEventLocation(event, corrections));
  assert.deepEqual(event, expected[index], 'Repeated review application is idempotent');
  for (const change of [
    { startAt: '2026-11-03T17:00:00.000Z' }, { endAt: '2026-11-02T19:30:00.000Z' },
    { startAt: undefined }, { endAt: null }, { eventUrl: original.eventUrl + '0' },
    { eventUrl: original.eventUrl + '?ref=other' }, { eventUrl: undefined }, { sourceKind: 'untrusted' }
  ]) {
    const other = { ...original, ...change };
    assert.equal(applyReviewedEventLocation(other, corrections), false);
    assert.equal(isReviewedUnpinnedLocation(other, corrections), false);
    assert.deepEqual(other, { ...original, ...change }, 'Rejected occurrences remain untouched');
  }
}
assert.equal(preservePublishedEventIds([{ ...expected[0], id: 'new-import' }], [libraryOriginal])[0].id, 'published');
for (const sourceKind of ['official_library_location_calendar', 'public_library_calendar']) {
  const library = { ...libraryOriginal, sourceKind, sourceId: 'another-library-calendar' };
  assert(applyReviewedEventLocation(library, corrections), 'Legacy library correction still covers both library kinds, regardless of source ID');
  assert.equal(library.locationReview.coordinateStatus, 'unverified_non_branch_location');
  const venueAsLibrary = { ...venueOriginal, sourceKind };
  assert.equal(applyReviewedEventLocation(venueAsLibrary, corrections), false, 'Explicit venue scope cannot match a library event');
}
for (const change of [
  { sourceId: 'another-venue' }, { sourceId: 'the-carleton-extra' }, { sourceId: undefined },
  { sourceId: undefined, source: { id: 'the-carleton' } }, { sourceKind: 'official_arts_calendar' }
]) {
  const other = { ...venueOriginal, ...change };
  assert.equal(applyReviewedEventLocation(other, corrections), false);
  assert.deepEqual(other, { ...venueOriginal, ...change });
}
for (const change of [{ sourceId: undefined }, { sourceId: 'another-venue' }, { sourceKind: undefined }, { sourceKind: 'public_library_calendar' }]) {
  const other = structuredClone(venueOriginal);
  assert.equal(applyReviewedEventLocation(other, [{ ...venueCorrection, ...change }]), false, 'Venue corrections require both explicit source scope fields');
  assert.deepEqual(other, venueOriginal);
}
assert.equal(applyReviewedEventLocation({ ...libraryOriginal, sourceKind: 'official_venue_calendar', sourceId: 'the-carleton' }, corrections), false,
  'Legacy library corrections cannot apply to official venue events');
assert(!validEventCoordinates({ latitude: null, longitude: null }));
assert(!validEventCoordinates({ latitude: 91, longitude: 0 }));
assert(validEventCoordinates(libraryOriginal));

const root = await mkdtemp(join(tmpdir(), 'halifax-reviewed-event-'));
try {
  await mkdir(join(root, 'scripts', 'lib'), { recursive: true });
  await mkdir(join(root, 'data', 'build'), { recursive: true });
  for (const path of ['scripts/resolve-city-event-entities.mjs', 'scripts/check-city-events.mjs', 'scripts/check-event-entity-resolution.mjs', 'scripts/lib/reviewed-event-locations.mjs', 'data/reviewed-event-locations.json']) {
    await copyFile(new URL('../' + path, import.meta.url), join(root, path));
  }
  await writeFile(join(root, 'data', 'venue-registry.json'), JSON.stringify({ venues: [
    { venueId: 'bedford-library', name: 'Bedford Public Library', sourceIds: ['bedford-library-events'] },
    { venueId: 'the-carleton', name: 'The Carleton', sourceIds: ['the-carleton'], address: '1685 Argyle Street' },
    { venueId: 'stardust-unreviewed', name: venueCorrection.venueName, sourceIds: [], address: venueCorrection.address }
  ] }));
  await writeFile(join(root, 'data', 'organizer-registry.json'), JSON.stringify({ organizers: [] }));
  await writeFile(join(root, 'data', 'build', 'catalog.json'), JSON.stringify({ restaurants: [
    { id: 'carleton-restaurant', name: 'The Carleton', address: '1685 Argyle Street' },
    { id: 'stardust-unreviewed-restaurant', name: venueCorrection.venueName, address: venueCorrection.address }
  ] }));
  function run(script, pass = true) {
    const result = spawnSync(process.execPath, [join(root, 'scripts', script)], { encoding: 'utf8' });
    assert.equal(result.status, pass ? 0 : 1, result.stderr + result.stdout);
  }
  // Reimport restores the organizer's stale location fields; every resolver pass
  // must remove them again without refreshing observation clocks or event IDs.
  for (const imported of [originals, originals.map(event => ({ ...event, observedAt: '2026-10-26T12:00:00.000Z' }))]) {
    await writeFile(join(root, 'data', 'build', 'city-events.json'), JSON.stringify({ events: imported }));
    for (let pass = 0; pass < 2; pass += 1) {
      run('resolve-city-event-entities.mjs');
      run('check-city-events.mjs');
      run('check-event-entity-resolution.mjs');
      const payload = JSON.parse(await readFile(join(root, 'data', 'build', 'city-events.json'), 'utf8'));
      assert.deepEqual(payload.events, [corrected(imported[0], libraryCorrection), corrected(imported[1], venueCorrection)]);
      const resolution = JSON.parse(await readFile(join(root, 'data', 'build', 'event-entity-resolution.json'), 'utf8'));
      assert.equal(resolution.venueResolved, 0, 'No organizer pin or unreviewed Stardust association may be reattached');
      assert.equal(resolution.restaurantResolved, 0);
    }
  }
  for (const [index, event] of expected.entries()) {
    for (const bad of [
      ...locationKeys.map(key => ({ ...event, [key]: originals[index][key] })),
      { ...event, venueName: originals[index].venueName }, { ...event, address: originals[index].address },
      { ...event, locationReview: { ...event.locationReview, coordinateStatus: 'verified' } }
    ]) {
      assert(!isReviewedUnpinnedLocation(bad, corrections));
      await writeFile(join(root, 'data', 'city-events.js'), 'window.HALIFAX_CITY_EVENTS = ' + JSON.stringify({ events: [bad] }) + ';');
      run('check-city-events.mjs', false);
    }
  }
  // Existing strict regional-coordinate gate must not accept an unrelated URL.
  await writeFile(join(root, 'data', 'city-events.js'), 'window.HALIFAX_CITY_EVENTS = ' + JSON.stringify({ events: [{ ...expected[0], id: 'other', eventUrl: libraryCorrection.eventUrl + '0' }] }) + ';');
  run('check-city-events.mjs', false);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Reviewed event locations passed: library compatibility; exact Carleton source/kind/URL/time scope; Halifax-derived occurrence; repeat/reimport; stale association removal; strict gates; unchanged identities and clocks.');
