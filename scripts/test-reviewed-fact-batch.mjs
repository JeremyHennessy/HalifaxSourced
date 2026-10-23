import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import corrections from '../restaurant-corrections.js';
import integrity from '../source-integrity.js';
import { reviewedCorrections } from './lib/reviewed-corrections.mjs';

const root = new URL('../', import.meta.url);
// The fixture's virtual time must not precede authentic reviewed access receipts.
const reviewedAccessPolicy = JSON.parse(await readFile(new URL('data/source-link-access-holds.json', root), 'utf8'));
const latestReviewedRestriction = Math.max(...[reviewedAccessPolicy, ...(reviewedAccessPolicy.historicalEvidence || [])].flatMap(group=>group.observations.map(row=>Date.parse(row.observedAt))));
const defaultFixtureClock = new Date(Math.max(Date.parse('2026-10-23T16:00:00.000Z'), latestReviewedRestriction + 1000)).toISOString();
const sajId = 'osm-node-8443747544-saj-house';
const foreign = '433 World Trade Center, Gibraltar, GI';
const expected = new Map([
  ['osm-node-267592027-the-black-sheep', { address: 'BH204 – 1496 Lower Water Street, Halifax, NS B3J 1R9', phone: '902-429-6491' }],
  ['osm-node-11751643550-cafe-lunette', { address: '160-1741 Lower Water Street, Halifax, NS B3J 0J2', phone: '902-334-1300', openingHours: 'Mo-Th 07:30-22:00; Fr 07:30-23:00; Sa 09:00-23:00; Su 09:00-22:00' }],
  ['osm-node-4797459279-tilted-tap', { address: '172 Wyse Road, Dartmouth, NS B3A 1M6', phone: '902-462-5333', openingHours: 'Bar: Mo-Tu 10:00-23:00; We-Su 10:00-24:00. Kitchen: Mo-We 11:30-21:00; Th-Fr 11:30-22:00; Sa 10:00-22:00; Su 10:00-21:00. Holidays open at 12:00; check official source.' }]
]);
const menus = new Map([
  ['retas-gottingen', ['https://www.retasrestaurant.com/s/Retas-FOOD-menu-16th-October-2026.pdf', 'https://www.retasrestaurant.com/s/Retas-DRINK-menu-16th-October-2026.pdf']]
]);

const facts = JSON.parse(await readFile(new URL('data/build/structured-place-facts.json', root)));
const publishedSaj = facts.records.find(record => record.restaurantId === sajId);
assert.equal(publishedSaj.address, null);
assert.equal(publishedSaj.observedAt, '2026-09-04T13:24:31.147Z', 'A review must not freshen the old source observation');
assert(facts.sourceHistory.some(entry => entry.reason === 'reviewed_field_rejection' && entry.record.restaurantId === sajId && entry.record.address === foreign));
const raw = { ...publishedSaj, address: foreign };
const unchanged = { ...raw, restaurantId: 'different-location' };
const filtered = corrections.applyFactFieldRejections([raw, unchanged], reviewedCorrections);
assert.equal(filtered[0].address, null);
assert.equal(filtered[1].address, foreign, 'The rejection is scoped to one exact entity, not all addresses or the domain');
assert.equal(raw.address, foreign, 'Raw evidence is not mutated');
assert.equal(filtered[0].email, raw.email, 'Only the rejected address field changes');
assert.deepEqual(corrections.applyFactFieldRejections(filtered, reviewedCorrections), filtered, 'Repeated application is idempotent');

// Exercise the actual browser script order with a stale/unsafe payload injected
// before its fact decorator. A generated refresh is not the only guard.
const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date, Intl, Set, Map });
const html = await readFile(new URL('index.html', root), 'utf8');
for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
  const file = match[1];
  if (file.startsWith('vendor/')) continue;
  vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
  if (file === 'data/structured-place-facts.js') {
    assert.equal(JSON.stringify(context.window.HALIFAX_STRUCTURED_PLACE_FACTS), JSON.stringify(facts));
    context.window.HALIFAX_STRUCTURED_PLACE_FACTS.records.find(record => record.restaurantId === sajId).address = foreign;
  }
  if (file === 'app-lifecycle.js') break;
}
const app = JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
const catalog = JSON.parse(await readFile(new URL('data/build/catalog.json', root)));
assert.deepEqual(app.map(record => record.id).sort(), catalog.restaurants.map(record => record.id).sort());
for (const records of [app, catalog.restaurants]) {
  for (const [id, fields] of expected) {
    const record = records.find(item => item.id === id);
    assert(record, id);
    for (const [field, value] of Object.entries(fields)) assert.equal(record[field], value, `${id}:${field}`);
    assert.equal(record.reviewedCorrection.reviewedAt, '2026-10-20');
  }
  const sheep = records.find(record => record.id === 'osm-node-267592027-the-black-sheep');
  assert.equal(sheep.openingHours, 'Mo-Th 10:00-21:00; Fr 10:00-22:00; Sa 09:00-22:00; Su 09:00-16:00');
  assert.equal(sheep.effectiveDatedHours.revisions[0].from, '2026-10-26');
  assert.equal(sheep.effectiveDatedHours.dateOverrides[0].date, '2026-11-14');
  assert.equal(records.find(record => record.id === 'chanoeys-pasta-dartmouth').effectiveDatedHours.dateOverrides.length, 14);
  assert(records.find(record => record.id === 'osm-node-11751643550-cafe-lunette').aliasIds.includes('osm-node-12984675528-cafe-lunette'));
  for (const [id, urls] of menus) {
    const record = records.find(item => item.id === id);
    assert.equal(record.openingHours, null, 'Unknown or malformed hours remain held: ' + id);
    for (const url of urls) {
      const source = record.sources.find(source => source.type === 'menu' && source.url === url);
      assert(source, 'Reviewed menu source: ' + url);
      assert.equal(source.observedAt, '2026-10-20');
      assert(!source.publishedAt, 'A filename date is not a verified publication date');
    }
  }
}
for (const [id, urls] of menus) for (const url of urls) assert.equal(app.find(record => record.id === id).menuLinks.filter(link => link.url === url).length, 1);
assert.equal(app.find(record => record.id === 'osm-node-11552069056-sushi-cove').menuLinks.length, 0, 'Do not reactivate the archived former Sushi Cove');
// An unavailable menu is not a restaurant closure or a newly verified homepage.
for (const records of [app, catalog.restaurants]) {
  const sushi = records.find(record => record.id === 'sushi-square-scotia-square');
  assert.equal(sushi.operatingStatus, 'active');
  assert.equal(sushi.website, records === app ? null : 'https://sushisquare.ca/', 'Hide the unavailable homepage in browser state while retaining catalog history');
  assert.equal((sushi.menuLinks || []).length, 0, 'Historical enrichment must not resurrect the confirmed broken menu');
  assert(!(sushi.sources || []).some(source => source.type === 'menu'));
}
for (const suffix of ['', '/', '/?view=all#menu']) {
  assert.equal(integrity.safeSource('https://sushisquare.ca/menu' + suffix), false);
}
assert.equal(integrity.safeSource('https://sushisquare.ca/'), false, 'Suppress the separately confirmed unavailable homepage');
assert.equal(integrity.safeSource('https://sushisquare.ca/menu-new/'), true, 'Do not invent failures for unreviewed paths');
const reviewedSushi = reviewedCorrections.additions.find(record => record.id === 'sushi-square-scotia-square');
assert.equal(reviewedSushi.website, 'https://sushisquare.ca/', 'Preserve the historical official-site identity');
assert.equal(reviewedSushi.operatingStatusEvidence.observedAt, '2026-10-19');
assert.equal(reviewedSushi.sources[0].observedAt, '2026-10-19');
const historicalMenu = JSON.parse(await readFile(new URL('data/build/verified-source-pages.json', root))).menuSources.find(record => record.url === 'https://sushisquare.ca/menu/');
assert(historicalMenu, 'Retain historical observations, rather than rewriting past evidence');
vm.runInContext(await readFile(new URL('app-detail.js', root), 'utf8'), context);
assert.equal(vm.runInContext("safeUrl('https://sushisquare.ca/')", context), null);
assert(!JSON.parse(vm.runInContext("JSON.stringify(uniqueSourceLinks(restaurants.find(record => record.id === 'sushi-square-scotia-square')))", context)).some(source => source.url === 'https://sushisquare.ca/'), 'Detail evidence links must not resurrect the unavailable homepage');
const archivedCove = app.find(record => record.id === 'osm-node-11552069056-sushi-cove');
assert.equal(archivedCove.operatingStatus, 'moved', 'Unavailable source does not create a new closure claim');
assert.deepEqual(archivedCove.structuredFeatures, []);
assert.deepEqual(archivedCove.structuredFacts.features, []);
assert.deepEqual(archivedCove.structuredFacts.menus, []);
const browserSaj = app.find(record => record.id === sajId);
assert.equal(browserSaj.structuredAddress, null);
assert.equal(browserSaj.structuredFacts.address, null);
assert.equal(browserSaj.address, '19 Alma Crescent, Halifax, Nova Scotia');

// Test the real importer without network: both old retained and new fetched
// source values must be suppressed, with raw evidence kept in sourceHistory.
const fixture = await mkdtemp(join(tmpdir(), 'halifax-reviewed-facts-'));
try {
  await mkdir(join(fixture, 'scripts/lib'), { recursive: true });
  await mkdir(join(fixture, 'data/build'), { recursive: true });
  for (const file of ['scripts/import-structured-place-facts.mjs', 'scripts/lib/place-facts-history.mjs', 'scripts/lib/reviewed-corrections.mjs', 'scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json', 'restaurant-corrections.js', 'source-integrity.js', 'data/reviewed-restaurant-corrections.js', 'data/reviewed-place-resolutions.js']) {
    await copyFile(new URL(file, root), join(fixture, file));
  }
  const save = (name, data) => writeFile(join(fixture, 'data/build', name + '.json'), JSON.stringify(data));
  await save('catalog', { restaurants: [{ id: sajId, name: 'Saj House' }, { id: 'other', name: 'Other' }] });
  await save('first-party-sources', { records: [{ restaurantId: sajId, website: 'https://saj.example/' }, { restaurantId: 'other', website: 'https://other.example/' }] });
  await save('structured-place-facts', { records: [raw] });
  await writeFile(join(fixture, 'runner.mjs'), `
    import {writeFile} from 'node:fs/promises';
    const RealDate=Date;
    const fixtureNow=RealDate.parse(process.env.FIXTURE_NOW||'2026-10-23T16:00:00.000Z');
    globalThis.Date=class extends RealDate {
      constructor(...args){super(...(args.length?args:[fixtureNow]));}
      static now(){return fixtureNow;}
    };
    const requests=[];
    globalThis.fetch=async input=>{
      const url=String(input);requests.push(url);
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\\nDisallow:');
      const address=url.includes('saj.example')?(process.env.FIXTURE_SAJ_ADDRESS||${JSON.stringify(foreign)}):'20 Correct Lane, Halifax, NS';
      return new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Restaurant',address})+'</script>',{headers:{'content-type':'text/html'}});
    };
    try{await import('./scripts/import-structured-place-facts.mjs');}
    finally{await writeFile('requests.json',JSON.stringify(requests));}
  `);
  const run = (limit, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [join(fixture, 'runner.mjs')], { cwd: fixture, env: { ...process.env, FIXTURE_NOW: defaultFixtureClock, STRUCTURED_PLACE_FACT_LIMIT: String(limit), STRUCTURED_PLACE_FACT_DELAY_MS: '0', STRUCTURED_PLACE_FACT_CONCURRENCY: '1', ...extraEnv }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  run(0);
  const retained = JSON.parse(await readFile(join(fixture, 'data/build/structured-place-facts.json')));
  assert.equal(retained.records[0].address, null);
  assert.equal(retained.records[0].observedAt, raw.observedAt);
  assert(retained.sourceHistory.some(entry => entry.record.address === foreign && entry.reason === 'reviewed_field_rejection'));
  assert.deepEqual(JSON.parse(await readFile(join(fixture, 'requests.json'))), []);
  run(2);
  const refreshed = JSON.parse(await readFile(join(fixture, 'data/build/structured-place-facts.json')));
  assert.equal(refreshed.records.find(record => record.restaurantId === sajId).address, null);
  assert.equal(refreshed.records.find(record => record.restaurantId === 'other').address, '20 Correct Lane, Halifax, NS');
  assert.equal(refreshed.counts.address, 1);
  assert(refreshed.sourceHistory.some(entry => entry.record.address === foreign && entry.reason === 'reviewed_field_rejection'));
  const output = { window: {} };
  vm.runInNewContext(await readFile(join(fixture, 'data/structured-place-facts.js'), 'utf8'), output);
  assert.equal(JSON.stringify(output.window.HALIFAX_STRUCTURED_PLACE_FACTS), JSON.stringify(refreshed));
  // Repeated identical rejected observations must not invent accepted changes
  // or grow raw/superseded history simply because source timestamps advance.
  run(2, { FIXTURE_NOW: '2026-10-24T16:00:00.000Z' });
  const repeated = JSON.parse(await readFile(join(fixture, 'data/build/structured-place-facts.json')));
  assert.equal(repeated.refreshCounts.changed, 0);
  assert.equal(repeated.refreshCounts.unchanged, 2);
  assert.deepEqual(repeated.sourceHistory, refreshed.sourceHistory);
  assert.equal(repeated.records.find(record => record.restaurantId === sajId).address, null);
  assert.notEqual(repeated.records.find(record => record.restaurantId === sajId).observedAt, refreshed.records.find(record => record.restaurantId === sajId).observedAt, 'A genuinely repeated fetch may record a new observation, but is not a content change');
  const differentRejectedAddress = '434 World Trade Center, Gibraltar, GI';
  run(2, { FIXTURE_SAJ_ADDRESS: differentRejectedAddress, FIXTURE_NOW: '2026-10-25T16:00:00.000Z' });
  const distinctRejected = JSON.parse(await readFile(join(fixture, 'data/build/structured-place-facts.json')));
  assert.equal(distinctRejected.refreshCounts.changed, 0, 'A change confined to a rejected field is not an accepted-content change');
  assert.equal(distinctRejected.refreshCounts.unchanged, 2);
  assert.equal(distinctRejected.sourceHistory.length, refreshed.sourceHistory.length + 1, 'Distinct rejected raw evidence is retained once');
  assert(distinctRejected.sourceHistory.some(entry => entry.reason === 'reviewed_field_rejection' && entry.record.address === differentRejectedAddress));
  run(2, { FIXTURE_SAJ_ADDRESS: differentRejectedAddress, FIXTURE_NOW: '2026-10-26T16:00:00.000Z' });
  const repeatedDistinct = JSON.parse(await readFile(join(fixture, 'data/build/structured-place-facts.json')));
  assert.deepEqual(repeatedDistinct.sourceHistory, distinctRejected.sourceHistory);
  assert.equal(repeatedDistinct.refreshCounts.changed, 0);
} finally {
  await rm(fixture, { recursive: true, force: true });
}
console.log('Reviewed fact batch passed: five exact identities, owner hours/menu/contact, dated exceptions, held unknowns, catalog/browser parity, retained/fresh Saj address rejection, and idempotent rejected refreshes.');
