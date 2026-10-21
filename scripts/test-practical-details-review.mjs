import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import corrections from '../restaurant-corrections.js';
import integrity from '../source-integrity.js';
import {reviewedCorrections} from './lib/reviewed-corrections.mjs';
const micId='osm-node-1254843900-the-mic-mac-bar-and-grill', tibsId='osm-node-4420631892-two-if-by-sea';
const audit=JSON.parse(await readFile(new URL('../data/audit/practical-details-review-2026-10-20.json',import.meta.url)));
for(const r of audit.records) {assert.equal(r.receipt.status,200);assert.match(r.receipt.sha256,/^[a-f0-9]{64}$/);assert(r.receipt.fetchedAt);}
const records=[{id:micId,address:'219 Waverley Road',openingHours:null},{id:tibsId,website:'https://twoifbyseacafe.ca/',operatingStatus:'active'}];
corrections.apply(records,reviewedCorrections);
assert.equal(records[0].address,'219 Waverley Road, Dartmouth, NS B2X 2C3');
assert.equal(records[1].website,null);assert.equal(records[1].operatingStatus,'active','Bad web destination does not close business');
const previous={restaurantId:micId,hours:null,observedAt:'2026-09-04T13:24:17.752Z'};
const [facts]=corrections.applyFactFieldRejections([previous],reviewedCorrections);
assert.equal(facts.observedAt,previous.observedAt,'Hours review cannot rejuvenate other retained source facts');
assert.equal(facts.hoursVerifiedAt,audit.records.find(r=>r.restaurantId===micId).receipt.fetchedAt);
const c=vm.createContext({Intl,Date});vm.runInContext(await readFile(new URL('../app-hours.js',import.meta.url),'utf8'),c);c.hours=facts.hours;
assert.equal(vm.runInContext("restaurantHoursState(hours,new Date('2026-10-20T18:59:00Z')).state",c),'closed');
assert.equal(vm.runInContext("restaurantHoursState(hours,new Date('2026-10-20T19:00:00Z')).state",c),'open');
assert.equal(vm.runInContext("restaurantHoursState(hours,new Date('2026-10-21T00:00:00Z')).state",c),'closed');
assert.equal(integrity.safeSource('https://twoifbyseacafe.ca/'),false);
const context=vm.createContext({window:{},document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem:()=>{}},console,URL,Date,Intl,Set,Map});
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
for(const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)){
 const file=match[1];if(file.startsWith('vendor/'))continue;
 vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file,timeout:60000});
 if(file==='app-lifecycle.js')break;
}
const app=JSON.parse(vm.runInContext('JSON.stringify(restaurants)',context));
const mic=app.find(r=>r.id===micId),tibs=app.find(r=>r.id===tibsId);
assert.equal(mic.structuredHours.tuesday[0].open,'16:00');assert.equal(mic.address,records[0].address);
assert.equal(tibs.website,null);assert(!['moved','replaced','permanently_closed'].includes(tibs.operatingStatus));
for(const list of [tibs.menuLinks,tibs.relatedLinks,tibs.reservationLinks,tibs.orderingLinks]) for(const link of list||[]) assert(!String(link.url).includes('twoifbyseacafe.ca'));
console.log('Practical-details review passed: source receipts, Mic Mac hours boundaries, untouched evidence clocks, exact address and wrong-domain/lifecycle isolation.');
// Actual published photo metadata is rendered with source, license and age disclosure.
vm.runInContext(await readFile(new URL('../app-media.js',import.meta.url),'utf8'),context);
const credit=vm.runInContext("mediaAttributionMarkup(restaurants.find(r=>r.id==='osm-way-671922221-mckelvie-s'))",context);
assert.match(credit,/Properpostman/);assert.match(credit,/class="media-license" href="https:\/\/creativecommons.org\/licenses\/by-sa\/4.0\/"/);
assert.match(credit,/Photographed April 2023/);assert.match(credit,/otherwise unchanged/);
const fourth=app.find(r=>r.id==='the-fourth-lock-fall-river');assert(fourth);assert.equal(fourth.phone,null);assert.equal(fourth.openingHours,null);assert.equal(fourth.coordinates.lat,44.8107358);assert(fourth.menuLinks.some(x=>x.url.includes('6c26fd8387e74fb8bc525f7654507433.pdf')));
const picnic=app.find(r=>r.id==='labour-day-picnic-cafe-glen-haven');assert(picnic);assert.equal(picnic.coordinates,null);assert.equal(picnic.openingHours,null);assert.equal(picnic.phone,'902-821-2133');
console.log('New locations preserve uncertain fields; dated McKelvie photo renders creator, direct license, and modification disclosure.');

assert.equal(tibs.hasReservation,false);assert.deepEqual(tibs.structuredFeatures,[]);
