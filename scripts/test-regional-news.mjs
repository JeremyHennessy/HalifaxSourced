import assert from 'node:assert/strict';
import { parseNewsFeed, newsId, buildNews, newsScript, validateNewsRegistry, canonicalNewsUrl, NEWS_MAX_ITEMS, NEWS_MAX_BYTES } from './lib/news-contract.mjs';
import { collectNews, boundedNewsBody, validateNewsCache } from './import-regional-news.mjs';
// Offline fixtures only. Any accidentally introduced network dependency fails.
globalThis.fetch = () => { throw new Error('network_forbidden_in_news_tests'); };
const now = '2026-10-27T12:00:00.000Z';
const source = {id:'fixture',name:'Fixture newsroom',source_type:'official_public_notice',homeUrl:'https://example.org/',feedUrl:'https://example.org/feed',allowedHosts:['example.org'],enabled:true,status:'admitted',admission:{reviewedAt:now,reviewer:'Fixture reviewer',accessEvidence:'Fixture only',schemaEvidence:'Fixture RSS',dateEvidence:'Fixture dates',rightsEvidence:'Fixture original metadata'}};
const registry = {version:1,sources:[source]};
const item = (title='Local notice',link='https://example.org/story?utm_source=rss',date='Tue, 27 Oct 2026 10:00:00 GMT') => `<item><title>${title}</title><link>${link}</link><guid>story-1</guid><pubDate>${date}</pubDate><description><![CDATA[Never publish this copied article <img src="x">]]></description></item>`;
const rss = body => `<rss version="2.0"><channel><title>Fixture</title>${body}</channel></rss>`;
const parsed = parseNewsFeed(rss(item()),source,now);
assert.equal(parsed.length,1);
assert.equal(parsed[0].canonicalUrl,'https://example.org/story');
assert.ok(!('description' in parsed[0]));
assert.equal(parsed[0].reviewStatus,'pending');
assert.equal(parseNewsFeed(rss(''),source,now).length,0);
assert.equal(parseNewsFeed(rss(item()+item()),source,now).length,1);
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Library update</title><id>urn:fixture:2</id><link rel="alternate" href="https://example.org/library"/><published>2026-10-27T10:00:00Z</published><updated>2026-10-27T11:00:00Z</updated></entry></feed>';
assert.equal(parseNewsFeed(atom,source,now)[0].modifiedAt,'2026-10-27T11:00:00.000Z');
for (const xml of [
 '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss(item()),
 rss(item('&unknown;')),rss(item('&lt;script&gt;bad')),rss(item('bad','javascript:alert(1)')),
 rss(item('bad','https://evil.example/story')),rss(item('bad','https://example.org@evil.example/story')),
 rss(item('bad','https://example.org/story','2026-10-27')),rss(item('bad','https://example.org/story','2026-02-30T10:00:00Z')),
 rss(item('bad','https://example.org/story','2027-10-27T10:00:00Z')),rss(item()).slice(0,-6),'<html>Access denied</html>',
 rss(item().replace('</item>','<title>Second title</title></item>')),rss(item().repeat(NEWS_MAX_ITEMS+1)),
 rss(item()+'x'.repeat(NEWS_MAX_BYTES)),atom.replace('2026-10-27T11:00:00Z','2026-10-26T11:00:00Z')
]) assert.throws(()=>parseNewsFeed(xml,source,now));
assert.throws(()=>canonicalNewsUrl('http://example.org/story',source.allowedHosts));
assert.throws(()=>validateNewsRegistry({version:1,sources:[{...source,admission:null}]}));
assert.throws(()=>validateNewsRegistry({version:1,sources:[{...source,status:'proposed'}]}));
const accepted = {...parsed[0],region:'Halifax',regionEvidence:'Official notice names Halifax',topics:['community'],reviewStatus:'approved',correctionStatus:'none',summary:null,summaryKind:'none',reviewedAt:now,reviewer:'Fixture reviewer',rightsBasis:'Reviewed original title and link only'};
const decisions = {version:1,decisions:[{id:accepted.id,status:'approved',record:accepted}]};
const built = buildNews(decisions,registry);
assert.equal(built.items.length,1);
const dayRecord = {...accepted,publishedAt:'2026-10-27',publishedPrecision:'day',region:'East Hants'};
assert.equal(buildNews({version:1,decisions:[{id:accepted.id,status:'approved',record:dayRecord}]},registry).items[0].publishedAt,'2026-10-27');
for(const change of [{publishedAt:'2026-02-30',publishedPrecision:'day'},{publishedAt:'2026-10-27',publishedPrecision:'instant'},{publishedAt:accepted.publishedAt,publishedPrecision:'day'},{publishedPrecision:undefined}]) assert.throws(()=>buildNews({version:1,decisions:[{id:accepted.id,status:'approved',record:{...accepted,...change}}]},registry));
assert.deepEqual(buildNews(decisions,{...registry,sources:[{...source,enabled:false,feedUrl:null}]}),built,'Disabled transport must preserve reviewed records');
assert.deepEqual(buildNews({version:1,decisions:[{id:accepted.id,status:'withdrawn'}]},registry).items,[]);
for (const change of [{reviewStatus:'pending'},{description:'copied'},{summary:'Copied feed description',summaryKind:'feed_description'},{regionEvidence:''},{publishedAt:'not a date'},{rightsBasis:''},{canonicalUrl:'javascript:alert(1)'},{image:'https://example.org/image.jpg'}]) {
 assert.throws(()=>buildNews({version:1,decisions:[{...decisions.decisions[0],record:{...accepted,...change}}]},registry));
}
assert.throws(()=>buildNews({version:1,decisions:[...decisions.decisions,...decisions.decisions]},registry));
assert.equal(newsId('https://example.org/story'),accepted.id);
assert.equal(newsScript(built),newsScript(buildNews(decisions,registry)));
let requests=0;
const collected = await collectNews(registry,{now,fetchFeed:async()=>{requests++;return rss(item());}});
assert.equal(requests,1); assert.equal(collected.candidates.length,1);
const unchanged = await collectNews(registry,{now:'2026-10-28T12:00:00.000Z',previous:collected,fetchFeed:async()=>rss(item())});
assert.deepEqual(unchanged.candidates,collected.candidates,'No change must not churn observation clocks');
assert.equal(unchanged.diagnostics[0].lastAttemptAt,'2026-10-28T12:00:00.000Z');
assert.equal(unchanged.diagnostics[0].lastSuccessAt,'2026-10-28T12:00:00.000Z');
const failed = await collectNews(registry,{now,previous:collected,fetchFeed:async()=>{throw new Error('news_http_503');}});
assert.deepEqual(failed.candidates,collected.candidates);
requests=0;
const backoff = await collectNews(registry,{now,previous:failed,fetchFeed:async()=>{requests++;return rss(item());}});
assert.equal(requests,0); assert.deepEqual(backoff.candidates,failed.candidates); assert.equal(backoff.diagnostics[0].lastAttemptAt,now);
const disabled = await collectNews({version:1,sources:[{...source,status:'proposed',enabled:false,admission:null}]},{now,fetchFeed:async()=>{throw new Error('must not fetch');}});
assert.equal(disabled.candidates.length,0);
assert.equal(disabled.diagnostics[0].status,'disabled');
assert.equal(await boundedNewsBody(new Response('safe feed')), 'safe feed');
await assert.rejects(boundedNewsBody(new Response('x'.repeat(NEWS_MAX_BYTES+1))),/news_byte_limit/);
await assert.rejects(boundedNewsBody(new Response(new Uint8Array([0xff]))));
console.log('Regional news offline tests passed: RSS/Atom, XML safety, bounds, dates, dedup, explicit review, withdrawal, disabled sources, retention and backoff.');

const cached = await collectNews(registry,{now,fetchFeed:async()=>({status:200,xml:rss(item()),etag:'"fixture-v1"',lastModified:'Tue, 27 Oct 2026 10:00:00 GMT'})});
const next = '2026-10-28T12:00:00.000Z';
const notModified = await collectNews(registry,{now:next,previous:cached,fetchFeed:async(_s,headers)=>{assert.equal(headers.etag,'"fixture-v1"');return {status:304};}});
assert.deepEqual(notModified.candidates,cached.candidates);
assert.equal(notModified.diagnostics[0].status,'not_modified');
assert.equal(notModified.diagnostics[0].lastSuccessAt,next);
const changed = await collectNews(registry,{now:next,previous:cached,fetchFeed:async()=>({status:200,xml:rss(item('Revised local notice')),etag:'"fixture-v2"'})});
assert.equal(changed.candidates[0].title,'Revised local notice');
assert.equal(changed.candidates[0].observedAt,next);
assert.equal(changed.diagnostics[0].etag,'"fixture-v2"');
const held = await collectNews(registry,{now,previous:cached,fetchFeed:async()=>{throw new Error('news_http_429');}});
assert.equal(held.diagnostics[0].accessHeld,true);
const afterHold = await collectNews(registry,{now:'2027-10-27T12:00:00.000Z',previous:held,fetchFeed:async()=>{throw new Error('must never request held source');}});
assert.equal(afterHold.diagnostics[0].lastAttemptAt,now);
assert.equal(afterHold.diagnostics[0].status,'access_held');
const changedRegistry = {version:1,sources:[{...source,feedUrl:'https://example.org/feed-v2'}]};
let checkedConfig=false;
await collectNews(changedRegistry,{now:next,previous:cached,fetchFeed:async(_s,headers)=>{checkedConfig=true;assert.equal(headers.etag,null);assert.equal(headers.lastModified,null);return {status:200,xml:rss(item())};}});
assert.equal(checkedConfig,true);
const changedHeld = await collectNews(changedRegistry,{now:next,previous:held,fetchFeed:async()=>{throw new Error('must not bypass hold with new config');}});
assert.equal(changedHeld.diagnostics[0].accessHeld,true);
// Cache host spelling is evidence: preserve it, but match the shared www/apex
// and trailing-DNS-dot identity even when a source is retired and renamed.
const sourceAtHost = (host,id) => ({...source,id,homeUrl:`https://${host}/`,feedUrl:`https://${host}/feed`,allowedHosts:[host]});
for (const status of [401,403,429]) for (const [oldHost,newHost] of [
 ['www.example.org','example.org'], ['example.org','www.example.org'],
 ['www.example.org.','example.org'], ['example.org','www.example.org.']
]) {
 const oldSource = sourceAtHost(oldHost,'retired-fixture');
 const priorHold = await collectNews({version:1,sources:[oldSource]},{now,fetchFeed:async()=>{throw new Error(`news_http_${status}`);}});
 const originalCache = JSON.stringify(priorHold);
 let aliasRequests = 0;
 const aliasResult = await collectNews({version:1,sources:[sourceAtHost(newHost,'renamed-fixture')]},{now:next,previous:priorHold,fetchFeed:async()=>{aliasRequests++;return rss('');}});
 assert.equal(aliasRequests,0,`${status}: ${oldHost} -> ${newHost} must retain its hold after an ID change`);
 assert.equal(aliasResult.diagnostics[0].status,'access_held');
 assert.equal(aliasResult.diagnostics[0].accessHeld,true);
 assert.equal(aliasResult.diagnostics[0].lastAttemptAt,null);
 assert.deepEqual(aliasResult.diagnostics.find(d=>d.sourceId===oldSource.id),priorHold.diagnostics[0],'Retired hold evidence remains an unchanged tombstone');
 assert.equal(JSON.stringify(priorHold),originalCache,'Hold matching must not rewrite the previous cache');
 validateNewsCache(aliasResult);
}
let unchangedHeldRequests = 0;
const unchangedHeld = await collectNews(registry,{now:next,previous:held,fetchFeed:async()=>{unchangedHeldRequests++;return rss('');}});
assert.equal(unchangedHeldRequests,0);
assert.deepEqual(unchangedHeld.candidates,held.candidates);
for (const key of ['sourceId','sourceHost','configHash','status','accessHeld','etag','lastModified','lastAttemptAt','lastSuccessAt','retryNotBefore']) assert.equal(unchangedHeld.diagnostics[0][key],held.diagnostics[0][key]);
for (const host of ['news.example.org','example.net','notexample.org']) {
 let unheldRequests = 0;
 const unheld = await collectNews({version:1,sources:[sourceAtHost(host,'unheld-fixture')]},{now:next,previous:held,fetchFeed:async()=>{unheldRequests++;return rss('');}});
 assert.equal(unheldRequests,1,`${host} is a distinct, unheld host`);
 assert.equal(unheld.diagnostics[0].accessHeld,false);
 assert.equal(unheld.diagnostics[0].status,'pending_review');
 assert.deepEqual(unheld.diagnostics.find(d=>d.sourceId===source.id),held.diagnostics[0]);
}
let sameRunRequests = 0;
const sameRunHold = await collectNews({version:1,sources:[sourceAtHost('www.example.org','a-first'),sourceAtHost('example.org','b-alias')]},{now,fetchFeed:async()=>{sameRunRequests++;throw new Error('news_http_429');}});
assert.equal(sameRunRequests,1,'A new denial must also hold later equivalent hosts in the same run');
assert.equal(sameRunHold.diagnostics[1].status,'access_held');
assert.equal(sameRunHold.diagnostics[1].lastAttemptAt,null);
console.log('News host-alias tests passed: zero held-host requests across source-ID/www/apex/DNS-dot changes, unchanged tombstones and distinct unheld hosts.');
for(const corrupt of [{}, {...cached,version:1}, {...cached,diagnostics:[{...cached.diagnostics[0],etag:'bad\nheader'}]}, {...cached,candidates:[{...cached.candidates[0],description:'copied'}]}]) {
 assert.throws(()=>validateNewsCache(corrupt));
 await assert.rejects(collectNews(registry,{now,previous:corrupt,fetchFeed:async()=>{throw new Error('must not request corrupt cache');}}),/invalid_previous_news_cache/);
}
console.log('News cache tests passed: conditional 304, changed content, durable holds, config invalidation and corrupt-cache fail-closed.');
// RFC calendar values must not normalize through Date.parse.
for (const date of ['Mon, 30 Feb 2026 10:00:00 GMT','29 Feb 2026 10:00:00 GMT','29 Feb 1900 10:00:00 GMT','31 Apr 2026 10:00:00 GMT','00 Jan 2026 10:00:00 GMT','01 Jan 0000 10:00:00 GMT','01 Jan 26 10:00:00 GMT','27 Oct 2026 24:00:00 GMT','27 Oct 2026 10:60:00 GMT','27 Oct 2026 10:00:60 GMT','27 Oct 2026 10:00:00 +2460','Mon, 27 Oct 2026 10:00:00 GMT','2026-10-27T24:00:00Z']) {
 assert.throws(()=>parseNewsFeed(rss(item('Calendar test','https://example.org/story',date)),source,now),/invalid_news_date/);
}
for (const date of ['Thu, 29 Feb 2024 10:00:00 GMT','Tue, 29 Feb 2000 10:00:00 GMT','27 Oct 2026 10:00:00 +0100']) assert.equal(parseNewsFeed(rss(item('Valid calendar','https://example.org/story',date)),source,now).length,1);
const badCalendar = await collectNews(registry,{now:next,previous:cached,fetchFeed:async()=>({status:200,xml:rss(item('Bad date','https://example.org/story','Mon, 30 Feb 2026 10:00:00 GMT')),etag:'"must-not-replace"'})});
assert.deepEqual(badCalendar.candidates,cached.candidates);
assert.equal(badCalendar.diagnostics[0].status,'failed_preserved');
assert.equal(badCalendar.diagnostics[0].etag,cached.diagnostics[0].etag);
assert.equal(badCalendar.diagnostics[0].lastSuccessAt,cached.diagnostics[0].lastSuccessAt);

// Exercise the exact helper called by the workflow, not a duplicate gate model.
const {mayInitializeNewsCache,prepareNewsCache} = await import('./import-regional-news.mjs');
const {mkdtemp,readFile,writeFile,rm} = await import('node:fs/promises');
const {tmpdir} = await import('node:os');
const {pathToFileURL} = await import('node:url');
const gate = {requested:'true',runNumber:'1',runAttempt:'1',eventName:'workflow_dispatch',exists:false};
assert.equal(mayInitializeNewsCache(gate),true);
for (const change of [{requested:'false'},{requested:undefined},{runNumber:'2'},{runAttempt:'2'},{eventName:'schedule'},{eventName:'pull_request'},{exists:true}]) assert.equal(mayInitializeNewsCache({...gate,...change}),false);
const directory = await mkdtemp(`${tmpdir()}/news-cache-test-`);
const artifact = pathToFileURL(`${directory}/news-preview.json`);
const initEnv = {NEWS_INITIALIZE_REVIEW_CACHE:'true',GITHUB_RUN_NUMBER:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch'};
try {
 await assert.rejects(prepareNewsCache({artifact,registry,env:{}}),/news_cache_missing_no_requests/);
 await assert.rejects(prepareNewsCache({artifact,registry,env:{...initEnv,GITHUB_RUN_NUMBER:'2'}}),/initialization_not_authorized/);
 await prepareNewsCache({artifact,registry,env:initEnv});
 validateNewsCache(JSON.parse(await readFile(artifact,'utf8')));
 await assert.rejects(prepareNewsCache({artifact,registry,env:initEnv}),/initialization_not_authorized/);
 await writeFile(artifact,JSON.stringify(held));
 await prepareNewsCache({artifact,registry,env:{}});
 assert.equal(JSON.parse(await readFile(artifact,'utf8')).diagnostics[0].accessHeld,true);
 await assert.rejects(prepareNewsCache({artifact,registry,env:initEnv}),/initialization_not_authorized/);
 await writeFile(artifact,'corrupt');
 await assert.rejects(prepareNewsCache({artifact,registry,env:initEnv}));
 assert.equal(await readFile(artifact,'utf8'),'corrupt');
} finally { await rm(directory,{recursive:true,force:true}); }
const workflow = await readFile(new URL('../.github/workflows/news-preview.yml',import.meta.url),'utf8');
assert.match(workflow,/initialize_review_cache:[\s\S]*?default: false/);
assert.match(workflow,/NEWS_INITIALIZE_REVIEW_CACHE: \$\{\{ inputs.initialize_review_cache \}\}/);
assert.match(workflow,/node scripts\/import-regional-news.mjs --prepare-review-cache/);
assert.doesNotMatch(workflow,/\n\s+schedule:/);
console.log('News date/bootstrap tests passed: RFC calendar precision, failure preservation, first-run-only explicit initialization, no reset or default cache-miss requests.');

// Real reviewed manual-only newsroom record: exact approved JSON/browser pair,
// honest day/observation precision, and no source activation as a side effect.
const readJson = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const reviewedRegistry = await readJson('data/news-source-registry.json');
const reviewedDecisions = await readJson('data/reviewed-news-decisions.json');
const cityNewsUrl = 'https://halifax.citynews.ca/2026/10/27/three-alarm-fire-at-halifax-grain-elevator-under-control/';
const cityNewsSource = reviewedRegistry.sources.find(row => row.id === 'citynews-halifax');
assert.equal(cityNewsSource.status, 'admitted');
assert.equal(cityNewsSource.enabled, false);
assert.equal(cityNewsSource.feedUrl, null);
assert.match(cityNewsSource.admission.accessEvidence, /Successful text\/html web-reader result with 136 lines/);
assert.doesNotMatch(cityNewsSource.admission.accessEvidence, /turn\d+(?:view|search|fetch)\d+/);
assert.match(cityNewsSource.admission.accessEvidence, /2026-10-27T20:53:39\.000Z through 2026-10-27T20:53:45\.000Z/);
assert.match(cityNewsSource.admission.accessEvidence, /upper bound, not an exact fetch time/);
const reviewedPayload = buildNews(reviewedDecisions, reviewedRegistry);
const cityNewsRecord = reviewedPayload.items.find(row => row.canonicalUrl === cityNewsUrl);
assert.equal(cityNewsRecord.id, newsId(cityNewsUrl));
assert.equal(cityNewsRecord.sourceGUID, cityNewsUrl);
assert.equal(cityNewsRecord.title, 'Halifax grain-terminal fire reported under control');
assert.equal(cityNewsRecord.region, 'Halifax');
assert.equal(cityNewsRecord.publishedAt, '2026-10-27');
assert.equal(cityNewsRecord.publishedPrecision, 'day');
assert.equal(cityNewsRecord.modifiedAt, null);
assert.equal(cityNewsRecord.observedAt, '2026-10-27T20:53:45.000Z');
assert.equal(cityNewsRecord.summary, null);
assert.equal(cityNewsRecord.summaryKind, 'none');
assert.match(cityNewsRecord.rightsBasis, /upper bound/);
assert.match(cityNewsRecord.rightsBasis, /not an exact fetch time/);
assert.match(cityNewsRecord.rightsBasis, /does not establish a republication licence/);
assert.deepEqual(await readJson('data/build/news.json'), reviewedPayload);
assert.equal(await readFile(new URL('../data/news.js', import.meta.url), 'utf8'), newsScript(reviewedPayload));
assert.deepEqual(buildNews(reviewedDecisions, reviewedRegistry), reviewedPayload, 'Reviewed build must not refresh clocks');
let manualSourceRequests = 0;
const manualSourceResult = await collectNews({version:1, sources:[cityNewsSource]}, {
 now:cityNewsRecord.reviewedAt,
 fetchFeed:async()=>{ manualSourceRequests++; throw new Error('manual_source_must_not_collect'); }
});
assert.equal(manualSourceRequests, 0);
assert.equal(manualSourceResult.diagnostics[0].status, 'disabled');
assert.deepEqual(manualSourceResult.candidates, []);
console.log('Reviewed CityNews regression passed: exact approved pair, day precision, bounded observation provenance, null summary and disabled collection.');

// Reviewed October 27 expansion is additive. Freeze the pre-expansion decisions
// and six registry entries so new manual admissions cannot rewrite old clocks,
// preview permissions, disabled sources or historic access evidence. The sole
// pre-existing source change removes CityNews's opaque tool receipt reference;
// its publisher URL, 136-line receipt, windows, access outcome and states stay intact.
const { createHash } = await import('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const retainedDecisionHashes = {
 'news-81a930d96a2a76a3cbe04cb9':'ed2df10c0b2b2485535756233862c07f9d3574b8f9681f3d35cba4bcd063f0f2',
 'news-c3ab1f08f5c4ffbe39559478':'79298fd6cd566f5fe41fd6f8acdb20c9c908ee8950c5da0c3ec2cf1bd4d361e1',
 'news-8f4e6405f6c6e8856e667bc9':'66a204d14cd3a5fec764ba2d551a52623535411fb8db4d25b46bb8c985930532',
 'news-1fb9284920d1d77fe4f03345':'7a44c7a91547fcc68f7c5a89a8361de3235c0a9b6ebccc24e2fc5940e2ad57e3'
};
const retainedSourceHashes = {
 'global-halifax':'776bc3f4c284a1c0974c9b658f665847aea6604cf5b43be146e181ca4c3fb61c',
 'halifax-libraries':'c627bc6b6cf69f56db59b8d695f7fdba0d2b65ac3046dbb5c711c38aa42de7ee',
 'ns-traffic':'c35bd1ad19248763cb20b9525de78d8e55f912155d84aecab9d6eebcc8acf377',
 'ns-newsroom':'8067ad18e890f5bdcb2e48dcc83310e9cd241287d129f44792532ba8aaef8594',
 'cbc-ns':'2e40823dce5379438e53ccd20ea48d58721f08b4d06b455efa43591dd6d4067a',
 'citynews-halifax':'f0f6d664ce44551f0751f22a92b668c06d860b41a1ce5f6ebf969a7a559ddc72'
};
for (const [id, hash] of Object.entries(retainedDecisionHashes)) {
 assert.equal(digest(reviewedDecisions.decisions.find(row => row.id === id)), hash, `Preserve complete original decision ${id}`);
}
for (const [id, hash] of Object.entries(retainedSourceHashes)) {
 assert.equal(digest(reviewedRegistry.sources.find(row => row.id === id)), hash, `Preserve original source settings and evidence ${id}`);
}
const expansionExpected = [
  [
    "news-977c0ec8249d5d55b6e58cf0",
    "global-halifax",
    "https://globalnews.ca/news/12113825/nova-scotia-adopt-a-bat/",
    "Bat-conservation fundraiser launched in Nova Scotia",
    "2026-10-22",
    "Nova Scotia",
    "2026-10-27T23:42:35.000Z"
  ],
  [
    "news-a718562303b817d0277762d0",
    "global-halifax",
    "https://globalnews.ca/news/12109690/halifax-forum-community-meeting-reschedule/",
    "Council backs rescheduling Halifax Forum public meeting",
    "2026-10-20",
    "Halifax",
    "2026-10-27T23:43:18.000Z"
  ],
  [
    "news-e268646611a4077b2c01e2d3",
    "the-coast",
    "https://www.thecoast.ca/lifestyle/halifaxs-emily-morgulis-builds-activewear-brand-inspired-by-her-grandmother/",
    "Halifax entrepreneur develops Swazona activewear brand",
    "2026-10-26",
    "Halifax",
    "2026-10-27T23:42:54.660Z"
  ],
  [
    "news-08a8b678e60a3118a41ad9ae",
    "the-coast",
    "https://www.thecoast.ca/news-opinion/best-of-halifax-2027-nominate-your-favourites-now/",
    "The Coast opens nominations for Best of Halifax 2027",
    "2026-10-22",
    "Halifax",
    "2026-10-27T23:42:46.934Z"
  ],
  [
    "news-ad7f15af910c05d9de5b8b62",
    "the-coast",
    "https://www.thecoast.ca/arts-music/sketching-the-meaning-of-home-the-artist-behind-royales-halifax-box-art/",
    "Halifax artist creates local landmark illustrations for Royale",
    "2026-10-08",
    "Halifax",
    "2026-10-27T23:42:41.053Z"
  ],
  [
    "news-32a5904109882638e7e54f5c",
    "the-coast",
    "https://www.thecoast.ca/arts-music/arts-culture/a-new-trading-card-game-is-taking-nova-scotia-by-storm/",
    "Nova Scotia-made card game finds players in Halifax and Dartmouth",
    "2026-10-07",
    "Nova Scotia",
    "2026-10-27T23:42:46.934Z"
  ],
  [
    "news-f0ba9c95723962946dc570c7",
    "the-signal",
    "https://signalhfx.ca/live-nocturne-2026-a-fun-thoughtful-night-out-in-the-embodied-city/",
    "The Signal reports on Nocturne art projects in Halifax and Dartmouth",
    "2026-10-17",
    "Halifax Regional Municipality",
    "2026-10-27T23:42:41.053Z"
  ]
];
for (const [id, sourceId, canonicalUrl, title, publishedAt, region, observedAt] of expansionExpected) {
 const row = reviewedPayload.items.find(item => item.id === id);
 assert(row, `Missing reviewed item ${id}`);
 assert.deepEqual([row.sourceId, row.canonicalUrl, row.title, row.publishedAt, row.region, row.observedAt], [sourceId, canonicalUrl, title, publishedAt, region, observedAt]);
 assert.equal(row.sourceGUID, canonicalUrl);
 assert.equal(row.id, newsId(canonicalUrl));
 assert.equal(row.publishedPrecision, 'day');
 assert.equal(row.modifiedAt, null, 'Unqualified publisher update clocks cannot become UTC instants');
 assert.equal(row.summary, null);
 assert.equal(row.summaryKind, 'none');
 assert.equal(row.reviewedAt, '2026-10-27T23:48:37.000Z');
 assert(row.reviewedAt > row.observedAt && row.observedAt > row.publishedAt);
 assert(row.regionEvidence.length > 20, 'Story evidence, not publisher headquarters, supports geography');
 for (const term of [/Manual primary-page evidence:/, /Crawled:/, /exact cache freshness and origin retrieval time unknown/, /upper bound of/, /not an exact origin fetch time/, /not a republication licence/]) assert.match(row.rightsBasis, term);
 assert(row.rightsBasis.includes(row.canonicalUrl), 'Public evidence identifies the canonical publisher page');
 assert.doesNotMatch(row.rightsBasis, /turn\d+(?:view|search|fetch)\d+|\/(?:tmp|workspace|home)\/|sediment:|[?&](?:token|signature|sig|api_key)=/i, 'No internal tool receipts, private paths or signed URLs in new public provenance');
 const source = reviewedRegistry.sources.find(item => item.id === sourceId);
 assert.equal(canonicalNewsUrl(row.canonicalUrl, source.allowedHosts), row.canonicalUrl);
 assert.deepEqual(Object.keys(row).sort(), Object.keys(cityNewsRecord).sort(), 'No publisher-body, image or unreviewed metadata fields');
 for (const unsafe of [
   {reviewStatus:'pending'}, {body:'publisher body'}, {imageUrl:'https://example.org/photo.jpg'},
   {summary:'feed excerpt', summaryKind:'feed_description'}, {canonicalUrl:'javascript:alert(1)'},
   {canonicalUrl:'https://user:secret@'+new URL(canonicalUrl).hostname+'/'},
   {regionEvidence:''}, {publishedAt:'2026-02-30'}, {publishedAt:row.observedAt, publishedPrecision:'day'}
 ]) assert.throws(() => buildNews({version:1,decisions:[{id,status:'approved',record:{...row,...unsafe}}]},reviewedRegistry));
 const proposedOnly = {...reviewedRegistry,sources:reviewedRegistry.sources.map(item=>item.id===sourceId?{...item,status:'proposed',enabled:false,admission:null}:item)};
 assert.throws(() => buildNews({version:1,decisions:[{id,status:'approved',record:row}]},proposedOnly), /invalid_accepted_news_shape/);
}
assert.equal(reviewedPayload.items.length, 11);
assert.equal(new Set(reviewedPayload.items.map(row=>row.sourceId)).size, 5);
assert.equal(reviewedRegistry.sources.length, 8);
assert.deepEqual(reviewedRegistry.sources.filter(row=>row.enabled).map(row=>row.id), ['global-halifax'], 'Only the existing preview feed stays enabled');
for (const id of ['the-coast','the-signal']) {
 const source = reviewedRegistry.sources.find(row=>row.id===id);
 assert.equal(source.status,'admitted'); assert.equal(source.enabled,false); assert.equal(source.feedUrl,null);
 assert.doesNotMatch(JSON.stringify(source.admission), /turn\d+(?:view|search|fetch)\d+|\/(?:tmp|workspace|home)\/|sediment:|[?&](?:token|signature|sig|api_key)=/i);
 assert.match(source.admission.schemaEvidence,/manually reviewed/);
 assert.match(source.admission.rightsEvidence,/No blanket reuse or automated collection permission inferred/);
 let calls=0;
 const result = await collectNews({version:1,sources:[source]}, {now:'2026-10-28T00:00:00.000Z',fetchFeed:async()=>{calls++;throw new Error('manual_source_must_not_collect');}});
 assert.equal(calls,0);assert.equal(result.diagnostics[0].status,'disabled');assert.deepEqual(result.candidates,[]);
}
assert.deepEqual(await readJson('data/build/news.json'), reviewedPayload);
assert.equal(await readFile(new URL('../data/news.js',import.meta.url),'utf8'), newsScript(reviewedPayload));
assert.deepEqual(buildNews(reviewedDecisions, reviewedRegistry), reviewedPayload, 'No review or observation clock churn on rebuild');
assert.match(await readFile(new URL('../index.html',import.meta.url),'utf8'), /data\/news\.js\?v=20261027-news-expansion-1/);
console.log('Reviewed publisher expansion passed: 7 original-title links, 11 total items/5 publishers, all 4 original decisions and 6 original source states preserved (one opaque CityNews receipt removed), cached observation windows, exact JSON/JS parity, no media/body/unreviewed promotion, 2 manual-only admissions.');
