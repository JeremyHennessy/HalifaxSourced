import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyReviewedEventLocation, isReviewedUnpinnedLocation, validEventCoordinates } from './lib/reviewed-event-locations.mjs';
import { preservePublishedEventIds } from './lib/canonical-event-dedupe.mjs';
const { corrections } = JSON.parse(await readFile(new URL('../data/reviewed-event-locations.json', import.meta.url), 'utf8'));
const correction = corrections[0];
const original = { id:'published', duplicateEventIds:['saved-alias'], title:'PD Day: Halloween Haunt Party', eventUrl:correction.eventUrl, startAt:correction.startAt, endAt:correction.endAt, sourceKind:'official_library_location_calendar', sourceId:'bedford-library-events', sourceName:'Bedford Public Library', sourceUrl:'https://www.halifaxpubliclibraries.ca/locations/bedford-public-library/', city:'Bedford', venueName:'Bedford Public Library', address:'15 Dartmouth Road, Bedford', venueId:'bedford-library', latitude:44.7314, longitude:-63.6571, neighbourhood:'branch', restaurantId:'stale', observedAt:'2026-10-21T18:35:10.942Z', categories:['Community'] };
const event = structuredClone(original);
assert(applyReviewedEventLocation(event, corrections));
assert(isReviewedUnpinnedLocation(event, corrections));
assert.equal(event.id, original.id); assert.deepEqual(event.duplicateEventIds,original.duplicateEventIds); assert.equal(event.observedAt,original.observedAt);
const first = structuredClone(event); applyReviewedEventLocation(event,corrections); assert.deepEqual(event,first);
assert.equal(preservePublishedEventIds([{...event,id:'new-import'}],[original])[0].id,'published');
for(const changed of [{startAt:'2026-10-24T13:00:00.000Z'},{endAt:'2026-10-23T16:00:00.000Z'},{eventUrl:correction.eventUrl+'0'},{sourceKind:'untrusted'}]) {
  const other={...original,...changed};assert.equal(applyReviewedEventLocation(other,corrections),false);assert.deepEqual(other,{...original,...changed});
}
assert(!validEventCoordinates({latitude:null,longitude:null}));assert(!validEventCoordinates({latitude:91,longitude:0}));assert(validEventCoordinates(original));
const root=await mkdtemp(join(tmpdir(),'halifax-reviewed-event-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const path of ['scripts/resolve-city-event-entities.mjs','scripts/check-city-events.mjs','scripts/lib/reviewed-event-locations.mjs','data/reviewed-event-locations.json'])await copyFile(new URL('../'+path,import.meta.url),join(root,path));
  await writeFile(join(root,'data','venue-registry.json'),JSON.stringify({venues:[{venueId:'bedford-library',name:'Bedford Public Library',sourceIds:['bedford-library-events']}]}));
  await writeFile(join(root,'data','organizer-registry.json'),JSON.stringify({organizers:[]}));
  await writeFile(join(root,'data','build','catalog.json'),JSON.stringify({restaurants:[]}));
  await writeFile(join(root,'data','build','city-events.json'),JSON.stringify({events:[original]}));
  function run(script,pass=true){const result=spawnSync(process.execPath,[join(root,'scripts',script)],{encoding:'utf8'});assert.equal(result.status,pass?0:1,result.stderr+result.stdout);}
  run('resolve-city-event-entities.mjs');run('resolve-city-event-entities.mjs');run('check-city-events.mjs');
  const payload=JSON.parse(await readFile(join(root,'data','build','city-events.json'),'utf8'));assert.deepEqual(payload.events[0],first);
  for(const bad of [{...first,latitude:original.latitude,longitude:original.longitude},{...first,venueId:'bedford-library'},{...first,id:'other',eventUrl:correction.eventUrl+'0'}]) {
    await writeFile(join(root,'data','city-events.js'),'window.HALIFAX_CITY_EVENTS = '+JSON.stringify({events:[bad]})+';');run('check-city-events.mjs',false);
  }
} finally {await rm(root,{recursive:true,force:true});}
console.log('Reviewed event location regression passed: repeat/reimport, exact occurrence, no stale pin, strict gate, identity and aliases retained.');
