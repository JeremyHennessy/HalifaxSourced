import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const receipts=JSON.parse(read('data/reviewed-hours-refresh.json'));
assert.equal(receipts.records.length,13);assert.equal(receipts.records.filter(r=>r.canonical).length,11);
const context={window:{},Intl,Date};vm.createContext(context);vm.runInContext(read('restaurant-corrections.js')+'\n'+read('data/reviewed-restaurant-corrections.js')+'\n'+read('app-hours.js'),context);
const records=JSON.parse(read('data/build/structured-place-facts.json')).records;
const applied=context.HalifaxRestaurantCorrections.applyFactFieldRejections(records,context.window.HALIFAX_RESTAURANT_CORRECTIONS);
for(const review of receipts.records.filter(r=>r.canonical)){
 const fact=applied.find(r=>r.restaurantId===review.restaurantId);assert(fact);
 if(review.decision==='replace_with_reviewed_hours'){assert.equal(JSON.stringify(fact.hours),JSON.stringify(review.hours));assert.equal(fact.hoursVerifiedAt,review.hoursVerifiedAt);}
 else assert.equal(fact.hours,null,review.restaurantId);
}
const spoon=applied.find(r=>r.restaurantId==='osm-node-3801119557-the-middle-spoon-desserterie-and-bar');
assert.equal(context.restaurantHoursState(spoon.hours,new Date('2026-10-23T02:30:00Z')).state,'open','Thursday 23:30 Halifax before midnight');
assert.equal(context.restaurantHoursState(spoon.hours,new Date('2026-10-25T04:00:00Z')).state,'open','Saturday carry into Sunday 01:00');
assert.equal(context.restaurantHoursState(spoon.hours,new Date('2026-10-25T15:00:00Z')).state,'unknown','Unlisted Sunday is not closed');
const bird=applied.find(r=>r.restaurantId==='osm-node-10038454787-bird-s-nest-cafe');
assert.equal(context.restaurantHoursState(bird.hours,new Date('2026-10-25T15:00:00Z')).state,'unknown');
console.log('Reviewed hours passed: 11 canonical dispositions, source-bound overrides, midnight carry and unknown days.');

const importer=read('scripts/import-structured-place-facts.mjs');
vm.runInContext(importer.slice(importer.indexOf('const DAY_MAP'),importer.indexOf('const reservationProviders'))+'\n'+importer.slice(importer.indexOf('function validTime'),importer.indexOf('function structuredAddress')),context);
const midnight=context.parseOpeningHoursSpecification({dayOfWeek:'Thursday',opens:'16:00',closes:'00:00'});assert.equal(midnight.thursday[0].overnight,true);assert.equal(midnight.sunday,null);
assert.equal(context.parseOpeningHoursSpecification([{dayOfWeek:'Monday',opens:'08:00',closes:'14:00'},{dayOfWeek:'Monday',opens:'08:00',closes:'13:45'}]),null,'Overlapping pickup/business intervals are ambiguous');
assert.equal(context.parseOpeningHoursSpecification({dayOfWeek:'Monday',opens:'00:00',closes:'00:00'}),null,'Equal times are not an invented all-day interval');

vm.runInContext(importer.slice(importer.indexOf('function structuredAddress'),importer.indexOf('function provider')),context);
assert(context.schemaLocationConflicts({address:{streetAddress:'1600 Bedford Highway'}},{address:'50 Tacoma Drive, Dartmouth'}));
assert(!context.schemaLocationConflicts({address:{streetAddress:'50 Tacoma Drive',addressLocality:'Dartmouth'}},{address:'50 Tacoma Dr, Dartmouth'}));

assert.equal(context.parseOpeningHoursSpecification([{dayOfWeek:'Monday',opens:'08:00',closes:'14:00'},{dayOfWeek:'Monday',opens:'17:00',closes:'late'}]),null,'A malformed interval cannot become a false closed interval');
assert.equal(context.parseOpeningHoursStrings(['Mo 08:00-14:00','Mo 17:00-late']),null);
assert.equal(context.normalizeTime('13 PM'),null);
