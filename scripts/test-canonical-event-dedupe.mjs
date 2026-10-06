import assert from 'node:assert/strict';
import {dedupeCanonicalEvents} from './lib/canonical-event-dedupe.mjs';
const game={id:'one',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-08T22:00:00Z',venueId:'scotiabank-centre-halifax',sourceId:'team',eventUrl:'https://team.example/game'};
const duplicate={...game,id:'two',title:'Halifax Mooseheads vs Rouyn-Noranda Huskies',sourceId:'venue',eventUrl:'https://venue.example/game'};
const events=dedupeCanonicalEvents([game,duplicate,{...game,id:'later',startAt:'2026-10-10T22:00:00Z'},{...game,id:'different',title:'Halifax Mooseheads vs Drummondville'},{...game,id:'concert',title:'Concert'}]);
assert.equal(events.length,4);assert.equal(events[0].sourceUrls.length,2);assert.deepEqual(events[0].duplicateEventIds,['two']);
assert.deepEqual(dedupeCanonicalEvents(events),events);
console.log('Canonical event regression passed: aliases deduplicate, provenance and distinct events survive.');
