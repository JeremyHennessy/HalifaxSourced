import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
import { localRestaurantPolicyDecision } from './lib/local-restaurant-policy.mjs';
import { reviewedCorrections, applyReviewedCorrections } from './lib/reviewed-corrections.mjs';
const root = new URL('../', import.meta.url);
const context = vm.createContext({window:{}, document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem:()=>{}}, console, URL, Date, Intl, Set, Map});
const html = await readFile(new URL('index.html',root),'utf8');
for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^\"]*"><\/script>/g)) {
  const file = match[1]; if (file.startsWith('vendor/')) continue;
  vm.runInContext(await readFile(new URL(file,root),'utf8'),context,{filename:file,timeout:60000});
  if (file === 'app-lifecycle.js') break;
}
const app = JSON.parse(vm.runInContext('JSON.stringify({restaurants,active:activeRestaurants.map(item=>item.id)})',context));
const catalog = JSON.parse(await readFile(new URL('data/build/catalog.json',root)));
assert.deepEqual(app.restaurants.map(item=>item.id).sort(),catalog.restaurants.map(item=>item.id).sort(),'Browser and export must use the same exact identities');
const active = new Set(app.active);
const larryId = 'larrys-sandwiches-dartmouth';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === larryId);
  assert.equal(matches.length, 1, 'Larry’s must have one stable canonical identity');
  const larry = matches[0];
  assert.equal(larry.address, '63 Portland Street, Dartmouth, NS B2Y 1H1');
  assert.equal(larry.phone, '902-449-2102');
  assert.equal(larry.website, 'https://larryssandwiches.com/');
  assert.equal(larry.openingHours, null, 'Dynamic ordering availability is not ordinary weekly hours');
  assert.equal(larry.coordinates, null, 'Do not borrow nearby Lake City Cider coordinates');
  assert.equal(larry.specials.length, 0, 'An undated sandwich of the week is not a verified current offer');
  assert.equal(larry.events.length, 0);
  assert(larry.sources.some(source => source.type === 'menu' && source.url === 'https://larryssandwiches.com/order'));
  assert(records.some(record => record.id === 'lake-city-cider-dartmouth'), 'Nearby existing identity must survive');
}
assert(active.has(larryId));
assert(app.restaurants.find(record => record.id === larryId).menuLinks.some(link => link.url === 'https://larryssandwiches.com/order'));
for (const item of reviewedCorrections.records) {
  const browserRecord = app.restaurants.find(record=>record.id === item.restaurantId);
  const exported = catalog.restaurants.find(record=>record.id === item.restaurantId);
  assert(browserRecord && exported,item.restaurantId);
  for (const [field,value] of Object.entries(item.fields)) {
    // JSON-backed schedules originate in different VM realms; compare the actual fields, not VM prototypes.
    const browserValue = field === 'effectiveDatedHours' ? JSON.parse(JSON.stringify(browserRecord[field])) : browserRecord[field];
    const expectedValue = field === 'effectiveDatedHours' ? JSON.parse(JSON.stringify(value)) : value;
    const exportValue = field === 'effectiveDatedHours' ? JSON.parse(JSON.stringify(exported[field])) : exported[field];
    assert.deepEqual(browserValue,expectedValue,`Browser correction: ${item.restaurantId}/${field}`);
    assert.deepEqual(exportValue,expectedValue,`Export correction: ${item.restaurantId}/${field}`);
  }
  if (['permanently_closed','moved','replaced'].includes(item.fields.operatingStatus)) {
    assert(!active.has(item.restaurantId));
    for (const field of ['menuLinks','reservationLinks','orderingLinks','structuredSpecials','officialUpdates']) assert.equal(browserRecord[field].length,0,field);
    assert.equal(browserRecord.openingHours,null);
  }
}
for (const alias of reviewedCorrections.aliases) {
  assert(!app.restaurants.some(item=>item.id === alias.from));
  assert(app.restaurants.find(item=>item.id === alias.to).mergedIdentityEvidence.some(item=>item.id === alias.from));
}
const once = JSON.stringify(applyReviewedCorrections(structuredClone(catalog.restaurants)));
assert.equal(JSON.stringify(applyReviewedCorrections(JSON.parse(once))),once,'Corrections must be idempotent');
const post = {postUrl:'https://example.com/news',publishedAt:'2026-06-01T12:00:00Z',title:'Things to do this spring'};
assert(!integrity.currentPost(post,Date.parse('2026-06-25T12:00:00Z')),'Spring content expires before its 60-day window');
assert(integrity.currentPost({...post,title:'Spring Garden restaurant update'},Date.parse('2026-06-25T12:00:00Z')),'A neighbourhood name is not a season');
assert(!integrity.currentPost({...post,title:'Menu update',expiresAt:'2026-06-05'},Date.parse('2026-06-10')));
assert(!integrity.currentPost({...post,publishedAt:'9897-01-01'},Date.parse('2026-10-19')));
const specials = JSON.parse(await readFile(new URL('data/build/structured-specials.json',root)));
for (const special of specials.records) if (special.validTo && Date.parse(special.validTo) < Date.now()) assert.equal(special.status,'expired',special.title);
console.log(`Reviewed correction regression passed: ${app.restaurants.length} exact browser/export identities, ${reviewedCorrections.records.length} field/status corrections, ${reviewedCorrections.aliases.length} evidence-preserving merges, seasonal/future expiry.`);

assert(localRestaurantPolicyDecision({name:'HEAL Wellness - Bayers Lake',website:'https://healwellness.ca/locations/'}).excluded,'National franchise must follow existing local-only policy');
const tea = specials.records.filter(item => item.restaurantId === 'osm-node-11751560115-seaport-social' && item.title.startsWith('Afternoon Tea'));
assert.equal(tea.length,2);
const november = tea.find(item=>item.title.includes('November 14'));
assert.equal(november.validFrom,'2026-11-14T14:00:00-04:00');
assert.equal(november.validTo,'2026-11-14T16:00:00-04:00');
const currentTea={...november,status:'verified_current'};
assert(!integrity.currentOffer(currentTea,Date.parse('2026-11-14T13:59:00-04:00')));
assert(integrity.currentOffer(currentTea,Date.parse('2026-11-14T15:00:00-04:00')));
assert(!integrity.currentOffer(currentTea,Date.parse('2026-11-14T16:01:00-04:00')));
