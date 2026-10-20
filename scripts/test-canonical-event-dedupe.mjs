import assert from 'node:assert/strict';
import {dedupeCanonicalEvents} from './lib/canonical-event-dedupe.mjs';
const game={id:'one',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-08T22:00:00Z',venueId:'scotiabank-centre-halifax',sourceId:'team',eventUrl:'https://team.example/game'};
const duplicate={...game,id:'two',title:'Halifax Mooseheads vs Rouyn-Noranda Huskies',sourceId:'venue',eventUrl:'https://venue.example/game'};
const events=dedupeCanonicalEvents([game,duplicate,{...game,id:'later',startAt:'2026-10-10T22:00:00Z'},{...game,id:'different',title:'Halifax Mooseheads vs Drummondville'},{...game,id:'concert',title:'Concert'}]);
assert.equal(events.length,4);assert.equal(events[0].sourceUrls.length,2);assert.deepEqual(events[0].duplicateEventIds,['two']);
assert.deepEqual(dedupeCanonicalEvents(events),events);
console.log('Canonical event regression passed: aliases deduplicate, provenance and distinct events survive.');

for (const [short, full] of [['Cape Breton', 'Cape Breton Eagles'], ['Charlottetown', 'Charlottetown Islanders'], ['Saint John', 'Saint John Sea Dogs']]) {
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
console.log('Additional canonical regression passed: three reported opponent aliases, provenance, dates and venues.');
