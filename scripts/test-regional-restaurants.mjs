import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import identity from '../app-restaurant-identity.js';
import lifecycle from '../restaurant-corrections.js';
const place = (id, address, extra = {}) => ({ id, name:'Example Cafe', address, website:'https://brand.example/', ...extra });
const a = place('original', '10 Main Street, Dartmouth');
assert.equal(identity.decide(a, place('other', '11 Main Street, Dartmouth')).state, 'distinct');
assert.equal(identity.decide(a, place('other', '10 Main Road, Dartmouth')).state, 'distinct');
assert.equal(identity.decide(a, place('other', '10 Main Street, Sackville')).state, 'review');
assert.equal(identity.decide(a, place('other', '')).state, 'review');
assert.equal(identity.decide(place('a', '10 Main Street'), place('b', '10 Main Street, Dartmouth')).state, 'review');
assert.equal(identity.decide(place('a', '10 Main Street'), place('b', '10 Main Street')).state, 'review');
assert.equal(identity.decide(place('a', '10 Main Street, Unit 1, Dartmouth'), place('b', '10 Main Street, Unit 2, Dartmouth')).state, 'distinct');
const raw = (id, tags) => place(id, '10 Main Street', { osm:{ rawTags:tags } });
assert.equal(identity.decide(raw('a', { 'addr:unit':'1', 'addr:city':'Dartmouth' }), raw('b', { 'addr:unit':'2', 'addr:city':'Dartmouth' })).state, 'distinct');
assert.equal(identity.decide(raw('a', { 'addr:city':'Dartmouth' }), raw('b', { 'addr:city':'Sackville' })).state, 'review');
assert.equal(identity.decide(place('a', '1-10 Main Street, Dartmouth'), place('a', '2-10 Main Street, Dartmouth')).state, 'review');
assert.equal(identity.decide(a, place('original', '20 Main Street, Dartmouth')).state, 'review');
assert.equal(identity.decide(a, place('other', a.address, { name:'Different Business' })).state, 'distinct');
assert.equal(identity.decide(place('a', '', { coordinates:{lat:44.6,lon:-63.5} }), place('b', '', {coordinates:{lat:44.8,lon:-63.8}})).state, 'distinct');
const aliases = [{ from:'alias', to:'original', reviewedAt:'2026-10-20', reason:'Owner confirms exact same location', sourceUrl:'https://brand.example/contact' }];
const incoming = place('alias', a.address, {name:'Former Name',sources:[{type:'restaurant_site',url:'https://brand.example/contact'}]});
const decision = identity.find([a], incoming, aliases);
assert.equal(decision.state, 'match');
const merged = identity.merge(structuredClone(a), incoming, decision);
assert.equal(merged.id, 'original');
assert(merged.aliasIds.includes('alias'));
assert.equal(merged.mergedIdentityEvidence[0].reviewedAlias.sourceUrl, aliases[0].sourceUrl);
assert.equal(identity.decide(a, {...incoming,address:'20 Main Street, Dartmouth'},aliases).state,'review');
const seasonal = {operatingStatus:'active',lifecycleSchedule:{seasonEndsOn:'2026-10-25'}};
assert.equal(lifecycle.status(seasonal,new Date('2026-10-26T02:59:59Z')),'active','Season closes after October25 in Halifax, not UTC');
assert.equal(lifecycle.status(seasonal,new Date('2026-10-26T03:00:00Z')),'seasonally_closed');
assert.equal(lifecycle.status(seasonal,new Date('2027-06-01T12:00:00Z')),'seasonally_closed','No invented next-year reopening');
assert(!lifecycle.isActive({operatingStatus:'seasonally_closed'}));
assert.equal(lifecycle.status({...seasonal,operatingStatus:'permanently_closed'},new Date('2026-10-26T12:00:00Z')),'permanently_closed');

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('data/build/catalog.json',root)));
const regional = JSON.parse(await readFile(new URL('data/reviewed-regional-restaurants.json',root)));
const enrichment = JSON.parse(await readFile(new URL('data/reviewed-regional-enrichment.json',root)));
assert.equal(enrichment.records.length,regional.accepted.length);
assert(enrichment.records.length>=47);
const savedWrites=[];
const context = vm.createContext({window:{},document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>JSON.stringify(['matadora-tapas-bar-halifax','osm-node-37132554-press-gang']),setItem:(key,value)=>savedWrites.push(value)},console,URL,Date,Intl,Set,Map});
const html = await readFile(new URL('index.html',root),'utf8');
for(const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
  const file=match[1]; if(file.startsWith('vendor/'))continue;
  vm.runInContext(await readFile(new URL(file,root),'utf8'),context,{filename:file,timeout:60000});
  if(file==='app-source-signals.js') vm.runInContext(`{const r=restaurants.find(item=>item.id==='tuna-blue-hubbards');if(r){r.openingHours='Mo-Su 00:00-24:00';r.hasOpening=true;r.hasMenu=true;r.menuLinks=[{url:'https://example.com/stale'}];}}`,context);
  if(file==='app-lifecycle.js')break;
}
const browser=JSON.parse(vm.runInContext('JSON.stringify(restaurants)',context));
vm.runInContext(await readFile(new URL('app-home.js',root),'utf8'),context,{filename:'app-home.js'});
const homeOpeningIds=JSON.parse(vm.runInContext('JSON.stringify(homeOpeningLeads().map(r=>r.id))',context));
assert(homeOpeningIds.length>0,'Existing explicit opening signals still produce home leads');
for(const row of regional.accepted) assert(!homeOpeningIds.includes(row.id),'Recently cataloged established location is not a home opening: '+row.id);
const explicitOpening=browser.find(row=>row.id==='sakaba-halifax');
const established=browser.find(row=>row.id==='esquire-restaurant-bedford');
assert.equal(explicitOpening.hasOpening,true,'Existing explicit reported-opening record retained');
assert.equal(established.hasOpening,false);
context.homeOpeningFixtures=[{...established,freshnessDate:'2099-01-01'},explicitOpening,{id:'missing-opening-flag',sourceLayer:'local_discovery',freshnessDate:'2099-01-02'}];
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(homeOpeningLeads(homeOpeningFixtures).map(r=>r.id))',context)),[explicitOpening.id],'Catalog freshness/source layer cannot create an opening claim; an explicit opening remains eligible');
assert.deepEqual(browser.map(r=>r.id).sort(),catalog.restaurants.map(r=>r.id).sort(),'Runtime/export identity parity');
assert.deepEqual(JSON.parse(JSON.stringify(context.window.__halifaxIdentityReviewQueue)),catalog.identityReviewQueue);
for(const accepted of regional.accepted){
  const published=catalog.restaurants.find(r=>r.id===accepted.id);const runtime=browser.find(r=>r.id===accepted.id);
  assert(published&&runtime,accepted.id);
  for(const field of ['name','address','website','operatingStatus','openingHours','coordinates']) assert.equal(JSON.stringify(runtime[field]),JSON.stringify(published[field]),accepted.id+':'+field);
  assert.equal(runtime.hasOpening,false,'Established restaurant is not a new-opening claim: '+accepted.id);
  const evidence=enrichment.records.find(row=>row.id===accepted.id);assert(evidence);
  assert.equal(JSON.stringify(published.coordinates),JSON.stringify(evidence.fields.coordinates.status==='verified'?evidence.fields.coordinates.value:null),'No guessed location centroid: '+accepted.id);
  if(published.openingHours) assert.equal(published.openingHours,evidence.fields.hours.publishedText);
}
for(const name of ["Antoinette's Cheesecakes",'Apartment 3 Espresso Bar']) {
  const records=browser.filter(r=>r.name===name);assert.equal(records.length,name.startsWith('Antoinette')?3:2);assert.equal(new Set(records.map(r=>r.address)).size,records.length);
}
const tuna=browser.find(r=>r.id==='tuna-blue-hubbards');assert.equal(tuna.operatingStatus,'seasonally_closed');assert.equal(tuna.openingHours,null);assert.equal(tuna.hasMenu,false);assert.equal(tuna.hasOpening,false);assert.equal(tuna.menuLinks.length,0);
assert.equal(browser.find(r=>r.id==='field-guide').operatingStatus,'permanently_closed');
assert.equal(savedWrites.length,1,'Merged legacy bookmarks persist once');
assert.deepEqual(JSON.parse(savedWrites[0]).sort(),['osm-node-13286396472-matadora-tapas-bar','the-press-gang'].sort());
assert.equal(identity.decide({name:'Big Wedge',address:''},{name:'Big Wedge',address:'5019 Highway 7, Porters Lake'}).state,'review');
const builder=await readFile(new URL('scripts/build-discovered-restaurants.mjs',root),'utf8');assert(!builder.includes('item.vibe || ["new opening"]'));
const explore=await readFile(new URL('app-explore.js',root),'utf8');assert(!explore.includes('liveNeighbourhoods.slice(0, 24)'));
console.log('Regional regressions passed: branch/unit/city isolation, evidence aliases, ambiguous identity holds, lifecycle dates, runtime/export parity, bookmarks, and established discovery flags.');

// The targeted Bedford audit must expand coverage without losing or relocating
// old identities, hiding unpinned places, or reviving closed source-directory leads.
const bedfordAudit = JSON.parse(await readFile(new URL('data/bedford-hammonds-coverage-audit.json',root)));
const { createHash } = await import('node:crypto');
const addedIds = new Set(bedfordAudit.acceptedIds);
const preservedIds = bedfordAudit.baseline.canonicalIds.slice().sort();
for (const id of preservedIds) assert(catalog.restaurants.some(row => row.id === id || row.aliasIds?.includes(id)), 'Baseline identity remains directly reachable or explicitly aliased: '+id);
assert.equal(preservedIds.length, bedfordAudit.baseline.canonicalCount);
assert.equal(createHash('sha256').update(JSON.stringify(preservedIds)).digest('hex'), bedfordAudit.baseline.canonicalIdsSha256, 'All baseline canonical IDs are preserved');
assert.equal(bedfordAudit.completeCensus,false,'A targeted batch must not imply exhaustive coverage');
for (const id of addedIds) {
  const record = browser.find(row => row.id === id);
  assert(record, id);
  assert.equal(browser.filter(row => row.id === id).length,1,'One canonical record per addition');
  context.bedfordTestArea = record.neighborhood;
  const ids = JSON.parse(vm.runInContext('JSON.stringify(filteredRestaurants({query:"",neighbourhood:bedfordTestArea,cuisine:"all",feature:"all",sort:"name"}).map(row=>row.id))',context));
  assert(ids.includes(id),'Area filter exposes accepted location even with unknown coordinates: '+id);
  assert.equal(record.hasOpening,false,'Newly catalogued does not mean newly opened');
}
for (const correction of bedfordAudit.areaCorrections) {
  const record = browser.find(row => row.id === correction.id);
  assert.equal(record.neighborhood,correction.to);
  context.bedfordTestArea=correction.to;
  const ids=JSON.parse(vm.runInContext('JSON.stringify(filteredRestaurants({query:"",neighbourhood:bedfordTestArea,cuisine:"all",feature:"all",sort:"name"}).map(row=>row.id))',context));
  assert(ids.includes(record.id),'Corrected Larry Uteck record is discoverable');
}
assert(!browser.some(row=>/^Sunnyside Restaurant$/i.test(row.name)),'Stale open website must not revive flood-closed Sunnyside');
assert.equal(browser.find(row=>row.id==='makhani-bistro-bedford').openingHours,null,'Ambiguous Sunday midnight must not silently become noon');
assert.equal(browser.find(row=>row.id==='mill-cove-brew-pub-bedford').hoursScope,'kitchen','Kitchen hours must not become bar hours');
assert.equal(browser.filter(row=>row.id==='osm-node-2704746819-morris-east').length,1,'Held Morris East orphan stays intact');
console.log(`Bedford audit passed: ${addedIds.size} additions, ${bedfordAudit.areaCorrections.length} area repairs, all ${preservedIds.length} baseline IDs retained.`);

const alexandraPin=regional.accepted.find(row=>row.id==='alexandras-hammonds-plains').publishedFields;
assert.equal(alexandraPin.coordinates,null,'Conflicting owner/directory pin must remain unpublished');
assert.equal(alexandraPin.fieldEvidence.coordinates.disposition,'held_conflicting_coordinates');
assert.equal(alexandraPin.fieldEvidence.coordinates.successfulSourceReceipts[0].sha256,'774292ede4aa5587ee6966f244da85748704c1467c8a1cbfddbe605c1ead24c4');
const turkuazHours=regional.accepted.find(row=>row.id==='turkuaz-bedford').publishedFields;
assert.equal(turkuazHours.openingHours,'Mo-Th 12:00-22:00; Fr-Sa 11:00-23:00; Su 12:00-22:00');
const heldDisposition=JSON.parse(await readFile(new URL('data/regional-held-dispositions.json',root)));
assert.equal(heldDisposition.records.length,43);
assert.equal(new Set(heldDisposition.records.map(row=>row.auditKey)).size,43);
assert.deepEqual(heldDisposition.records.map(row=>row.name).sort(),regional.held.map(row=>row.name).sort());
assert(heldDisposition.records.every(row=>row.disposition==='retain_hold'&&row.newListingApproved===false));
assert(!JSON.stringify(heldDisposition).includes('/workspace/'),'Published audit must not leak local work paths');
for(const row of heldDisposition.records)for(const receipt of row.sourceAttempts||[])if(/suspendedpage|unavailable/i.test(receipt.finalUrl||''))assert.notEqual(receipt.qualifiedContentReceived,true);
