import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, mkdir, copyFile, writeFile, rm, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { buildCatalog, buildFromDisk, publicUrl } from './build-source-catalog.mjs';
import { validateOnboardingBacklog } from './lib/source-onboarding-backlog.mjs';
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
const openingSource = {name:'Halifax ReTales',type:'local_opening_watch',url:'https://halifax.retales.ca/feed/'};
test('configured opening-watch feed exists independently of retained leads or accepted snapshots', () => {
  const input = {'data/opening-watch-source-registry.json':{sources:[openingSource]}};
  const row = buildCatalog(input).sources[0];
  assert.equal(row.family,'opening-watch'); assert.equal(row.name,openingSource.name); assert.equal(row.url,openingSource.url);
  assert.equal(row.category,openingSource.type); assert.equal(row.sourceId,null);
  assert.equal(row.workflowUrl,'https://github.com/JeremyHennessy/HalifaxSourced/actions/workflows/restaurant-discovery-preview.yml');
  for (const key of ['lastAttemptAt','lastSuccessAt','contentAt','enabled','targetHours']) assert.equal(row[key],null,key);
  input['data/build/opening-watch-leads.json'] = {generatedAt:'2026-10-27',sources:[openingSource],leads:[{sourceName:openingSource.name,sourceUrl:'https://halifax.retales.ca/article/',observedAt:'2026-10-27',publishedAt:'2026-10-26'}]};
  const output = buildCatalog(input);
  assert.equal(output.sources.length,1); assert.equal(output.snapshotAt,null);
  assert.equal(output.sources[0].id,row.id); assert.equal(output.sources[0].lastSuccessAt,null); assert.equal(output.sources[0].contentAt,null);
  assert.deepEqual(output.sources[0].provenance,['data/build/opening-watch-leads.json','data/opening-watch-source-registry.json']);
});
test('opening-watch failures and access holds are retained without inventing receipt clocks', () => {
  const input = {'data/opening-watch-source-registry.json':{sources:[openingSource]},'data/build/opening-watch-leads.json':{generatedAt:'2026-10-27',failures:[{sourceName:openingSource.name,sourceUrl:openingSource.url,reason:'timeout'}]}};
  let row = buildCatalog(input).sources[0];
  assert.equal(row.state,'failing'); assert.equal(row.lastAttemptAt,null); assert.equal(row.lastSuccessAt,null);
  input['data/source-link-access-holds.json'] = {observations:[{url:openingSource.url,observedAt:'2026-10-22',status:403}]};
  row = buildCatalog(input).sources[0];
  assert.equal(row.state,'held'); assert.equal(row.lastAttemptAt,'2026-10-22T00:00:00.000Z'); assert.equal(row.lastSuccessAt,null);
  input['data/build/opening-watch-leads.json'].failures = [{sourceUrl:'https://different.example/feed/',reason:'timeout'}];
  assert.equal(buildCatalog(input).sources.length,1,'An unrelated historical failure cannot admit another configured source');
});
test('counts distinguish catalogue rows, sanitized URLs and normalized hosts', () => {
  const input = {'data/build/catalog.json':{restaurants:[{id:'one',sources:[
    {url:'https://WWW.Example.org/path?token=secret#private'},
    {url:'https://www.example.org/path?token=other'},
    {url:'https://example.org./other'},
    {url:'http://example.org:8080/path'},
    {url:'https://branch.example.org/path'}
  ]},{id:'two',sources:[{url:'https://www.example.org/path'}]}]},'data/social-platform-registry.json':{platforms:[{id:'url-free',label:'Unknown URL'}]}};
  const output = buildCatalog(input);
  assert.equal(output.counts.total,6); assert.equal(output.counts.distinctUrls,4); assert.equal(output.counts.distinctHosts,2);
  assert.equal(output.counts.unknown,6); assert.ok(!JSON.stringify(output).includes('secret'));
  assert.deepEqual(buildCatalog({}).counts,{total:0,distinctUrls:0,distinctHosts:0,enabled:0,held:0,failing:0,stale:0,unknown:0});
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
const onboardingPath = 'data/source-onboarding-backlog.json';
const onboarding = JSON.parse(await readFile(new URL('../'+onboardingPath,import.meta.url),'utf8'));
const onboardingFixture = () => ({[onboardingPath]:structuredClone(onboarding)});
test('onboarding schema keeps 13 candidates and 10 manual holds disabled, without invented feeds', () => {
  assert.equal(validateOnboardingBacklog(onboarding),onboarding);
  assert.equal(onboarding.candidates.length,13); assert.equal(onboarding.holds.length,10);
  assert.deepEqual(onboarding.candidates.filter(row => row.rank).map(row => row.rank),[1,2,3,4,5,6,7,8]);
  const expectedUrls = {
    'bus-stop-theatre-direct':'https://busstoptheatre.coop/venue/bst/',
    'sanctuary-arts-centre-direct':'https://sanctuaryartscentre.com/events-calendar',
    'pier21-events':'https://pier21.ca/events', 'agns-direct-events':'https://agns.ca/',
    'bella-rose-events':'https://bellaroseartscentre.com/events/', 'dartmouth-players':'https://dartmouthplayers.ns.ca/',
    'halifax-water-notices':'https://halifaxwater.ca/notices-and-news', 'halifax-harbour-bridges':'https://halifaxharbourbridges.ca/',
    'the-coast':'https://www.thecoast.ca/', 'the-signal':'https://signalhfx.ca/',
    'halifax-partnership-news':'https://halifaxpartnership.com/news/', 'discovery-centre':'https://thediscoverycentre.ca/events-month/',
    'halifax-brewery-market':'https://www.halifaxbrewerymarket.com/accessibility-community'
  };
  assert.deepEqual(Object.fromEntries(onboarding.candidates.map(row => [row.id,row.url])),expectedUrls);
  for (const row of onboarding.candidates) {
    assert.equal(row.enabled,false); assert.equal(row.status,'disabled_review_required');
    for (const key of ['rss','ical','api','jsonLd']) assert.equal(row.format[key],null);
  }
  assert.ok(!onboarding.candidates.some(row => /retales/i.test(row.name)),'Existing ReTales collector is not a new candidate');
  for (const id of ['bus-stop-theatre-direct','sanctuary-arts-centre-direct','agns-direct-events'])
    assert.match(onboarding.candidates.find(row => row.id === id).distinction,/upgrade_existing/);
});
test('manual news admissions remain distinct from disabled automated-interface review', () => {
  for (const [id,count] of [['the-coast','four'],['the-signal','one']]) {
    const candidate=onboarding.candidates.find(row=>row.id===id);
    assert.equal(candidate.distinction,'automated_interface_upgrade_existing_manual_news');
    assert.match(candidate.existingRepresentation,new RegExp(`manually admitted.*${count} individually approved link`));
    assert.match(candidate.existingRepresentation,/not a new publisher/);
    assert.match(candidate.rightsLimitations,/Collection remains disabled and feed URL null/);
    assert.match(candidate.nextSafeAction,/do not infer a feed URL or activate collection/);
    assert.equal(candidate.enabled,false);
    assert.equal(candidate.format.rss,null);
  }
});
test('schema rejects activation, fabricated clocks/feeds, private notes, unsafe URLs and malformed holds', () => {
  for (const mutate of [
    data => { data.enabled=true; }, data => { data.candidates[0].enabled=true; }, data => { data.holds[0].enabled=true; },
    data => { data.candidates[0].format.rss='https://example.org/feed'; },
    data => { data.candidates[0].lastAttemptAt='2026-10-27T12:00:00Z'; },
    data => { data.candidates[0].evidence[0].provenance='private notes'; },
    data => { data.candidates[0].evidence[0].observation='/tmp/private-notes.json'; },
    data => { data.candidates[0].evidence[0].observation='Internal turn123view0'; },
    data => { data.candidates[0].url='javascript:alert(1)'; },
    data => { data.candidates[0].evidence[0].url='https://user:secret@example.org'; },
    data => { data.candidates[0].additionalOfficialUrls=[{url:'https://example.org/?token=secret',verification:'Private query'}]; },
    data => { data.holds[0].holdReason='http_400'; },
    data => { data.holds[0].observedAt='2026-10-27T12:00:00Z'; },
    data => { data.candidates[1].id=data.candidates[0].id; },
    data => { data.candidates[1].rank=data.candidates[0].rank; }
  ]) {
    const data = structuredClone(onboarding); mutate(data);
    assert.throws(() => buildCatalog({[onboardingPath]:data}),/Source onboarding backlog:/);
  }
});
test('manual holds preserve precise known and uncertain outcomes without invented targets', () => {
  const holds = new Map(onboarding.holds.map(row => [row.id,row]));
  assert.equal(holds.get('halifax-examiner').url,'https://www.halifaxexaminer.ca/');
  assert.match(holds.get('halifax-examiner').evidence,/OAI-SearchBot.*exact listed homepage/);
  assert.equal(holds.get('forum-farmers-market').holdReason,'uncertain_transport_timeout');
  assert.match(holds.get('forum-farmers-market').evidence,/not a confirmed HTTP 400 or source denial/);
  assert.equal(holds.get('yuk-yuk-s').url,null);
  const market = onboarding.candidates.find(row => row.id === 'halifax-brewery-market');
  assert.ok(market.evidence.some(item => item.url === 'https://www.halifaxbrewerymarket.com/events' && /without years/.test(item.observation)));
  assert.match(market.nextSafeAction,/Do not invent an entrance/);
});
test('new review rows have unknown clocks, no workflow or cadence, and distinct row/URL/host counts', () => {
  const input = onboardingFixture(), before = JSON.stringify(input);
  const output = buildCatalog(input); assert.equal(output.sources.length,23); assert.equal(output.snapshotAt,null);
  assert.equal(output.counts.total,23); assert.equal(output.counts.distinctUrls,22); assert.equal(output.counts.distinctHosts,22);
  assert.equal(output.counts.held,23); assert.equal(output.counts.enabled,0);
  for (const row of output.sources) {
    assert.equal(row.family,'source-onboarding'); assert.equal(row.enabled,false); assert.equal(row.state,'held');
    assert.deepEqual(row.provenance,[onboardingPath]);
    for (const key of ['lastAttemptAt','lastSuccessAt','contentAt','workflowUrl','targetHours','parser']) assert.equal(row[key],null,key);
  }
  assert.equal(JSON.stringify(input),before,'Builder must not mutate registry');
  assert.equal(JSON.stringify(buildCatalog(input)),JSON.stringify(output));
});
test('onboarding adds only new rows and never imports manual holds into old row state or provenance', () => {
  const input = fixture();
  const candidate = onboarding.candidates[0];
  input['data/event-source-registry.json'].sources[0].url=candidate.url;
  input['data/source-link-access-holds.json']={provenance:{member:'original-link-report'},observations:[{url:candidate.url,observedAt:'2026-10-20T13:00:00Z',status:403}]};
  input['data/news-source-registry.json']={sources:[{id:'held-manually-only',name:'Manual hold same URL',homeUrl:onboarding.holds[0].url,enabled:true}]};
  const baseline = buildCatalog(input), originalInput=JSON.stringify(input);
  const result=buildCatalog({...input,...onboardingFixture()});
  assert.deepEqual(result.sources.filter(row => row.family !== 'source-onboarding'),baseline.sources);
  assert.ok(result.sources.filter(row => row.family !== 'source-onboarding').every(row => !('review' in row)));
  assert.equal(result.snapshotAt,baseline.snapshotAt);
  assert.equal(result.sources.find(row => row.family === 'source-onboarding' && row.url === candidate.url).lastAttemptAt,null);
  assert.equal(JSON.stringify(input),originalInput);
});

const source = await readFile(new URL('../app-admin-status.js',import.meta.url),'utf8');
const sandbox = {window:{location:{href:'https://example.test/'}}, URL, Date, console}; vm.createContext(sandbox); vm.runInContext(source,sandbox);
test('UI escapes source text and exposes honest unknown clocks', () => {
  const row = {name:'<script>bad</script>',family:'news',state:'unknown',provenance:[]};
  const html = sandbox.renderCatalogRow(row); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Last successful collection')); assert.ok(html.includes('Unknown'));
});
test('UI labels row, URL and host counts without claiming publishers or live schedules', () => {
  const html = sandbox.renderSourceCatalog(buildCatalog({'data/opening-watch-source-registry.json':{sources:[openingSource]}}));
  assert.match(html,/1 catalogue rows/); assert.match(html,/1 distinct sanitized URLs/); assert.match(html,/1 normalized hosts/);
  assert.match(html,/URL and host counts are not publisher counts/); assert.match(html,/not proof of an active schedule/);
  assert.match(html,/Catalogue row state counts/);
  assert.match(sandbox.renderSourceCatalog({sources:[]}),/Unknown distinct sanitized URLs · Unknown normalized hosts/);
  assert.match(sandbox.renderSourceCatalog(buildCatalog({})),/0 distinct sanitized URLs · 0 normalized hosts/);
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
test('UI makes onboarding status, limits, priorities and unknown interfaces explicit', () => {
  const output=buildCatalog(onboardingFixture());
  const html=sandbox.renderSourceCatalog(output);
  assert.match(html,/13 candidate interfaces and 10 manual holds/);
  assert.match(html,/not ingested events\/news, approved feeds or newly discovered organizations/);
  assert.match(html,/<option value="source-onboarding">/);
  const row=output.sources.find(row => row.sourceId==='bus-stop-theatre-direct');
  const detail=sandbox.renderCatalogRow(row);
  for (const expected of ['DISABLED','Review required — not ingested','ranked 1','Access limitations','Rights limitations','Next safe action','RSS / iCal / API / JSON-LD: unknown','Collection enabled: no','No mapped workflow']) assert.ok(detail.includes(expected),expected);
  assert.ok(!detail.includes('Inspect workflow runs / authenticated dispatch'));
  const noUrl=sandbox.renderCatalogRow(output.sources.find(row=>row.sourceId==='yuk-yuk-s'));
  assert.match(noUrl,/Source URL unknown/); assert.match(noUrl,/Mandatory hold — review required/);
  assert.ok(!noUrl.includes('href="null"'));
});
test('onboarding review text is escaped and unsafe evidence links cannot execute', () => {
  const data=structuredClone(onboarding), attack='<img src=x onerror="alert(1)">';
  const candidate=data.candidates[0];
  for (const key of ['name','geography','interface','existingRepresentation','accessLimitations','rightsLimitations','nextSafeAction']) candidate[key]=attack;
  candidate.format.observed=attack; candidate.evidence[0].observation=attack;
  const row=buildCatalog({[onboardingPath]:data}).sources.find(row=>row.sourceId===candidate.id);
  row.review.evidence.push({url:'javascript:alert(1)',observation:attack});
  const html=sandbox.renderCatalogRow(row);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="javascript:'));
  assert.ok(!sandbox.renderCatalogRow({...row,family:'news'}).includes('Disabled source onboarding review'),'Review metadata is exclusive to new onboarding rows');
});
test('onboarding metadata search and held/family filters reset pagination and support repeated navigation', () => {
  const controls=new Map();
  for (const key of ['query','state','family','previous','next','results','result-count']) controls.set(`[data-catalog-${key}]`,{value:'',events:{},addEventListener(type,fn){this.events[type]=fn;}});
  sandbox.document={querySelector:()=>({querySelector:key=>controls.get(key)})};
  const reviewRows=buildCatalog(onboardingFixture()).sources;
  const sources=[...Array.from({length:65},(_,i)=>({id:`old-${i}`,name:`Existing ${i}`,family:'events',state:'unknown',provenance:[]})),...reviewRows];
  sandbox.bindSourceCatalog({sources});
  const result=controls.get('[data-catalog-result-count]'), query=controls.get('[data-catalog-query]'), family=controls.get('[data-catalog-family]'), state=controls.get('[data-catalog-state]');
  controls.get('[data-catalog-next]').events.click(); controls.get('[data-catalog-next]').events.click();
  assert.match(result.textContent,/Showing 61–88/);
  family.value='source-onboarding'; family.events.change(); assert.match(result.textContent,/23 matches · Showing 1–23/);
  assert.equal(controls.get('[data-catalog-next]').disabled,true); assert.equal(controls.get('[data-catalog-previous]').disabled,true);
  state.value='held'; state.events.change(); assert.match(result.textContent,/23 matches/);
  query.value='written consent'; query.events.input(); assert.match(result.textContent,/1 matches/);
  assert.match(controls.get('[data-catalog-results]').innerHTML,/Northern Super League/);
  query.value='without years'; query.events.input(); assert.match(result.textContent,/1 matches/);
  assert.match(controls.get('[data-catalog-results]').innerHTML,/Brewery/);
  state.value='enabled'; state.events.change(); assert.match(result.textContent,/0 matches/);
  query.value=''; query.events.input(); state.value=''; state.events.change(); family.value=''; family.events.change();
  assert.match(result.textContent,/88 matches · Showing 1–30/);
  controls.get('[data-catalog-next]').events.click(); controls.get('[data-catalog-previous]').events.click(); assert.match(result.textContent,/Showing 1–30/);
});
// The backlog must remain unreachable from operational collectors and schedules.
for (const directory of ['scripts','.github/workflows']) {
  for (const path of await readdir(new URL('../'+directory+'/',import.meta.url),{recursive:true})) {
    if (!/\.(?:mjs|ya?ml)$/.test(path)) continue;
    if (directory === 'scripts' && ['build-source-catalog.mjs','test-source-catalog.mjs'].includes(path)) continue;
    const text=await readFile(new URL('../'+directory+'/'+path,import.meta.url),'utf8');
    assert.ok(!/source-onboarding-backlog(?:\.json|\.mjs)/.test(text),`Backlog must not become a collector/workflow dependency: ${directory}/${path}`);
  }
}
checks++; console.log(`ok ${checks} - onboarding backlog is not imported by collectors or schedules`);

// Exercise the importer with its real registry and parser in an isolated fixture,
// replacing only the guarded transport. No collector is imported by the builder.
const registry = JSON.parse(await readFile(new URL('../data/opening-watch-source-registry.json',import.meta.url),'utf8'));
assert.deepEqual(registry.sources,[openingSource],'Extract the exact existing configuration; no source admissions or ID changes');
const fixtureRoot = await mkdtemp(join(tmpdir(),'halifax-opening-config-'));
try {
  await mkdir(join(fixtureRoot,'scripts/lib'),{recursive:true});
  await mkdir(join(fixtureRoot,'data/build'),{recursive:true});
  for (const file of ['scripts/import-opening-watch.mjs','scripts/lib/opening-watch-review.mjs','scripts/lib/source-evidence-retention.mjs','scripts/lib/deny-source-network.mjs','data/opening-watch-source-registry.json'])
    await copyFile(new URL('../'+file,import.meta.url),join(fixtureRoot,file));
  await writeFile(join(fixtureRoot,'clock.mjs'),`const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-27T12:00:00.000Z'])); } static now() { return RealDate.parse('2026-10-27T12:00:00.000Z'); } }; AbortSignal.timeout = ms => { globalThis.fixtureTimeout = ms; return new AbortController().signal; };`);
  await writeFile(join(fixtureRoot,'scripts/lib/fetch-public-source.mjs'),`import { writeFile } from 'node:fs/promises';
export async function fetchGuardedSource(url, options) {
  await writeFile(new URL('../../requests.json',import.meta.url), JSON.stringify({url,headers:options.headers,redirect:options.redirect,timeout:globalThis.fixtureTimeout,signal:options.signal instanceof AbortSignal}));
  if (process.env.OPENING_FIXTURE_FAILURE === '1') throw new Error('fixture_timeout');
  return {ok:true,text:async()=>'<rss><channel><item><title>Opening news</title><link>https://example.test/opening</link><pubDate>2026-10-26</pubDate><description>Fixture Cafe is now open on Robie Street.</description></item></channel></rss>'};
}`);
  const expectedRequest = {url:openingSource.url,headers:{'User-Agent':'HalifaxSourced/0.4 (+https://github.com/JeremyHennessy/HalifaxSourced)',Accept:'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5'},redirect:'follow',timeout:15000,signal:true};
  for (const failure of ['0','1']) {
    const result = spawnSync(process.execPath,['--import',join(fixtureRoot,'scripts/lib/deny-source-network.mjs'),'--import',join(fixtureRoot,'clock.mjs'),join(fixtureRoot,'scripts/import-opening-watch.mjs')],{cwd:fixtureRoot,encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',OPENING_WATCH_LOOKBACK_DAYS:'180',OPENING_FIXTURE_FAILURE:failure}});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
    assert.deepEqual(JSON.parse(await readFile(join(fixtureRoot,'requests.json'),'utf8')),expectedRequest);
    const payload = JSON.parse(await readFile(join(fixtureRoot,'data/build/opening-watch-leads.json'),'utf8'));
    assert.deepEqual(payload.sources,[openingSource]); assert.equal(payload.lookbackDays,180);
    assert.equal(payload.leads.length,1); assert.equal(payload.leads[0].name,'Fixture Cafe');
    assert.equal(payload.leads[0].sourceName,openingSource.name); assert.equal(payload.leads[0].sourceType,openingSource.type);
    assert.equal(payload.leads[0].reviewState,'needs-cross-check');
    assert.deepEqual(payload.failures,failure === '1' ? [{sourceName:openingSource.name,sourceUrl:openingSource.url,reason:'fixture_timeout'}] : []);
  }
  checks++; console.log(`ok ${checks} - exact shared opening-watch config preserves mocked request, lead, failure and retention behavior without network`);
} finally { await rm(fixtureRoot,{recursive:true,force:true}); }
await buildFromDisk();
const target = new URL('../data/build/source-catalog.json',import.meta.url), before = await readFile(target,'utf8'), beforeStat = await stat(target);
await buildFromDisk();
assert.equal(await readFile(target,'utf8'),before); assert.equal((await stat(target)).mtimeMs,beforeStat.mtimeMs); checks++;
const actual = JSON.parse(before); assert.equal(new Set(actual.sources.map(x => x.id)).size,actual.sources.length); checks++;
console.log(`${checks} source catalogue checks passed; ${actual.counts.total} unique rows; unchanged rebuild preserves bytes and mtime.`);
