import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { preservePublishedEventIds, dedupeCanonicalEvents } from './lib/canonical-event-dedupe.mjs';
import { reconcileFutureEventLosses } from './lib/event-refresh-safety.mjs';

const old = {id:'published', title:'Meet Juno Meet Juno', sourceKind:'official_library_location_calendar', sourceId:'library', eventUrl:'https://halifax.bibliocommons.com/events/6a8ddc4657c264087ad3ac1b', sourceUrl:'https://halifax.bibliocommons.com/events/6a8ddc4657c264087ad3ac1b', startAt:'2026-10-21T21:30:00Z', endAt:'2026-10-21T22:30:00Z', observedAt:'2026-10-20T12:00:00Z', duplicateEventIds:['historical-alias']};
const fresh = {...old, id:'new-title-hash',title:'Meet Juno', observedAt:'2026-10-21T12:00:00Z',duplicateEventIds:[]};
const untouchedOld = structuredClone(old), untouchedFresh = structuredClone(fresh);
for (const records of [[fresh], [fresh,{...fresh,id:'second-source'}], [{...fresh,id:'second-source'},fresh]]) {
  const result = preservePublishedEventIds(records,[old]);
  assert.equal(result.length,1);
  assert.equal(result[0].id,old.id);
  assert.equal(result[0].title,fresh.title);
  assert.equal(result[0].observedAt,fresh.observedAt,'Never replace fresh evidence clock');
  assert(result[0].duplicateEventIds.includes('new-title-hash'));
  assert(result[0].duplicateEventIds.includes('historical-alias'));
  assert(!result[0].duplicateEventIds.includes(old.id));
  assert.deepEqual(preservePublishedEventIds(result,[old]),result,'Repeated refresh is idempotent');
  assert.deepEqual(dedupeCanonicalEvents(result),result,'Release sanitation keeps ID');
}
assert.deepEqual(old,untouchedOld);assert.deepEqual(fresh,untouchedFresh);
for (const distinct of [{...fresh,startAt:'2026-10-22T21:30:00Z'}, {...fresh,eventUrl:'https://halifax.bibliocommons.com/events/abcdef'}, {...fresh,eventUrl:'https://halifax.bibliocommons.com/events'}, {...fresh,sourceKind:'unqualified'}]) {
  assert.equal(preservePublishedEventIds([distinct],[old])[0].id,distinct.id,'Distinct/unqualified events never borrow identity');
}
assert.throws(()=>preservePublishedEventIds([fresh],[old,{...old,id:'ambiguous'}]),/Ambiguous/);
assert.throws(()=>preservePublishedEventIds([fresh,{id:'other',duplicateEventIds:['published']}],[old]),/Conflicting/);
const sports = {id:'published-game',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-22T22:00:00Z',venueId:'scotiabank-centre-halifax'};
assert.equal(preservePublishedEventIds([{...sports,id:'fresh-game',title:'Halifax Mooseheads vs Rouyn-Noranda Huskies'}],[sports])[0].id,sports.id);
assert.equal(preservePublishedEventIds([{...sports,id:'other-venue',venueId:'different'}],[sports])[0].id,'other-venue');
const reconciled = reconcileFutureEventLosses({events:[fresh],sourceStats:[]},{events:[old]}, {now:Date.parse('2026-10-21T23:00:00Z')});
assert.equal(reconciled.payload.events[0].id,old.id,'Actual refresh path preserves ID even after occurrence ends');
assert.equal(reconcileFutureEventLosses({events:[],sourceStats:[]},{events:[old]}, {now:Date.parse('2026-10-21T23:00:00Z')}).payload.events.length,0,'No expired resurrection');

// Retained failed-source rows must not collide with fresh rows after reconciliation.
const futureOld = {...old, id:'prior-owner',duplicateEventIds:['collision'],startAt:'2026-10-22T21:30:00Z',endAt:'2026-10-22T22:30:00Z'};
assert.throws(()=>reconcileFutureEventLosses({events:[{...fresh,id:'collision',eventUrl:'https://halifax.bibliocommons.com/events/abcdef'}],sourceStats:[{sourceId:'library',status:'failed'}]},{events:[futureOld]}, {now:Date.parse('2026-10-21T23:00:00Z')}),/Conflicting event identity/);

// Exercise the exact browser helpers with disposable localStorage and events.
const source = await readFile(new URL('../app-event-pagination.js',import.meta.url),'utf8');
const helperSource = source.slice(source.indexOf('function readSavedCityEvents()'),source.indexOf('function persistSavedCityEvents()'));
let stored = JSON.stringify(['historical-alias','published','missing','ambiguous']);
const context = vm.createContext({cityEvents:[{id:'published',duplicateEventIds:['historical-alias','ambiguous']},{id:'other',duplicateEventIds:['ambiguous']},{id:'historical-alias-canonical',duplicateEventIds:['published']}],CITY_EVENT_SAVED_KEY:'test',localStorage:{getItem(){return stored;},setItem(){throw Error('Read must not write');}}});
vm.runInContext(helperSource,context);
assert.deepEqual([...vm.runInContext('readSavedCityEvents()',context)],['published','missing','ambiguous'],'Unique aliases resolve once; canonical precedence and ambiguous/unknown saves survive');
stored='{';assert.equal(vm.runInContext('readSavedCityEvents().size',context),0);
stored='null';assert.equal(vm.runInContext('readSavedCityEvents().size',context),0);
stored=JSON.stringify(['historical-alias']);
vm.runInContext('const saved = readSavedCityEvents(); saved.delete("published");',context);
assert.equal(vm.runInContext('saved.size',context),0,'Unsave canonical ID removes migrated alias save');

const workflow = await readFile(new URL('../.github/workflows/city-events-preview.yml',import.meta.url),'utf8');
const prJob = workflow.split('  validate-pr:\n')[1]?.split('  refresh-events:\n')[0];
assert(prJob?.includes("github.event_name == 'pull_request'"));
assert(prJob.includes('deny-source-network.mjs'));
assert(!/import-city-events|import-supplemental|upload-artifact/.test(prJob),'PR must not collect or upload previews');
assert(workflow.includes("github.event_name != 'pull_request'"));
assert(workflow.indexOf('Verify saved-event continuity before preview upload') < workflow.indexOf('Upload city event preview'));
assert(workflow.includes('23 */6 * * *'));
console.log('Event identity continuity passed: source/title ordering, repeated refresh, unique occurrence matching, collision hold, saved alias migration, expiry and offline PR/preview gates.');
