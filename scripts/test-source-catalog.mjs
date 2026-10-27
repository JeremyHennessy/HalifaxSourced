import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import vm from 'node:vm';
import { buildCatalog, buildFromDisk, publicUrl } from './build-source-catalog.mjs';
const fixture = () => ({
  'data/update-policy.json': {lanes:[{id:'city-events',targetHours:6,workflow:'city-events-preview.yml'}]},
  'data/event-source-registry.json': {sources:[{id:'one',name:'One',url:'https://example.org/events',mode:'calendar'}]},
  'data/build/city-events.json': {sourceStats:[{sourceId:'one',status:'ok',observedAt:'2026-10-20T12:00:00Z'}]}
});
let checks = 0;
function test(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
test('known receipts keep separate clocks', () => {
  const row = buildCatalog(fixture()).sources[0];
  assert.equal(row.lastAttemptAt,'2026-10-20T12:00:00.000Z');
  assert.equal(row.lastSuccessAt,row.lastAttemptAt);
  assert.equal(row.contentAt,null);
  assert.equal(row.parser,'calendar');
});
test('blocked and yield-anomaly receipts cannot manufacture successful collection', () => {
  for (const receipt of [{status:'blocked'}, {status:'yield_anomaly'}, {status:'ok',state:'yield_anomaly'}, {status:'ok',reason:'yield_anomaly'}, {status:'unknown'}, {}]) {
    const input = fixture(); input['data/build/city-events.json'].sourceStats = [{sourceId:'one',observedAt:'2026-10-22',...receipt}];
    assert.equal(buildCatalog(input).sources[0].lastSuccessAt,null,JSON.stringify(receipt));
  }
});
test('unattempted receipts never create attempt or success clocks', () => {
  const input = fixture(); input['data/build/city-events.json'].sourceStats = [{sourceId:'one',status:'ok',attempted:false,observedAt:'2026-10-22'}];
  const row = buildCatalog(input).sources[0]; assert.equal(row.lastSuccessAt,null); assert.equal(row.lastAttemptAt,null);
});
test('later blocked receipts retain a prior explicit success without advancing it', () => {
  const input = fixture(); input['data/build/city-events.json'].sourceStats.push({sourceId:'one',status:'blocked',observedAt:'2026-10-22'});
  const row = buildCatalog(input).sources[0]; assert.equal(row.state,'held'); assert.equal(row.lastSuccessAt,'2026-10-20T12:00:00.000Z'); assert.equal(row.lastAttemptAt,'2026-10-22T00:00:00.000Z');
  input['data/build/city-events.json'].sourceStats = [{sourceId:'one',status:'blocked',observedAt:'2026-10-22',lastSuccessAt:'2026-10-19'}];
  assert.equal(buildCatalog(input).sources[0].lastSuccessAt,'2026-10-19T00:00:00.000Z');
});
test('legacy content-only records do not establish successful collection', () => {
  const input = {'data/build/website-feed-signals.json':{posts:[{restaurantId:'one',feedUrl:'https://example.org/feed',observedAt:'2026-10-20'}]}};
  assert.equal(buildCatalog(input).sources[0].lastSuccessAt,null);
});
test('news cadence comes from the regional-news policy lane', () => {
  const input = fixture(); input['data/update-policy.json'].lanes.push({id:'regional-news',targetHours:6,workflow:'news-preview.yml'});
  input['data/news-source-registry.json'] = {sources:[{id:'news',homeUrl:'https://example.org/news',enabled:false}]};
  assert.equal(buildCatalog(input).sources.find(row=>row.family==='news').targetHours,6);
});
test('registered ID collisions fail closed', () => {
  const input = fixture(); input['data/event-source-supplements.json'] = {sources:[{id:'one',url:'https://different.org/'}]};
  assert.throws(() => buildCatalog(input), /Conflicting registered source ID/);
});
test('same identifiers in separate families never collide', () => {
  const input = fixture(); input['data/news-source-registry.json'] = {sources:[{id:'one',homeUrl:'https://example.org/news',enabled:false}]};
  assert.equal(new Set(buildCatalog(input).sources.map(x => x.id)).size,2);
});
test('held wins over recent successful and failed receipts', () => {
  const input = fixture(); input['data/event-source-registry.json'].sources[0].enabled = false;
  input['data/build/city-events.json'].sourceStats.push({sourceId:'one',status:'failed',reason:'timeout',observedAt:'2026-10-21'});
  const row = buildCatalog(input).sources[0]; assert.equal(row.state,'held'); assert.equal(row.enabled,false);
  assert.equal(row.lastSuccessAt,'2026-10-20T12:00:00.000Z');
});
test('explicit access holds preserve attempt and historical success without inventing a new success', () => {
  const input = fixture(); input['data/source-link-access-holds.json'] = {observations:[{url:'https://example.org/events',observedAt:'2026-10-22',status:403}]};
  const row = buildCatalog(input).sources[0]; assert.equal(row.state,'held'); assert.equal(row.lastAttemptAt,'2026-10-22T00:00:00.000Z'); assert.equal(row.lastSuccessAt,'2026-10-20T12:00:00.000Z');
});
test('unknown legacy clocks are never synthesized from generatedAt or lastVerifiedAt', () => {
  const input = {'data/build/first-party-sources.json':{generatedAt:'2026-10-27',records:[{restaurantId:'one',website:'https://example.org',observedAt:'2026-10-26',lastVerifiedAt:'2026-10-26'}]}};
  const row = buildCatalog(input).sources[0];
  for (const key of ['lastAttemptAt','lastSuccessAt','contentAt']) assert.equal(row[key],null);
  assert.equal(row.enabled,null);
});
test('malformed sources safely skipped and unsafe URLs rejected', () => {
  assert.equal(buildCatalog({'data/event-source-registry.json':{sources:[null,5,'text',[],{}, {id:'bad',url:'javascript:alert(1)'},{id:'bad2',url:'https://user:secret@example.org'}]}}).sources.length,0);
  assert.equal(publicUrl('https://example.org/feed?token=secret&region=29#private'),'https://example.org/feed?region=29');
});
test('no raw diagnostics or credentials reach public rows', () => {
  const input = fixture(); input['data/build/city-events.json'].sourceStats = [{sourceId:'one',status:'failed',reason:'token=supersecret',error:'raw diagnostic',observedAt:'2026-10-21'}];
  const output = JSON.stringify(buildCatalog(input)); assert.ok(!output.includes('supersecret')); assert.ok(!output.includes('raw diagnostic'));
});
test('generated timestamp churn does not change the catalogue', () => {
  const input = fixture(), before = JSON.stringify(buildCatalog(input));
  input['data/build/city-events.json'].generatedAt = new Date().toISOString();
  assert.equal(JSON.stringify(buildCatalog(input)),before);
});
test('malformed future publication dates cannot advance the snapshot clock', () => {
  const input = fixture();
  input['data/build/website-feed-signals.json'] = {posts:[{restaurantId:'one',feedUrl:'https://example.org/feed',publishedAt:'9897-01-01',observedAt:'2026-10-20'}]};
  const output = buildCatalog(input);
  assert.equal(output.snapshotAt,'2026-10-20T12:00:00.000Z');
  assert.equal(output.sources.find(x => x.family === 'website-feeds').contentAt,null);
});
test('reviewed exclusions override discovered active profile', () => {
  const input = {'data/build/first-party-sources.json':{records:[{restaurantId:'one',website:'https://example.org',socialProfiles:[{url:'https://social.example.org/one',status:'active'}]}]},'data/social-profile-review-overrides.json':{records:[{restaurantId:'one',profileUrls:['https://social.example.org/one/']}]}};
  assert.equal(buildCatalog(input).sources.find(x => x.family === 'social-profiles').state,'held');
});
test('social vocabulary does not imply enabled collectors', () => {
  const input = {'data/social-platform-registry.json':{platforms:[{id:'one',label:'One'}]}};
  assert.equal(buildCatalog(input).sources[0].enabled,null);
});
const source = await readFile(new URL('../app-admin-status.js',import.meta.url),'utf8');
const sandbox = {window:{}, URL, Date, console}; vm.createContext(sandbox); vm.runInContext(source,sandbox);
test('UI escapes source text and exposes honest unknown clocks', () => {
  const row = {name:'<script>bad</script>',family:'news',state:'unknown',provenance:[]};
  const html = sandbox.renderCatalogRow(row); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Last successful collection')); assert.ok(html.includes('Unknown'));
});
test('view-time staleness never overrides held', () => {
  assert.equal(sandbox.catalogCurrentState({lastSuccessAt:'2020-01-01',targetHours:6,held:true}),'held');
  assert.equal(sandbox.catalogCurrentState({lastSuccessAt:'2020-01-01',targetHours:6,enabled:true}),'stale');
});
test('missing inventory has a clear unavailable state', () => { assert.match(sandbox.renderSourceCatalog({__loadError:'not found'}),/unavailable in this release/); });
test('search, filters and pagination bound the rendered result set', () => {
  const controls = new Map();
  for (const key of ['query','state','family','previous','next','results','result-count']) controls.set(`[data-catalog-${key}]`,{value:'',events:{},addEventListener(type,fn){this.events[type]=fn;}});
  sandbox.document = {querySelector:()=>({querySelector:key=>controls.get(key)})};
  const sources = Array.from({length:65},(_,i)=>({id:String(i),name:`Source ${i}`,family:i===0?'news':'events',state:'unknown',provenance:[]}));
  sandbox.bindSourceCatalog({sources});
  assert.match(controls.get('[data-catalog-result-count]').textContent,/Showing 1–30/);
  controls.get('[data-catalog-next]').events.click();
  assert.match(controls.get('[data-catalog-result-count]').textContent,/Showing 31–60/);
  const family = controls.get('[data-catalog-family]'); family.value='news'; family.events.change();
  assert.match(controls.get('[data-catalog-result-count]').textContent,/1 matches/);
  assert.equal(controls.get('[data-catalog-next]').disabled,true);
  const query = controls.get('[data-catalog-query]'); query.value='missing'; query.events.input();
  assert.equal(controls.get('[data-catalog-results]').innerHTML,'<p>No matching sources.</p>');
});
await buildFromDisk();
const target = new URL('../data/build/source-catalog.json',import.meta.url), before = await readFile(target,'utf8'), beforeStat = await stat(target);
await buildFromDisk();
assert.equal(await readFile(target,'utf8'),before); assert.equal((await stat(target)).mtimeMs,beforeStat.mtimeMs); checks++;
const actual = JSON.parse(before); assert.equal(new Set(actual.sources.map(x => x.id)).size,actual.sources.length); checks++;
console.log(`${checks} source catalogue checks passed; ${actual.counts.total} unique rows; unchanged rebuild preserves bytes and mtime.`);
