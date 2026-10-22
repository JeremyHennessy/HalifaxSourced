import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { retainFailedPublicSpecialSources, readPreviousPublicSpecialRecords } from './lib/public-special-refresh-safety.mjs';

const previous = JSON.parse(await readFile(new URL('../data/build/public-special-source-leads.json', import.meta.url)));
const failures = [
  { sourceId:'halifax-events-happy-hour', reason:'api_http_401', observedAt:'2026-10-21T14:33:21.309Z', sourceUrl:'https://halifaxevents.ca/happy-hour' },
  { sourceId:'downtown-dartmouth-food-crawl-spring-2026', reason:'food_crawl_section_not_found', observedAt:'2026-10-21T14:33:21.309Z', sourceUrl:'https://www.downtowndartmouth.ca/foodcrawl' }
];
const context = {window:{}};
vm.runInNewContext(await readFile(new URL('../data/public-special-source-leads.js',import.meta.url),'utf8'),context);
assert.equal(JSON.stringify(context.window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS),JSON.stringify(previous),'JSON and window payloads agree');
assert.equal(previous.counts.total,previous.records.length);
const failedIds = new Set(failures.map(row=>row.sourceId));
const before = JSON.stringify(previous.records);
const successful = previous.records.filter(row=>!failedIds.has(row.sourceId));
const repaired = retainFailedPublicSpecialSources(successful, previous.records, failures);
assert.equal(repaired.length, previous.records.length);
for (const original of previous.records) {
  const actual = repaired.find(row=>row.sourceRecordId===original.sourceRecordId);
  if (!failedIds.has(original.sourceId)) assert.deepEqual(actual,original);
  else {
    const strip = ({refreshState,sourceFailure,...row})=>row;
    assert.deepEqual(strip(actual),strip(original));
    assert.equal(actual.refreshState,'retained_after_failure');
  }
}
assert.equal(JSON.stringify(previous.records),before);
const partial = { ...previous.records.find(row=>failedIds.has(row.sourceId)), title:'Wrong partial extraction', observedAt:'2026-10-22T00:00:00Z' };
assert.deepEqual(retainFailedPublicSpecialSources([...successful,partial],previous.records,failures),repaired);
assert.deepEqual(retainFailedPublicSpecialSources(successful,repaired,failures),repaired);
const later = retainFailedPublicSpecialSources(successful,repaired,failures.map(row=>({...row,observedAt:'2026-10-22T00:00:00Z'})));
assert.deepEqual(later.map(row=>row.observedAt),repaired.map(row=>row.observedAt));
assert.deepEqual(retainFailedPublicSpecialSources([],[],failures),[]);
assert.deepEqual(retainFailedPublicSpecialSources([],repaired,[]),[],'Successful empty collection is distinct from failure');
const recovered = {...partial,refreshState:undefined,sourceFailure:undefined};
assert.deepEqual(retainFailedPublicSpecialSources([recovered],repaired,[]),[recovered]);
const dine = successful[0];
assert.deepEqual(retainFailedPublicSpecialSources([{...dine,title:'Partial'}],[dine],[{sourceId:dine.sourceId,reason:'detail_http_500'}])[0].title,dine.title);

const root=await mkdtemp(join(tmpdir(),'halifax-special-retention-'));
try {
  await mkdir(join(root,'scripts/lib'),{recursive:true}); await mkdir(join(root,'data/build'),{recursive:true});
  assert.deepEqual(await readPreviousPublicSpecialRecords(join(root,'absent.json')),[]);
  await writeFile(join(root,'invalid.json'),'{broken');
  await assert.rejects(readPreviousPublicSpecialRecords(join(root,'invalid.json')));
  await writeFile(join(root,'invalid.json'),'{}');
  await assert.rejects(readPreviousPublicSpecialRecords(join(root,'invalid.json')));
  await cp(new URL('./lib/',import.meta.url),join(root,'scripts/lib'),{recursive:true});
  const denyNetwork=join(root,'scripts/lib/deny-source-network.mjs');
  await copyFile(new URL('../source-integrity.js',import.meta.url),join(root,'source-integrity.js'));
  await copyFile(new URL('../data/source-link-access-holds.json',import.meta.url),join(root,'data/source-link-access-holds.json'));
  await copyFile(new URL("../app-media.js",import.meta.url),join(root,"app-media.js"));
  for (const name of ['build-structured-specials.mjs','build-recent-social-posts.mjs','build-thumbnail-candidates.mjs']) await copyFile(new URL(name,import.meta.url),join(root,'scripts',name));
  const fresh = new Date().toISOString();
  const lead = {sourceRecordId:'retained-recurring',sourceId:'halifax-events-happy-hour',restaurantId:'fixture-restaurant',venueName:'Fixture',title:'Historical recurring offer',description:'Happy hour special',sourceUrl:'https://fixture.example/special',sourcePageUrl:'https://fixture.example/special',sourceImageUrl:'https://fixture.example/photo.jpg',observedAt:'2020-01-01T00:00:00Z',publishedAt:fresh,sourceUpdatedAt:fresh,validTo:null,recurrence:'Daily',active:true,matchConfidence:'high',refreshState:'retained_after_failure',sourceFailure:failures[0],rightsState:'requires_rights_review'};
  const expired = {...lead,sourceRecordId:'retained-expired',title:'Expired event offer',sourceUrl:'https://fixture.example/expired',validTo:'2020-01-02'};
  const unknownClock={...lead,sourceRecordId:'retained-null-clock',title:'Unknown-clock historical image',sourceUrl:'https://fixture.example/unknown',sourceImageUrl:'https://fixture.example/unknown.jpg',observedAt:null};
  const put=async(path,data)=>writeFile(join(root,path),JSON.stringify(data));
  await put('data/build/catalog.json',{restaurants:[{id:'fixture-restaurant',name:'Fixture',website:'https://fixture.example/'}]});
  await put('data/build/first-party-sources.json',{records:[]});
  await put('data/build/public-special-source-leads.json',{records:[lead,expired,unknownClock]});
  for(const name of ['build-structured-specials.mjs','build-recent-social-posts.mjs','build-thumbnail-candidates.mjs']) {
    const run=spawnSync(process.execPath,['--import',denyNetwork,join(root,'scripts',name)],{cwd:root,encoding:'utf8',env:{...process.env,THUMBNAIL_DISCOVERY_FETCH:'0',THUMBNAIL_IMAGE_PROBE:'0'}});
    assert.equal(run.status,0,`${name}: ${run.stderr}\n${run.stdout}`);
  }
  const specials=JSON.parse(await readFile(join(root,'data/build/structured-specials.json'))).records;
  assert.equal(specials.find(row=>row.title===lead.title).status,'stale');
  assert.equal(specials.find(row=>row.title===expired.title).status,'expired');
  assert.ok(specials.every(row=>row.verifiedAt===null && !['verified_current','likely_recurring_verify'].includes(row.status)));
  assert.equal(specials.find(row=>row.title===lead.title).observedAt,lead.observedAt);
  assert.equal(specials.find(row=>row.title===unknownClock.title).observedAt,null,'Source update date must not become an observation clock');
  assert.equal(JSON.parse(await readFile(join(root,'data/build/recent-social-posts.json'))).records.length,0,'Failed-source evidence is not a fresh social post');
  const thumbnails=JSON.parse(await readFile(join(root,'data/build/thumbnail-candidates.json')));
  const all=thumbnails.candidates || thumbnails.records || [];
  const candidate=all.find(row=>row.thumbnailUrl===unknownClock.sourceImageUrl);
  assert.ok(candidate,'Retained historical image evidence remains available for review');
  assert.equal(candidate.observedAt,null); assert.equal(candidate.rightsStatus,'requires_rights_review');
  assert.equal(candidate.reviewState,'candidate_review');
  assert.equal(candidate.refreshState,'retained_after_failure');
  // Keep the real shared helpers intact. Only these finite synthetic robots
  // responses exist; transport remains denied and no content request is allowed.
  await copyFile(new URL('./import-public-special-source-leads.mjs',import.meta.url),join(root,'scripts/import-public-special-source-leads.mjs'));
  const robotsUrls=[
    'https://halifaxevents.ca/robots.txt',
    'https://downtownhalifax.ca/robots.txt',
    'https://www.downtowndartmouth.ca/robots.txt'
  ];
  await writeFile(join(root,'scripts/run-importer-fixture.mjs'),`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const fixtures = new Map(${JSON.stringify(robotsUrls)}.map(url => [url, {status:403, body:'Forbidden'}]));
const requests = [];
const unexpected = [];
globalThis.fetch = async url => {
  const target = String(url);
  requests.push(target);
  const fixture = fixtures.get(target);
  if (!fixture) {
    unexpected.push(target);
    throw new Error('Unexpected fixture URL: ' + target);
  }
  return new Response(fixture.body, {status:fixture.status, headers:{'content-type':'text/plain'}});
};
let importError;
try { await import('./import-public-special-source-leads.mjs'); }
catch (error) { importError = error; }
await writeFile(new URL('../importer-requests.json', import.meta.url), JSON.stringify({requests, unexpected}));
assert.deepEqual(unexpected, [], 'Importer must never request an unconfigured URL');
if (importError) throw importError;
`);
  const runImporter = () => spawnSync(process.execPath,['--import',denyNetwork,join(root,'scripts/run-importer-fixture.mjs')],{cwd:root,encoding:'utf8'});
  const imported = runImporter();
  assert.equal(imported.error,undefined);assert.equal(imported.signal,null);
  assert.equal(imported.status,1,'Actual403 receipts must prevent publication: '+imported.stderr);
  const accessDiagnostics=imported.stderr.split('\n').filter(line=>line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line=>JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
  assert.equal(accessDiagnostics.length,3);
  assert(accessDiagnostics.every(item=>item.kind==='http_restriction' && item.disposition==='nonpublishable_requires_review' && item.evidence.receipt.status===403));
  assert.deepEqual(accessDiagnostics.map(item=>item.evidence.receipt.url),robotsUrls);
  const importerRequests=JSON.parse(await readFile(join(root,'importer-requests.json')));
  assert.deepEqual(importerRequests.unexpected,[]);
  assert.deepEqual(importerRequests.requests,robotsUrls,'Only one policy request per source origin; no content or fallback requests');
  const retainedOutput=JSON.parse(await readFile(join(root,'data/build/public-special-source-leads.json')));
  const retainedContext={window:{}};
  vm.runInNewContext(await readFile(join(root,'data/public-special-source-leads.js'),'utf8'),retainedContext);
  assert.equal(JSON.stringify(retainedContext.window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS),JSON.stringify(retainedOutput),'Retained JSON and window payloads agree');
  assert.equal(retainedOutput.records.length,3);
  assert.deepEqual(retainedOutput.failures.map(row=>row.sourceId),[
    'halifax-events-happy-hour','discover-halifax-dine-around-2026','downtown-dartmouth-food-crawl-spring-2026'
  ]);
  assert.ok(retainedOutput.failures.every(row=>row.reason==='robots_disallow'));
  for (const original of [lead,expired,unknownClock]) {
    const row=retainedOutput.records.find(item=>item.sourceRecordId===original.sourceRecordId);
    const strip=({refreshState,sourceFailure,...rest})=>rest;
    assert.deepEqual(strip(row),strip(original));
  }
  const invalid='{"records":null}';
  const previousWindowPayload=await readFile(join(root,'data/public-special-source-leads.js'),'utf8');
  await writeFile(join(root,'data/build/public-special-source-leads.json'),invalid);
  const refused=runImporter();
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/Invalid previous public-special snapshot/);
  assert.deepEqual(JSON.parse(await readFile(join(root,'importer-requests.json'))),{requests:[],unexpected:[]},'Invalid previous snapshot aborts before any source request');
  assert.equal(await readFile(join(root,'data/build/public-special-source-leads.json'),'utf8'),invalid);
  assert.equal(await readFile(join(root,'data/public-special-source-leads.js'),'utf8'),previousWindowPayload,'Invalid previous snapshot does not overwrite the window payload');

} finally { await rm(root,{recursive:true,force:true}); }
console.log('Public-special retention passed: source-atomic failure rollback, original clocks, stale/expired projections, no social activation or image-rights upgrade; offline only.');
