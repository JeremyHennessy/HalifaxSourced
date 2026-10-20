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
