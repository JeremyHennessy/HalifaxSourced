import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
import { localRestaurantPolicyDecision } from './lib/local-restaurant-policy.mjs';
import { reviewedCorrections, applyReviewedCorrections } from './lib/reviewed-corrections.mjs';
const root = new URL('../', import.meta.url);
const FIXTURE_NOW = '2026-10-20T16:00:00.000Z';
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXTURE_NOW])); }
  static now() { return Date.parse(FIXTURE_NOW); }
}
const savedWrites = [];
const context = vm.createContext({window:{}, document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>JSON.stringify(['battery-park','osm-node-14139904501-battery-park-beer-bar-and-eatery']),setItem:(_key,value)=>savedWrites.push(value)}, console, URL, Date:FixtureDate, Intl, Set, Map});
const html = await readFile(new URL('index.html',root),'utf8');
for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^\"]*"><\/script>/g)) {
  const file = match[1]; if (file.startsWith('vendor/')) continue;
  vm.runInContext(await readFile(new URL(file,root),'utf8'),context,{filename:file,timeout:60000});
  if (file === 'data/structured-place-facts.js') {
    const batteryFacts = context.window.HALIFAX_STRUCTURED_PLACE_FACTS.records.find(item => item.restaurantId === 'battery-park');
    batteryFacts.hours = Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day => [day,[{open:'00:00',close:'24:00',overnight:false}]]));
    batteryFacts.lastVerifiedAt = FIXTURE_NOW;
  }
  if (file === 'app-lifecycle.js') break;
}
const app = JSON.parse(vm.runInContext('JSON.stringify({restaurants,active:activeRestaurants.map(item=>item.id),saved:[...state.saved]})',context));
const catalog = JSON.parse(await readFile(new URL('data/build/catalog.json',root)));
assert.deepEqual(app.restaurants.map(item=>item.id).sort(),catalog.restaurants.map(item=>item.id).sort(),'Browser and export must use the same exact identities');
const active = new Set(app.active);
const woodenDartmouthId = 'osm-node-472054712-the-wooden-monkey';
for (const records of [app.restaurants, catalog.restaurants]) {
  const dartmouth = records.find(record => record.id === woodenDartmouthId);
  const halifax = records.find(record => record.id === 'osm-way-96322798-wooden-monkey');
  assert.equal(records.filter(record => record.id === woodenDartmouthId).length, 1);
  assert.equal(dartmouth.phone, '902-466-3100');
  assert.equal(dartmouth.address, '40 Alderney Drive, #305, Level 2 Alderney Ferry Terminal, Dartmouth, NS B2Y 2N5');
  assert.equal(dartmouth.website, 'https://www.thewoodenmonkey.ca/');
  assert.equal(dartmouth.openingHours, 'Mo-Th 11:30-21:00; Fr-Sa 11:30-21:30; Su 11:30-21:00');
  assert.equal(dartmouth.coordinates.lat, 44.6638696);
  assert.equal(dartmouth.coordinates.lon, -63.5694585);
  assert(!dartmouth.effectiveDatedHours, 'Do not invent a current-year exception from stale holiday notices');
  assert(dartmouth.sources.some(source => source.type === 'openstreetmap'));
  assert.equal(halifax.address, '1707 Grafton Street, Halifax');
  assert.equal(halifax.phone, '+1-902-444-3844', 'Never copy Dartmouth phone to Halifax');
  assert.equal(halifax.coordinates.lat, 44.6470762);
  assert(!dartmouth.aliasIds?.includes(halifax.id), 'These are separate locations, not duplicate identities');
}
assert(active.has(woodenDartmouthId));
const batteryAlias = 'osm-node-14139904501-battery-park-beer-bar-and-eatery';
assert.deepEqual(app.saved, ['battery-park'], 'Old and canonical saved IDs reconcile to one persisted bookmark');
assert.deepEqual(JSON.parse(savedWrites.at(-1)), ['battery-park']);
const batteryRuntime = app.restaurants.find(record => record.id === 'battery-park');
const batteryReviewedHours = reviewedCorrections.factFieldOverrides.find(rule => rule.restaurantId === 'battery-park')?.fields?.hours;
assert.deepEqual(JSON.parse(JSON.stringify(batteryRuntime.structuredHours)), JSON.parse(JSON.stringify(batteryReviewedHours)), 'The independently corroborated reviewed schedule must override a fresh imported 24-hour claim');
assert.equal(batteryRuntime.currentHoursState.state, 'unknown', 'The fixture computes its cached state before the reviewed correction overlay; do not restore the rejected 24-hour open-now claim');
for (const records of [app.restaurants, catalog.restaurants]) {
  const battery = records.find(record => record.id === 'battery-park');
  assert.equal(records.filter(record => /battery park/i.test(record.name)).length, 1, 'One source-reviewed Battery Park location, not two name variants');
  assert(!records.some(record => record.id === batteryAlias));
  assert(battery.aliasIds.includes(batteryAlias), 'The old saved ID and detail route must remain resolvable');
  assert.equal(battery.address, '62 Ochterloney Street, Dartmouth, NS B2Y 1C2');
  assert.equal(battery.phone, '902-446-2337');
  assert.equal(battery.coordinates.lat, 44.6669046, 'Retain the accepted OSM coordinate, not a new geocode');
  assert.equal(battery.coordinates.lon, -63.5678828);
  assert.equal(battery.openingHours, 'Mo 11:30-22:00; Tu closed; We-Th 11:30-23:00; Fr-Sa 11:30-00:00; Su 11:30-22:00', 'The corroborated current schedule must supersede the held typo and imported 24-hour service');
  assert(battery.sources.some(source => source.type === 'openstreetmap'));
  assert((battery.inspectionRecords || battery.inspections).some(record => record.facilityId === '2118924'), 'Retain the exact accepted inspection facility');
  assert(battery.mergedIdentityEvidence.some(item => item.id === batteryAlias));
}
assert(app.restaurants.find(record => record.id === 'battery-park').menuLinks.some(link => link.url === 'https://batterypark.ca/copy-food'));
assert(app.restaurants.find(record => record.id === woodenDartmouthId).menuLinks.some(link => link.url === 'https://www.thewoodenmonkey.ca/main-menu'));
const chanoeyId = 'chanoeys-pasta-dartmouth';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === chanoeyId);
  assert.equal(matches.length, 1, 'One reviewed original Dartmouth location; no former-tenant merge');
  const chanoey = matches[0];
  assert.equal(chanoey.address, '41 Portland Street, Dartmouth, NS B2Y 1H1');
  assert.equal(chanoey.phone, '902-405-2211');
  assert.equal(chanoey.coordinates, null, 'Do not borrow former Subway coordinates');
  assert.equal(chanoey.openingHours, 'Mo-Fr 11:00-20:00; Sa-Su 15:30-20:00');
  assert.equal(chanoey.effectiveDatedHours.dateOverrides.length, 14);
  assert.equal(chanoey.specials.length, 0, 'Do not turn a menu/cash offer into a verified promotion');
  assert.equal(chanoey.events.length, 0, 'No invented reopening event');
  assert(chanoey.sources.some(source => source.type === 'menu' && source.url === 'https://www.chanoeyspasta.com/menu'));
}
assert(active.has(chanoeyId), 'Time-limited closure is not permanent archive');
assert(app.restaurants.find(record => record.id === chanoeyId).menuLinks.some(link => link.url === 'https://www.chanoeyspasta.com/menu'));
const coffeeStreetId = 'osm-node-13958623779-coffee-street';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === coffeeStreetId);
  assert.equal(matches.length, 1, 'Coffee Street must retain its existing canonical identity');
  const coffeeStreet = matches[0];
  assert.equal(coffeeStreet.address, '33 Alderney Drive, Dartmouth, NS B2Y 2N4');
  assert.equal(coffeeStreet.phone, '902-444-1655');
  assert.equal(coffeeStreet.website, 'https://www.coffeestreet.ca/');
  assert.equal(coffeeStreet.openingHours, 'Mo-Su 07:00-22:00', 'Owner hours must supersede the stale OpenStreetMap midnight close');
  assert.equal(coffeeStreet.coordinates.lat, 44.6655819, 'Preserve accepted source coordinates');
  assert.equal(coffeeStreet.coordinates.lon, -63.5699189, 'Preserve accepted source coordinates');
  assert(coffeeStreet.sources.some(source => source.type === 'menu' && source.url === 'https://www.coffeestreet.ca/find-your-grind'));
}
assert(active.has(coffeeStreetId));
assert(app.restaurants.find(record => record.id === coffeeStreetId).menuLinks.some(link => link.url === 'https://www.coffeestreet.ca/find-your-grind'));
const portCityId = 'port-city-coffee-dartmouth';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === portCityId);
  assert.equal(matches.length, 1, 'Port City Coffee must have one reviewed Downtown Dartmouth identity');
  const portCity = matches[0];
  assert.equal(portCity.address, '2 Ochterloney Street, Dartmouth, NS');
  assert.equal(portCity.phone, '902-460-6575');
  assert.equal(portCity.website, 'https://portcitycoffee.ca/');
  assert.equal(portCity.openingHours, 'Mo-Fr 07:00-16:00; Sa 07:00-14:00; Su 10:00-15:00');
  assert.equal(portCity.coordinates, null, 'Do not invent coordinates from the civic address');
  assert.equal(portCity.specials.length, 0, 'Subscription language is not a verified current offer');
  assert.equal(portCity.events.length, 0);
  assert(portCity.sources.some(source => source.type === 'government_inspection' && source.url.endsWith('Id1=2180072')));
}
assert(active.has(portCityId));
const littlePisaId = 'little-pisa-dartmouth';
const cafe98Id = 'osm-node-5150636926-cafe-98';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === littlePisaId);
  assert.equal(matches.length, 1, 'Little Pisa must have one reviewed Downtown Dartmouth identity');
  const littlePisa = matches[0];
  assert.equal(littlePisa.address, '98 Portland Street, Dartmouth, NS B2Y 1H6');
  assert.equal(littlePisa.phone, '902-209-4222');
  assert.equal(littlePisa.website, 'https://littlepisa.ca/');
  assert.equal(littlePisa.openingHours, 'Mo-Th 11:00-21:00; Fr-Sa 11:00-21:30; Su 14:00-21:00');
  assert.equal(littlePisa.coordinates, null, 'Do not invent coordinates from the civic address');
  assert.deepEqual([...littlePisa.cuisines], ['Pizza', 'Italian']);
  assert.equal(littlePisa.socialProfiles.length, 0, 'Do not publish an unlinked or throttled social profile');
  assert.equal(littlePisa.specials.length, 0, 'Undated menu bundles are not time-bounded offers');
  assert.equal(littlePisa.events.length, 0);
  assert(littlePisa.sources.some(source => source.type === 'menu' && source.url === 'https://littlepisa.ca/menu-offering/'));
  assert(littlePisa.sources.some(source => source.type === 'government_inspection' && source.url.endsWith('Id1=3892094')));
  const cafe98 = records.find(record => record.id === cafe98Id);
  assert(cafe98, 'Retain the stale Cafe 98 identity as lifecycle history');
  assert.equal(cafe98.operatingStatus, 'replaced');
  assert.equal(cafe98.successorId, littlePisaId);
  assert.equal(cafe98.openingHours, null);
}
assert(active.has(littlePisaId));
assert(!active.has(cafe98Id));
assert(app.restaurants.find(record => record.id === littlePisaId).menuLinks.some(link => link.url === 'https://littlepisa.ca/menu-offering/'));
const evansId = 'evans-fresh-seafoods-dartmouth';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === evansId);
  assert.equal(matches.length, 1, 'Three directory candidates must not create three Evan’s identities');
  const evans = matches[0];
  assert.equal(evans.address, '2 Ochterloney Street, Dartmouth, NS B2Y 1B2');
  assert.equal(evans.phone, '902-466-2118');
  assert.equal(evans.website, 'https://www.evansfreshseafoods.com/');
  assert.equal(evans.openingHours, 'Mo-Su 11:00-20:00', 'Publish owner kitchen hours, not fish-counter hours or stale directory hours');
  assert.equal(evans.coordinates, null, 'Do not borrow coordinates of another Alderney Landing tenant');
  assert.equal(evans.specials.length, 0, 'A menu or weather-dependent beer garden is not a current offer');
  assert.equal(evans.events.length, 0);
  assert(evans.sources.some(source => source.type === 'menu' && source.url === 'https://www.evansfreshseafoods.com/menu/'));
}
assert(active.has(evansId));
assert(app.restaurants.find(record => record.id === evansId).menuLinks.some(link => link.url === 'https://www.evansfreshseafoods.com/menu/'));
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
const creperieId = 'osm-node-8376551845-portland-street-creperie';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === creperieId);
  assert.equal(matches.length, 1, 'Portland Street Crêperie must retain one canonical identity');
  const creperie = matches[0];
  assert.equal(creperie.neighborhood, 'Downtown Dartmouth');
  assert.equal(creperie.address, '55 Portland Street, Dartmouth, NS B2Y 1H1');
  assert.equal(creperie.phone, '902-466-7686');
  assert.equal(creperie.website, 'https://www.xn--portlandstreetcrperie-d6b.com/');
  assert.equal(creperie.openingHours, 'Wednesday–Friday 9:30am–4pm (orders until 3:45pm); Saturday–Sunday 9am–5pm (orders until 4:45pm)');
  assert.equal(creperie.coordinates.lat, 44.6653413, 'Preserve accepted source coordinates');
  assert.equal(creperie.coordinates.lon, -63.5671447, 'Preserve accepted source coordinates');
  assert(creperie.sources.some(source => source.type === 'menu' && source.url === 'https://www.foodbooking.com/api/fb/8r4_o7'));
}
assert(active.has(creperieId));
assert(app.restaurants.find(record => record.id === creperieId).menuLinks.some(link => link.url === 'https://www.foodbooking.com/api/fb/8r4_o7'));
const revanaId = 'osm-node-3801688860-revana-pizza';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === revanaId);
  assert.equal(matches.length, 1, 'Revana Dartmouth must retain one location-specific canonical identity');
  const revana = matches[0];
  assert.equal(revana.neighborhood, 'Downtown Dartmouth');
  assert.equal(revana.address, '29 Portland Street, Dartmouth, NS B2Y 1H1');
  assert.equal(revana.phone, '902-461-0000');
  assert.equal(revana.website, 'https://dartmouth.revanapizza.ca/');
  assert.equal(revana.openingHours, 'Monday 11am–11pm; Tuesday–Thursday 11am–midnight; Friday 11am–1am; Saturday noon–1am; Sunday 4pm–11pm');
  assert.equal(revana.coordinates.lat, 44.6649407, 'Preserve accepted Dartmouth coordinates');
  assert.equal(revana.coordinates.lon, -63.5675812, 'Preserve accepted Dartmouth coordinates');
  assert(revana.sources.some(source => source.type === 'menu' && source.url === 'https://dartmouth.revanapizza.ca/'));
  assert(!/truro/i.test(revana.address), 'Never merge the separate Truro location into Dartmouth');
}
assert(active.has(revanaId));
assert(app.restaurants.find(record => record.id === revanaId).menuLinks.some(link => link.url === 'https://dartmouth.revanapizza.ca/'));
const ilaiId = 'ilai-halifax';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === ilaiId);
  assert.equal(matches.length, 1, 'Ilai must have one location-specific Spring Garden identity');
  const ilai = matches[0];
  assert.equal(ilai.neighborhood, 'Spring Garden');
  assert.equal(ilai.address, '1569 Dresden Row, Halifax, NS B3J 2K4');
  assert.equal(ilai.phone, '782-321-7362');
  assert.equal(ilai.website, null, 'Do not publish the owner domain while the origin is not currently reachable');
  assert.equal(ilai.openingHours, null, 'Do not infer weekly hours from delivery marketplaces');
  assert.equal(ilai.coordinates, null, 'Do not invent coordinates from an address');
  assert.deepEqual([...ilai.cuisines], ['South Indian', 'Indian']);
  assert(ilai.socialProfiles.some(profile => profile.platform === 'instagram' && profile.url === 'https://www.instagram.com/ilai.halifax/'));
  assert(ilai.sources.some(source => source.type === 'business_directory' && source.url === 'https://www.springgardenarea.com/eat-drink'));
}
assert(active.has(ilaiId));
const manillaThaiId = 'manilla-thai-grill-halifax';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === manillaThaiId);
  assert.equal(matches.length, 1, 'Manilla Thai Grill must have one location-specific Spring Garden identity');
  const manillaThai = matches[0];
  assert.equal(manillaThai.neighborhood, 'Spring Garden');
  assert.equal(manillaThai.address, '5686 Spring Garden Road, Halifax, NS B3J 1H5');
  assert.equal(manillaThai.phone, '902-410-7979', 'Publish only the current owner-social phone');
  assert.equal(manillaThai.website, null, 'Do not publish the directory-linked owner domain while it returns HTTP 404');
  assert.equal(manillaThai.openingHours, null, 'Do not infer weekly hours from delivery marketplaces');
  assert.equal(manillaThai.coordinates, null, 'Do not invent coordinates from an address');
  assert.deepEqual([...manillaThai.cuisines], ['Filipino', 'Thai']);
  assert(manillaThai.socialProfiles.some(profile => profile.platform === 'instagram' && profile.url === 'https://www.instagram.com/manillathaigrillhfx/'));
  assert(manillaThai.sources.some(source => source.type === 'government_inspection' && source.url.endsWith('Id1=3356936')));
  assert(manillaThai.sources.some(source => source.type === 'official_social' && source.url === 'https://www.facebook.com/100094234341135/' && source.status === 'verified'));
  assert(manillaThai.sources.some(source => source.type === 'official_website' && source.status === 'failed'));
}
assert(active.has(manillaThaiId));
const youngPochaId = 'young-pocha-halifax';
for (const records of [app.restaurants, catalog.restaurants]) {
  const matches = records.filter(record => record.id === youngPochaId);
  assert.equal(matches.length, 1, 'Young Pocha must have one location-specific Spring Garden identity');
  const youngPocha = matches[0];
  assert.equal(youngPocha.neighborhood, 'Spring Garden');
  assert.equal(youngPocha.address, '5650 Spring Garden Road, Halifax, NS B3J 1H4');
  assert.equal(youngPocha.phone, '902-932-2309');
  assert.equal(youngPocha.website, 'https://young-pocha.com/');
  assert.equal(youngPocha.openingHours, 'Monday–Thursday noon–10pm; Friday–Saturday noon–midnight; Sunday noon–10pm');
  assert.equal(youngPocha.coordinates, null, 'Do not invent a unit or coordinates from the civic address');
  assert.deepEqual([...youngPocha.cuisines], ['Korean', 'Korean BBQ']);
  assert.equal(youngPocha.specials.length, 0, 'Menu sections are not time-bounded specials');
  assert.equal(youngPocha.events.length, 0);
  assert(youngPocha.sources.some(source => source.type === 'government_inspection' && source.url.endsWith('Id1=2865778')));
  assert(youngPocha.sources.some(source => source.type === 'menu' && source.url === 'https://young-pocha.com/menu/'));
}
assert(active.has(youngPochaId));
assert(app.restaurants.find(record => record.id === youngPochaId).menuLinks.some(link => link.url === 'https://young-pocha.com/menu/'));
const beaversDartmouthId = 'beavers-den-dartmouth';
for (const records of [app.restaurants, catalog.restaurants]) {
  const dartmouthMatches = records.filter(record => record.id === beaversDartmouthId);
  assert.equal(dartmouthMatches.length, 1, 'Beaver’s Den Dartmouth must be a distinct location identity');
  const dartmouth = dartmouthMatches[0];
  const halifax = records.find(record => record.id === 'osm-node-2714150694-the-beaver-s-den');
  assert.equal(dartmouth.neighborhood, 'Downtown Dartmouth');
  assert.equal(dartmouth.address, '101A-16 Portland Street, Dartmouth, NS B2Y 1G9');
  assert.equal(dartmouth.phone, '902-333-8156', 'Use the current owner phone, not the conflicting directory phone');
  assert.equal(dartmouth.website, 'https://thebeaversden.ca/');
  assert.equal(dartmouth.openingHours, null, 'Do not copy shared or third-party hours without location-specific owner evidence');
  assert.equal(dartmouth.coordinates, null, 'Do not borrow Quinpool coordinates for the Dartmouth branch');
  assert(dartmouth.sources.some(source => source.type === 'menu' && source.url === 'https://thebeaversden.ca/menu'));
  assert(halifax, 'The separate Quinpool location must remain present');
  assert.equal(halifax.address, '6273 Quinpool Road, Halifax, Nova Scotia');
  assert.equal(halifax.coordinates.lat, 44.6453379, 'Preserve the Quinpool source coordinates');
  assert.equal(halifax.coordinates.lon, -63.5980941, 'Preserve the Quinpool source coordinates');
  assert(!dartmouth.aliasIds?.includes(halifax.id), 'Two owner-listed branches are not aliases');
}
assert(active.has(beaversDartmouthId));
assert(app.restaurants.find(record => record.id === beaversDartmouthId).menuLinks.some(link => link.url === 'https://thebeaversden.ca/menu'));
// Corrections must precede automatic inspection association in both consumers.
const kaiId = 'osm-node-26041176-kai-brady-s';
const kaiBrowser = app.restaurants.find(record => record.id === kaiId);
const kaiExport = catalog.restaurants.find(record => record.id === kaiId);
assert.equal(kaiBrowser.address, '5679 Spring Garden Road, Halifax, NS B3J 1G9');
assert.deepEqual(kaiBrowser.inspections.map(record => record.id), ['ns-food-3670733'], 'Bind inspection evidence to the corrected Kai Brady location, not stale OSM 5675');
assert.deepEqual(kaiBrowser.inspections.map(record => record.id), kaiExport.inspectionRecords.map(record => record.id), 'Reviewed inspection matches must agree between browser and catalog');

// A correction can also invalidate an old automatic match. Do not retain the
// previous branch or erase separately reviewed evidence while rebinding it.
const inspectionFixture = vm.createContext({ window: {}, Intl, Date: FixtureDate });
vm.runInContext(await readFile(new URL('source-integrity.js', root), 'utf8'), inspectionFixture);
vm.runInContext(await readFile(new URL('restaurant-corrections.js', root), 'utf8'), inspectionFixture);
vm.runInContext(await readFile(new URL('app-inspection-matching.js', root), 'utf8'), inspectionFixture);
vm.runInContext(`
  const registry = [
    { id: 'old-branch', name: 'Fixture Cafe', address: '101 Main Street, Halifax' },
    { id: 'new-branch', name: 'Fixture Cafe', address: '102 Main Street, Halifax' }
  ];
  const reviewedEvidence = [{ id: 'reviewed-evidence', reviewState: 'verified' }];
  const sources = [{ type: 'government_inspection', url: 'https://example.test/reviewed' }];
  const restaurants = [
    { id: 'moved-fixture', name: 'Fixture Cafe', address: '101 Main Street, Halifax', inspections: [registry[0]], inspectionRecords: reviewedEvidence, sources },
    { id: 'unmatched-fixture', name: 'Fixture Cafe', address: '101 Main Street, Halifax', inspections: [registry[0]] },
    { id: 'name-fixture', name: 'Fixture Cafe', address: '101 Main Street, Halifax', inspections: [registry[0]] },
    { id: 'unchanged-fixture', name: 'Unrelated Cafe', address: 'Unknown address', inspections: [{ id: 'unchanged' }] }
  ];
  const reviewedRestaurantCorrections = { records: [
    { restaurantId: 'moved-fixture', fields: { address: '102 Main Street, Halifax' } },
    { restaurantId: 'unmatched-fixture', fields: { address: '103 Main Street, Halifax' } },
    { restaurantId: 'name-fixture', fields: { name: 'Unrelated Cafe' } }
  ] };
  const inspectionMatches = restaurant => window.HalifaxInspectionMatching.matches(restaurant, registry);
  const isRestaurantActive = restaurant => HalifaxRestaurantCorrections.isActive(restaurant);
  const activeRestaurants = [];
`, inspectionFixture);
vm.runInContext(await readFile(new URL('app-lifecycle.js', root), 'utf8'), inspectionFixture);
const inspectionProjection = JSON.parse(vm.runInContext('JSON.stringify(restaurants)', inspectionFixture));
assert.deepEqual(inspectionProjection[0].inspections.map(record => record.id), ['new-branch']);
assert.deepEqual(inspectionProjection[0].inspectionRecords, [{ id: 'reviewed-evidence', reviewState: 'verified' }]);
assert(inspectionProjection[0].sources.some(source => source.url === 'https://example.test/reviewed'), 'Do not erase independently reviewed evidence');
assert.deepEqual(inspectionProjection[1].inspections, [], 'Do not carry an old branch match across a corrected civic address');
assert.deepEqual(inspectionProjection[2].inspections, [], 'Do not carry an old business match across a corrected name');
assert.deepEqual(inspectionProjection[3].inspections.map(record => record.id), ['unchanged'], 'Unrelated projections must be untouched');

const marcoId = 'osm-node-4421124794-cafe-marco-polo';
const marco = app.restaurants.find(record => record.id === marcoId);
assert(marco && active.has(marcoId), 'Keep the existing Café Marco Polo identity active');
assert.equal(app.restaurants.filter(record => record.id === marcoId).length, 1);
assert(marco.menuLinks.some(link => link.url === 'https://cafemarcopolodartmouth.com/11-2/'), 'Publish the observed same-domain official menu, not an inferred URL');
assert.equal(marco.coordinates.lat, 44.6643302, 'Preserve accepted source coordinates');
assert.equal(marco.coordinates.lon, -63.5644001, 'Preserve accepted source coordinates');
assert(marco.sources.some(source => source.type === 'openstreetmap'), 'Do not drop accepted source history');
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
// Run the real builder against current reviewed inputs, but in a temporary
// fixture with a fixed clock. A committed generated snapshot may predate the
// source corrections, and wall-clock passage must not change this regression.
const fixture = await mkdtemp(join(tmpdir(), 'halifax-reviewed-specials-'));
let specials;
try {
  await mkdir(join(fixture, 'scripts'), { recursive: true });
  await mkdir(join(fixture, 'data/build'), { recursive: true });
  for (const file of ['source-integrity.js', 'scripts/build-structured-specials.mjs', 'data/build/catalog.json', 'data/build/first-party-sources.json', 'data/build/verified-source-pages.json', 'data/reviewed-structured-specials.json', 'data/build/public-special-source-leads.json', 'data/discovery-overrides.json']) {
    await copyFile(new URL(file, root), join(fixture, file));
  }
  await writeFile(join(fixture, 'runner.mjs'), `
    const RealDate=Date;
    globalThis.Date=class extends RealDate {
      constructor(...args){super(...(args.length?args:[${JSON.stringify(FIXTURE_NOW)}]));}
      static now(){return RealDate.parse(${JSON.stringify(FIXTURE_NOW)});}
    };
    await import('./scripts/build-structured-specials.mjs');
  `);
  const result = spawnSync(process.execPath, [join(fixture, 'runner.mjs')], { cwd: fixture, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  specials = JSON.parse(await readFile(join(fixture, 'data/build/structured-specials.json')));
  assert.equal(specials.generatedAt, FIXTURE_NOW);
} finally { await rm(fixture, { recursive: true, force: true }); }
for (const special of specials.records) if (special.validTo && Date.parse(special.validTo) < FixtureDate.now()) assert.equal(special.status,'expired',special.title);
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
