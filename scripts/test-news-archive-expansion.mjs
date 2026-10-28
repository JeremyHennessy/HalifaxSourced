import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildNews, newsScript, NEWS_TYPES, validateNewsRegistry, canonicalNewsUrl, newsId} from './lib/news-contract.mjs';
import {collectNews} from './import-regional-news.mjs';
const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path,root),'utf8');
const load = async path => JSON.parse(await read(path));
const registry = await load('data/news-source-registry.json');
const decisions = await load('data/reviewed-news-decisions.json');
const payload = buildNews(decisions,registry);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// All original eleven decisions and eight registry entries are immutable here:
// backfill must not refresh original clocks or broaden collection permissions.
const baselineDecisionHashes = {
  "news-81a930d96a2a76a3cbe04cb9": "ed2df10c0b2b2485535756233862c07f9d3574b8f9681f3d35cba4bcd063f0f2",
  "news-c3ab1f08f5c4ffbe39559478": "79298fd6cd566f5fe41fd6f8acdb20c9c908ee8950c5da0c3ec2cf1bd4d361e1",
  "news-8f4e6405f6c6e8856e667bc9": "66a204d14cd3a5fec764ba2d551a52623535411fb8db4d25b46bb8c985930532",
  "news-1fb9284920d1d77fe4f03345": "7a44c7a91547fcc68f7c5a89a8361de3235c0a9b6ebccc24e2fc5940e2ad57e3",
  "news-977c0ec8249d5d55b6e58cf0": "565bc032d687ee786ed547fd7d9782232d3ecfee9f23a6cbcc471568dfeab4c8",
  "news-a718562303b817d0277762d0": "6e316386e9c6afab6c9af1f3f659175e4d3f24e845723e8eaf62ddb0e0cbd9fd",
  "news-e268646611a4077b2c01e2d3": "4cdc6a317302e3659fb2be98579fb6ce59402deea6427e32280ef1c82d497bcd",
  "news-08a8b678e60a3118a41ad9ae": "7f284494d585fc383c11051056c56a9bcdcff0392831cbc4993f1bd496ac912c",
  "news-ad7f15af910c05d9de5b8b62": "31a03e96481ed279f6da64ec5a8c01b2fd00c08b282e7dcfea2a6109301ec5a2",
  "news-32a5904109882638e7e54f5c": "f5b688053fe95ab0e6a1037c5304ba929bed18f497c926146bda660af038c23b",
  "news-f0ba9c95723962946dc570c7": "4c47199d767dc885b16deea7368666a51c0f07d0fd958faebcd36d4c7c820a41"
};
const baselineSourceHashes = {
  "global-halifax": "776bc3f4c284a1c0974c9b658f665847aea6604cf5b43be146e181ca4c3fb61c",
  "halifax-libraries": "c627bc6b6cf69f56db59b8d695f7fdba0d2b65ac3046dbb5c711c38aa42de7ee",
  "ns-traffic": "c35bd1ad19248763cb20b9525de78d8e55f912155d84aecab9d6eebcc8acf377",
  "ns-newsroom": "8067ad18e890f5bdcb2e48dcc83310e9cd241287d129f44792532ba8aaef8594",
  "cbc-ns": "2e40823dce5379438e53ccd20ea48d58721f08b4d06b455efa43591dd6d4067a",
  "citynews-halifax": "f0f6d664ce44551f0751f22a92b668c06d860b41a1ce5f6ebf969a7a559ddc72",
  "the-coast": "86b4046c577098cf23590ef6d5802b38d963d7bc7222e7413d1a346e24790a6b",
  "the-signal": "f35e9246fdc13f97a4ed22a639d2696dc0cd28362b9ae658b2b2085927d6c279"
};
const expected = [
  [
    "news-80ab169a2031d5ead2b27bad",
    "citynews-halifax",
    "Crisis-response training expanded to eastern Nova Scotia",
    "2026-10-26",
    "Nova Scotia"
  ],
  [
    "news-ea8e74ef9065b32c2bea92ae",
    "citynews-halifax",
    "Jajiktek Seawall Trail planned for northern Cape Breton",
    "2026-10-25",
    "Nova Scotia"
  ],
  [
    "news-a30a5db766e93b1f8424a545",
    "citynews-halifax",
    "Nova Scotia reviewed aircraft use during the 2026 wildfire season",
    "2026-10-24",
    "Nova Scotia"
  ],
  [
    "news-f03f1e5ef2b433c9f9bb2f6b",
    "global-halifax",
    "Halifax council requested a construction-traffic action plan",
    "2026-10-21",
    "Halifax Regional Municipality"
  ],
  [
    "news-b7bd25a494b4aa2c2500b0ec",
    "citynews-halifax",
    "Yarmouth ferry agreement extended for the 2027 season",
    "2026-10-18",
    "Nova Scotia"
  ],
  [
    "news-47dfbbac0c36896319e3abca",
    "citynews-halifax",
    "Lunenburg County woodland owners received provincial stewardship award",
    "2026-10-18",
    "Nova Scotia"
  ],
  [
    "news-95eb3c4876904c738fdf4f74",
    "global-halifax",
    "Cross-country food-bank fundraising ride finished in Halifax",
    "2026-10-15",
    "Halifax"
  ],
  [
    "news-046734de465c1f924b61a306",
    "global-halifax",
    "Emergency-exit work announced for Westwood Hills",
    "2026-10-06",
    "Halifax Regional Municipality"
  ],
  [
    "news-935f9651a08aa343a70c795e",
    "global-halifax",
    "Nova Scotia introduced extra registration fees for electric vehicles",
    "2026-10-02",
    "Nova Scotia"
  ],
  [
    "news-5f99735671c7c124d042eb5e",
    "global-halifax",
    "Federal funding announced for Halifax youth-safety programs",
    "2026-09-29",
    "Halifax Regional Municipality"
  ],
  [
    "news-b72438d505cc4def7b8ef1ad",
    "global-halifax",
    "Halifax student transit program continued after funding agreement",
    "2026-09-03",
    "Halifax Regional Municipality"
  ],
  [
    "news-343b5e45920ae6a414a8c505",
    "citynews-halifax",
    "Halifax resident completed a walk around the peninsula",
    "2026-09-03",
    "Halifax"
  ],
  [
    "news-d50375083b52a6d653d1abcf",
    "global-halifax",
    "Gus’ Pub adopted a policy against AI-generated posters",
    "2026-09-02",
    "Halifax"
  ],
  [
    "news-994336ec0f895d1f0ba4fc37",
    "global-halifax",
    "Whale sanctuary project secured a Nova Scotia coastal lease",
    "2026-08-21",
    "Nova Scotia"
  ],
  [
    "news-cd9e7241821dd37e8d1a3aa6",
    "citynews-halifax",
    "Nova Scotia marked Acadian Heritage Month in August",
    "2026-08-03",
    "Nova Scotia"
  ],
  [
    "news-bd2f2db1b0fd61f2a94bae88",
    "the-coast",
    "Nova Scotia designers selected for the 2026 Cashmere fashion collection",
    "2026-10-01",
    "Nova Scotia"
  ],
  [
    "news-0f98b34eb398ab5244f2fd1a",
    "the-coast",
    "September profile explores Halifax's Million Vibes music collective",
    "2026-09-22",
    "Halifax"
  ],
  [
    "news-a3fe570814935c7d24855edf",
    "the-coast",
    "Atlantic filmmakers profiled during Halifax's September 2026 film festival",
    "2026-09-16",
    "Halifax"
  ],
  [
    "news-5c0b76fa68673914d67dc110",
    "the-coast",
    "Dartmouth's Vessel Meats featured for its regional farm partnerships",
    "2026-09-08",
    "Dartmouth"
  ],
  [
    "news-8c00ada5525e271a0cba891c",
    "the-coast",
    "The Coast documented the September 2026 Halifax Fringe program",
    "2026-09-03",
    "Halifax"
  ],
  [
    "news-5c5776928b6b41f489e2e7ab",
    "the-coast",
    "Burry released the single No Hard Feelings in August",
    "2026-08-21",
    "Nova Scotia"
  ],
  [
    "news-ac243a65a5a3b1873c5b5396",
    "the-coast",
    "August coverage tracked the 2026 Nova Scotia Music Week lineup",
    "2026-08-11",
    "Nova Scotia"
  ],
  [
    "news-ad7e82fb190df4bd1f822b96",
    "the-signal",
    "Saint Mary's finished second in the 2026 university hockey final in Halifax",
    "2026-04-03",
    "Halifax"
  ],
  [
    "news-672fe9074c69053f247775fe",
    "the-signal",
    "March Trident concert brought two East Coast songwriters together in Halifax",
    "2026-04-01",
    "Halifax"
  ],
  [
    "news-5d72c6922aa78769d9d059cb",
    "the-signal",
    "Dartmouth's March A Li'l Affair concerts raised funds for Adsum",
    "2026-03-24",
    "Dartmouth"
  ],
  [
    "news-7337ec58a959c5fba470b452",
    "the-signal",
    "April report examined Nova Scotia's developing kelp industry",
    "2026-04-01",
    "Nova Scotia"
  ],
  [
    "news-16f88bfa326e1d6a439be060",
    "the-signal",
    "March interview covered Nova Scotia curler Marlee Powers' Rock League plans",
    "2026-03-30",
    "Nova Scotia"
  ],
  [
    "news-b97b31a4d4e53fcdc8616499",
    "dalhousie-gazette",
    "Dalhousie’s Centre for Jewish Studies expands programming",
    "2026-10-22",
    "Halifax"
  ],
  [
    "news-364960df50a8c5f225085e8f",
    "dalhousie-gazette",
    "Dalhousie explores a program for internationally trained lawyers",
    "2026-10-22",
    "Halifax"
  ],
  [
    "news-67a6973e8df7f51479ff9767",
    "dalhousie-gazette",
    "Dalhousie men’s rugby team qualified for national championship",
    "2026-10-22",
    "Halifax"
  ],
  [
    "news-0e397b4d6b408b7c1890b8b8",
    "the-laker-news",
    "Lockview junior varsity girls won regional soccer championship",
    "2026-10-25",
    "Fall River"
  ],
  [
    "news-98ce4ab29bb711b7ae412817",
    "the-laker-news",
    "Fall River martial arts team earned eleven tournament medals",
    "2026-10-25",
    "Fall River"
  ],
  [
    "news-2caae9ef6e642875a81fe845",
    "the-laker-news",
    "Lockview cross-country teams and runners qualified for provincials",
    "2026-10-18",
    "Halifax"
  ],
  [
    "news-410ba17ed973314980f9c257",
    "halifax-retales",
    "October retail roundup covers new Halifax café and jewellery locations",
    "2026-10-03",
    "Halifax Regional Municipality"
  ],
  [
    "news-0fdaf0f2b9bd4ebadb94aa48",
    "halifax-retales",
    "ReTales reports Broken Man Café opening at Halifax Seaport",
    "2026-09-12",
    "Halifax"
  ],
  [
    "news-717e5f25c006916b345afd55",
    "halifax-retales",
    "ReTales covers FreshCo openings and other Halifax-area retail changes",
    "2026-08-22",
    "Halifax Regional Municipality"
  ]
];

for (const [id, hash] of Object.entries(baselineDecisionHashes)) assert.equal(digest(decisions.decisions.find(row=>row.id===id)), hash, 'Original decision: '+id);
for (const [id, hash] of Object.entries(baselineSourceHashes)) assert.equal(digest(registry.sources.find(row=>row.id===id)), hash, 'Original source state: '+id);
assert.equal(payload.items.length,47);
assert.equal(new Set(payload.items.map(row=>row.canonicalUrl)).size,47);
assert.equal(registry.sources.length,11);
assert.deepEqual(Object.fromEntries([...new Set(payload.items.map(row=>row.sourceId))].sort().map(id=>[id,payload.items.filter(row=>row.sourceId===id).length])), {
 'citynews-halifax':8,'dalhousie-gazette':3,'global-halifax':10,'halifax-retales':3,'ns-newsroom':3,'the-coast':11,'the-laker-news':3,'the-signal':6
});
const originalKeys = Object.keys(payload.items.find(row=>row.id===Object.keys(baselineDecisionHashes)[0])).sort();
for (const [id, sourceId, title, publishedAt, region] of expected) {
 const row=payload.items.find(item=>item.id===id);
 assert(row,'Missing reviewed historical item: '+id);
 assert.deepEqual([row.sourceId,row.title,row.publishedAt,row.region],[sourceId,title,publishedAt,region]);
 assert.equal(row.id,newsId(row.canonicalUrl));assert.equal(row.sourceGUID,row.canonicalUrl);
 assert.equal(row.publishedPrecision,'day');assert.equal(row.modifiedAt,null);
 assert.equal(row.summary,null);assert.equal(row.summaryKind,'none');
 assert.equal(row.reviewedAt,'2026-10-28T00:40:32.000Z');
 assert(row.publishedAt < row.observedAt && row.observedAt < row.reviewedAt);
 assert.deepEqual(Object.keys(row).sort(),originalKeys,'No copied-body, media or candidate-only fields');
 assert(row.regionEvidence.length>20);
 const source=registry.sources.find(item=>item.id===sourceId);
 assert.equal(row.canonicalUrl,canonicalNewsUrl(row.canonicalUrl,source.allowedHosts));
 assert(row.rightsBasis.includes(row.canonicalUrl));
 for (const term of [/Crawled:/,/cache freshness and origin retrieval time unknown/i,/upper bound of/,/not an exact origin fetch time/,/not a republication licence/]) assert.match(row.rightsBasis,term);
 assert.doesNotMatch(JSON.stringify(row),/turn\d+(?:view|search|fetch)\d+|\/(?:tmp|workspace|home)\/|sediment:|[?&](?:token|signature|sig|api_key)=/i);
 for (const unsafe of [{source_type:'aggregator'},{summary:'unreviewed feed text',summaryKind:'feed_description'},{reviewStatus:'pending'},{body:'copied article body'},{imageUrl:'https://example.org/photo.jpg'},{publishedAt:'2026-02-30'},{observedAt:'2026-10-27T00:00:00.000Z',publishedAt:'2026-10-28'}]) {
  assert.throws(()=>buildNews({version:1,decisions:[{id,status:'approved',record:{...row,...unsafe}}]},registry));
 }
}
assert(NEWS_TYPES.includes('local_business_publication'));
assert.equal(NEWS_TYPES.includes('aggregator'),false);
assert(!registry.sources.some(row=>row.id==='haligonia'));
assert.equal(payload.items.filter(row=>row.source_type==='local_business_publication').length,3);
assert.deepEqual(registry.sources.filter(row=>row.enabled).map(row=>row.id),['global-halifax']);
for (const id of ['dalhousie-gazette','the-laker-news','halifax-retales']) {
 const source=registry.sources.find(row=>row.id===id);
 assert.equal(source.status,'admitted');assert.equal(source.enabled,false);assert.equal(source.feedUrl,null);
 assert.doesNotMatch(JSON.stringify(source),/turn\d+(?:view|search|fetch)\d+|\/(?:tmp|workspace|home)\//);
 let requests=0;
 const result=await collectNews({version:1,sources:[source]},{now:'2026-10-28T00:42:00.000Z',fetchFeed:async()=>{requests++;throw new Error('manual source cannot collect');}});
 assert.equal(requests,0);assert.deepEqual(result.candidates,[]);assert.equal(result.diagnostics[0].status,'disabled');
 assert.throws(()=>validateNewsRegistry({version:1,sources:[{...source,enabled:true}]}),/news_source_not_admitted/);
}
const monthCounts=Object.fromEntries([...new Set(payload.items.map(row=>row.publishedAt.slice(0,7)))].sort().map(month=>[month,payload.items.filter(row=>row.publishedAt.startsWith(month)).length]));
assert.deepEqual(monthCounts,{'2026-03':2,'2026-04':3,'2026-08':5,'2026-09':9,'2026-10':28});
assert.equal(payload.items.at(-1).publishedAt,'2026-03-24');
assert.equal(payload.items[0].publishedAt,'2026-10-27');
const musicWeek=payload.items.find(row=>row.canonicalUrl.endsWith('/the-nova-scotia-music-week-lineup-so-far/'));
assert.equal(musicWeek.publishedAt,'2026-08-11','Original publication date, not later October update');
assert.equal(payload.items.filter(row=>row.canonicalUrl.startsWith('https://globalnews.ca/video/')).length,2,'Video-report pages remain outbound links only');
assert.deepEqual(await load('data/build/news.json'),payload);assert.equal(await read('data/news.js'),newsScript(payload));
assert.deepEqual(buildNews(decisions,registry),payload,'Identical decisions never refresh clocks');
const catalog=await load('data/build/source-catalog.json');
for (const id of ['dalhousie-gazette','the-laker-news','halifax-retales']) {
 const row=catalog.sources.find(row=>row.family==='news' && row.sourceId===id);
 assert(row);assert.equal(row.enabled,false);assert.equal(row.lastAttemptAt,null);assert.equal(row.lastSuccessAt,null);assert.equal(row.contentAt,null);
}
const openingSource=await load('data/opening-watch-source-registry.json');
assert.equal(digest(openingSource),'8e317f399738769c0a0de5285da56bd3c92df76c3c73e019caad58d22edcfe33','ReTales News links cannot change the opening-watch collector');
console.log('Archive expansion passed: 36 additions, 47 total/8 represented sources, original eleven decisions/eight source states frozen, 3 manual-only News admissions, truthful business-publication type, publication dates, cache limits, no media or collectors.');
