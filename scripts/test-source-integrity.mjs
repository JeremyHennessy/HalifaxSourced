import assert from 'node:assert/strict';
import integrity from '../source-integrity.js';
import { readFile } from 'node:fs/promises';
import { reviewedLocationLinks, reviewedCorrections } from './lib/reviewed-corrections.mjs';
const broken = JSON.parse(await readFile(new URL('../data/reviewed-broken-links.json',import.meta.url)));
for (const item of broken.records) {
  assert.equal(item.confirmedBroken,true);
  assert.equal(item.attempt,2);
  assert.equal(integrity.safeSource(item.url),false,item.url);
}
for (const url of ['https://www.magnoliahfx.com/','https://www.loupecou.com/','https://www.studioeastfood.ca/','https://www.brawtajerk.ca/','https://www.stardustbar.ca/']) assert.equal(integrity.safeSource(url),true,'Path quarantine must preserve official homepage');
const now=Date.parse('2026-10-06T12:00:00Z');
assert.equal(integrity.publicationState('2026-10-06T12:00:01Z',now).isRecent,false);
assert.equal(integrity.publicationState('2027-01-01',now).ageDays,null);
assert.equal(integrity.publicationState(null,now).dateState,'missing');
assert.equal(integrity.publicationState('2026-10-05',now).isRecent,true);
assert.deepEqual(integrity.publisherDates('<meta name="viewport" content="9897"><time datetime="2026-12-25"></time><meta property="article:modified_time" content="2026-10-06">',now),[]);
assert.deepEqual(integrity.publisherDates('<meta content="2026-10-05" property="article:published_time">',now),['2026-10-05T00:00:00.000Z']);
assert.deepEqual(integrity.publisherDates('<script type="application/ld+json">{"@type":"Event","startDate":"2026-10-05"}</script>',now),[]);
assert.deepEqual(integrity.publisherDates('<script type="application/ld+json">{"@type":"BlogPosting","datePublished":"2026-10-05"}</script>',now),['2026-10-05T00:00:00.000Z']);
const offer={status:'verified_current',sourceUrl:'https://local.example/special',verifiedAt:'2026-10-05',sourceType:'reviewed_restaurant_owned_source'};
assert.equal(integrity.currentOffer(offer,now),true);
for(const changed of [{verifiedAt:'2026-08-29'},{verifiedAt:'2026-10-07'},{validTo:'2026-10-01'},{validFrom:'2026-10-07'},{locationValidated:false},{sourceType:'official_website_link'},{sourceUrl:'https://justitalymentone.com'}]) assert.equal(integrity.currentOffer({...offer,...changed},now),false);
assert.equal(integrity.locationSafe({restaurantId:'osm-node-13141377001-india-paradise',postUrl:'https://www.indiaparadise.ca/post/calgary-free-biryani-alert'}),false);
assert.equal(integrity.safeSource('https://www.bowtiecreamery.com/a'),false);
assert.equal(integrity.safeSource('https://glitterbeancafe.com./'),false);
assert.equal(integrity.safeSource('https://WWW.justitalymentone.com../'),false);
assert.equal(integrity.sourceHost('https://www.fixture.example./'),'fixture.example');
const reviewedLinks = reviewedLocationLinks([
  {id:'active', sources:[{type:'menu', url:'https://local.example/menu'}, {type:'openstreetmap', url:'https://local.example/history'}]},
  {id:'archived', operatingStatus:'permanently_closed', sources:[{type:'menu',url:'https://closed.example/menu'}]}
], [
  {restaurantId:'active',website:'https://local.example/',menuUrl:'https://local.example/menu',socialProfiles:[{platform:'instagram',url:'https://www.instagram.com/local_fixture/'}]},
  {restaurantId:'archived',website:'https://closed.example/',menuUrl:'https://closed.example/menu'},
  {restaurantId:'excluded',website:'https://excluded.example/',menuUrl:'https://excluded.example/menu'}
]);
assert.deepEqual(reviewedLinks.map(item=>item.url).sort(), ['https://local.example/','https://local.example/menu','https://www.instagram.com/local_fixture/'].sort());
assert(reviewedLinks.every(item=>item.restaurantId==='active'), 'Archived and noncanonical identities must stay out of release scope');
const productionReviewed = reviewedLocationLinks([
  {id:'osm-node-4421124794-cafe-marco-polo'},
  reviewedCorrections.additions.find(item=>item.id==='larrys-sandwiches-dartmouth')
]);
for (const url of ['https://cafemarcopolodartmouth.com/11-2/','https://larryssandwiches.com/order']) assert(productionReviewed.some(item=>item.url===url),'Reviewed browser menu must be audited: '+url);
console.log('Source integrity regression passed: future/unknown dates, metadata scope, offer expiry, location, unsafe domains and active reviewed-link audit coverage.');
await import('./test-coverage-menu-sources.mjs');
await import('./test-place-facts-history.mjs');
