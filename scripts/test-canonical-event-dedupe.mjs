import assert from 'node:assert/strict';
import {dedupeCanonicalEvents} from './lib/canonical-event-dedupe.mjs';
const game={id:'one',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-08T22:00:00Z',venueId:'scotiabank-centre-halifax',sourceId:'team',eventUrl:'https://team.example/game'};
const duplicate={...game,id:'two',title:'Halifax Mooseheads vs Rouyn-Noranda Huskies',sourceId:'venue',eventUrl:'https://venue.example/game'};
const events=dedupeCanonicalEvents([game,duplicate,{...game,id:'later',startAt:'2026-10-10T22:00:00Z'},{...game,id:'different',title:'Halifax Mooseheads vs Drummondville'},{...game,id:'concert',title:'Concert'}]);
assert.equal(events.length,4);assert.equal(events[0].sourceUrls.length,2);assert.deepEqual(events[0].duplicateEventIds,['two']);
assert.deepEqual(dedupeCanonicalEvents(events),events);
console.log('Canonical event regression passed: aliases deduplicate, provenance and distinct events survive.');

for (const [short, full] of [['Baie-Comeau', 'Baie-Comeau Drakkar'], ['Chicoutimi', 'Chicoutimi Sagueneens'], ['Rimouski', 'Rimouski Oceanic'], ['Sherbrooke', 'Sherbrooke Phoenix'], ['Victoriaville', 'Victoriaville Tigres'], ['Cape Breton', 'Cape Breton Eagles'], ['Charlottetown', 'Charlottetown Islanders'], ['Saint John', 'Saint John Sea Dogs'], ['Quebec', 'Québec Remparts'], ['Moncton', 'Moncton Wildcats'], ['Moncton', 'Moncton Wildcats (Home Opener)'], ["Val-d'Or", "Val-d’Or Foreurs"], ['Shawinigan', 'Shawinigan Cataractes'], ['Newfoundland', 'Newfoundland Regiment'], ['Blainville-Boisbriand', 'Blainville-Boisbriand Armada'], ['Gatineau', 'Gatineau Olympiques']]) {
  const first = {...game, title:`Halifax Mooseheads vs ${short}`};
  const second = {...duplicate, title:`Halifax Mooseheads vs ${full}`};
  const result = dedupeCanonicalEvents([first, second]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceUrls.length, 2);
  assert.deepEqual(result[0].duplicateEventIds, ['two']);
  assert.equal(dedupeCanonicalEvents([first, {...second, startAt:'2026-10-09T22:00:00Z'}]).length, 2);
  assert.equal(dedupeCanonicalEvents([first, {...second, venueId:'different-venue'}]).length, 2);
  assert.deepEqual(dedupeCanonicalEvents(result), result);
}
assert.equal(dedupeCanonicalEvents([{...game,title:'Unrelated event'}, {...duplicate,title:'Unrelated event'}]).length,2);
console.log('Additional canonical regression passed: all paired opponent aliases observed in the source data, provenance, dates and venues.');

// Every same-time/venue Mooseheads pair in current source data must now resolve.
const { readFile } = await import('node:fs/promises');
const { createContext, Script } = await import('node:vm');
const context = createContext({ window: {} });
new Script(await readFile(new URL('../data/city-events.js', import.meta.url), 'utf8')).runInContext(context);
const sourceGames = context.window.HALIFAX_CITY_EVENTS.events.filter(event => /^Halifax Mooseheads vs /.test(event.title));
const groups = new Map();
for (const event of sourceGames) {
  const key = `${event.venueId || event.venueName}|${Date.parse(event.startAt)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(event);
}
let pairs = 0;
for (const group of groups.values()) if (group.length > 1) {
  pairs++;
  assert.equal(dedupeCanonicalEvents(group).length, 1, group.map(event => event.title).join(' / '));
}
// A refreshed source may already be deduplicated; zero pairs is valid.
assert.ok(sourceGames.length > 0, 'Source fixture must include game listings');
console.log(`All ${pairs} current source game pairs deduplicate without merging different dates or venues.`);

const library = {id:'old', sourceKind:'official_library_location_calendar', sourceId:'library', title:'Meet Juno Meet Juno', eventUrl:'https://halifax.bibliocommons.com/events/6a8ddc4657c264087ad3ac1b', startAt:'2026-10-21T21:30:00Z'};
assert.equal(dedupeCanonicalEvents([library,{...library,id:'fresh',title:'Meet Juno'}]).length,1);
assert.deepEqual(dedupeCanonicalEvents([library,{...library,id:'fresh'}])[0].duplicateEventIds,['fresh']);
assert.equal(dedupeCanonicalEvents([library,{...library,id:'other',startAt:'2026-10-22T21:30:00Z'}]).length,2);
assert.equal(dedupeCanonicalEvents([library,{...library,id:'other',eventUrl:'https://halifax.bibliocommons.com/events/abcdef'}]).length,2);

const bedfordPuppet = {
  id:'bedford-library-events-20781097868f48be',
  sourceKind:'official_library_location_calendar',
  sourceId:'bedford-library-events',
  title:'Puppet Show: Too Much Noise on Halloween Night',
  eventUrl:'https://halifax.bibliocommons.com/events/6a91b4bab204780029963a97',
  startAt:'2026-10-24T13:30:00.000Z'
};
const bedfordV2 = {
  ...bedfordPuppet,
  id:'halifax-public-libraries-current',
  sourceKind:'public_library_calendar',
  sourceId:'halifax-public-libraries',
  eventUrl:'https://halifax.bibliocommons.com/v2/events/6a91b4bab204780029963a97'
};
const bedfordRoutes = dedupeCanonicalEvents([bedfordPuppet, bedfordV2]);
assert.equal(bedfordRoutes.length, 1, 'BiblioCommons legacy and v2 routes identify one occurrence');
assert.equal(bedfordRoutes[0].id, bedfordPuppet.id, 'Published event identity remains the owner');
assert.deepEqual(bedfordRoutes[0].duplicateEventIds, [bedfordV2.id]);
assert.equal(dedupeCanonicalEvents([bedfordPuppet, {...bedfordV2, eventUrl:'https://halifax.bibliocommons.com/v2/events/6a91b4bab204780029963a98'}]).length, 2, 'Different BiblioCommons detail IDs remain distinct');

// A title cleanup must not invalidate saves keyed to the published occurrence ID.
const publishedJunoId = 'alderney-gate-library-events-dd528c059fc415a5';
const cleanedJunoAlias = 'alderney-gate-library-events-ec0ca632d4bf24a5';
const junoOccurrence = context.window.HALIFAX_CITY_EVENTS.events.find(event =>
  [event.id, ...(event.duplicateEventIds || [])].includes(publishedJunoId));
if (junoOccurrence) {
  assert.equal(junoOccurrence.id, publishedJunoId, 'Preserve published saved-event identity');
  assert.equal(junoOccurrence.title, 'Meet Juno, a St. John Ambulance Therapy Dog');
  assert.ok(junoOccurrence.duplicateEventIds.includes(cleanedJunoAlias));
  const sanitized = dedupeCanonicalEvents(JSON.parse(JSON.stringify([junoOccurrence])));
  assert.equal(sanitized[0].id, publishedJunoId, 'Release sanitation preserves published identity');
}
