import { classifyLifecycleLanguage } from "./lib/lifecycle-language.mjs";
import { currentLifecycleCandidates, lifecycleCandidates, lifecycleEligible, validateLifecycleContentReceipt, lifecycleContentLimit, linkCounts } from "./lib/link-health-report.mjs";
import { validateLinkHealth } from './lib/validate-link-health.mjs';
import { digest } from './lib/link-access-policy.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const cases = [
  ["After ten years, our final service is April 29.", "closures"],
  ["We are closing our doors at this address.", "closures"],
  ["We moved to 123 Portland Street.", "moves"],
  ["Our team is relocating to Dartmouth Crossing.", "moves"]
];
for (const [text, kind] of cases) {
  const result = classifyLifecycleLanguage(text);
  if (!result[kind]?.length) throw new Error(`Expected ${kind} classification for: ${text}`);
}
const neutral = classifyLifecycleLanguage("Open tonight with our seasonal dinner menu.");
if (neutral.closures.length || neutral.moves.length) throw new Error("Neutral operating language created a lifecycle signal.");
console.log("Lifecycle closure and move language regression passed.");

for (const text of [
  'Executive Chef Philip has over 20 years experience. He worked in hotels across Japan before relocating to Canada.',
  'We are soft opening our new location on 8th Jan in Mississauga.',
  "I'd consider moving to Halifax for the firecracker rolls.",
  '<p>Open tonight.</p><script>specs.events.ui.RelocatedPagesModal=true; we moved',
  'specs.events.ui.RelocatedPagesModal'
]) assert.deepEqual(classifyLifecycleLanguage(text), {closures:[], moves:[]}, text);
for (const text of ['Our new location is in Dartmouth.', 'We are relocating to Toronto.', 'Our chef worked in Japan before relocating to Canada. Our restaurant is relocating to Dartmouth.']) assert(classifyLifecycleLanguage(text).moves.length, text);
assert(classifyLifecycleLanguage('We will be closed on Mondays beginning October 26.').closures.length);

// Both independent consumers must enforce the content boundary without relying
// on a prior release-gate invocation. Each subprocess denies all real network.
const root = await mkdtemp(join(tmpdir(), 'halifax-lifecycle-'));
try {
  for (const file of ['scripts/check-restaurant-lifecycle.mjs','scripts/check-report-deployment-parity.mjs','scripts/lib/link-health-report.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/reviewed-corrections.mjs','scripts/lib/deny-source-network.mjs','restaurant-corrections.js','source-integrity.js']) {
    await mkdir(dirname(join(root,file)), {recursive:true});
    await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  }
  await mkdir(join(root,'data/build'),{recursive:true}); await mkdir(join(root,'docs'));
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  await writeFile(join(root,'data/restaurant-media.js'),'window.HALIFAX_RESTAURANT_MEDIA={records:[]};');
  const save = (file,value) => writeFile(join(root,'data/build',file+'.json'),JSON.stringify(value));
  const sha='a'.repeat(40), url='https://example.com/location?site=one';
  const catalog={restaurants:[{id:'venue',name:'Venue',website:url},{id:'social-only',name:'Other Venue',website:'https://other.example/location'}]};
  await save('catalog',catalog);
  for(const name of ['official-site-signals','first-party-sources','website-feed-signals','recent-social-posts']) await save(name,{});
  await save('website-page-intelligence',{records:[{restaurantId:'venue',title:'We are closing our doors.',publishedAt:'4545-01-01T00:00:00Z'}]});
  await save('content-coverage-report',{sourceCommitSha:sha,restaurantCoverage:{totalCanonicalPlaces:2,withVerifiedOfficialWebsite:0,withOfficialWebsite:2,withUsableMedia:0,archivedLifecyclePlaces:0,withStructuredUpcomingEvents:0},eventCoverage:{canonicalRestaurantsWithStructuredUpcomingEvents:0,structuredUpcomingRestaurantEvents:0,upcomingStructuredRestaurantEventRecords:0}});
  const now=Date.now(), iso=offset=>new Date(now+offset).toISOString();
  const observedAt=iso(-2000), completedAt=iso(-1000);
  const row={url,finalUrl:url,kinds:['official_website'],entityIds:['venue'],officialEntityIds:['venue'],attempted:true,attemptedAt:iso(-3000),assessedAt:iso(-500),attempt:1,state:'ok',status:200,confirmedBroken:false,observedAt,lifecycle:[{kind:'moves',phrase:'we moved',excerpt:'Our restaurant: we moved to Dartmouth.',reviewState:'candidate_requires_location_review'}],receipts:[{url,status:200,observedAt,attempt:1,requestId:'1',attemptedAt:iso(-3000),mediaType:'text/html'}],contentReceipt:{version:1,url,status:200,observedAt,completedAt,mediaType:'text/html',maxBytes:lifecycleContentLimit,bytesRead:57,termination:'eof',readCompleted:true,cancelCompleted:true}};
  const links={version:3,lifecycleExtraction:true,sourceCommitSha:sha,complete:true,generatedAt:iso(0),results:[row],lifecycleCandidates:lifecycleCandidates([row],true,now)};
  const policy=JSON.parse(await readFile(new URL('../data/source-link-access-holds.json',import.meta.url),'utf8'));
  const gateInputs={catalog:{restaurants:[catalog.restaurants[0]]},firstParty:{records:[]},facts:{records:[]},city:{events:[]}};
  const validateGate=report=>validateLinkHealth({...report,sourceWorkflowRunId:null,sourceWorkflowRunAttempt:null,accessPolicySha256:digest(policy),scope:'active_catalog_official_social_menu_actions',totalCatalogRecords:1,activeCatalogRecords:1,totalUniqueUrls:1,counts:linkCounts(report.results),pendingAccessHolds:[],pendingTransportReviews:[],lateRestrictionReceipts:[],broken:[],restricted:[],transient:[],held:[]},gateInputs,policy,sha,now);
  validateGate(links);
  const runScript=script=>execFileSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'scripts',script)],{cwd:root,env:{...process.env,SOURCE_COMMIT_SHA:sha,GITHUB_SHA:sha},stdio:'pipe',timeout:10000});
  const run=async()=>{runScript('check-restaurant-lifecycle.mjs');return JSON.parse(await readFile(join(root,'data/build/restaurant-lifecycle-report.json')));};
  await save('source-link-health-report',links);
  let report=await run(); runScript('check-report-deployment-parity.mjs');
  assert.equal(report.liveSourceAudit.state,'same_head_complete');
  assert.equal(report.liveSourceAudit.candidates,1);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='release_official_page_fetch').sourceUrl,links.lifecycleCandidates[0].sourceUrl);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='website-page-intelligence').publishedAt,null);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='website-page-intelligence').publicationDateState,'future');
  assert(lifecycleEligible(row,now));
  assert.equal(validateLifecycleContentReceipt(row,now),row.contentReceipt);
  assert.deepEqual(currentLifecycleCandidates(links,now,catalog),links.lifecycleCandidates);

  let rejected=0;
  async function reject(label, change, sourceCatalog = catalog, gateCheck = false) {
    const forged=structuredClone(links); change(forged,forged.results[0]);
    await save('source-link-health-report',forged);
    for (const script of ['check-restaurant-lifecycle.mjs','check-report-deployment-parity.mjs']) {
      assert.throws(()=>runScript(script),error=>error.status!==0 && !error.signal && /Lifecycle (?:candidates lack|official entity does not match)/.test(String(error.stderr)),script+' must reject '+label);
    }
    assert.throws(()=>currentLifecycleCandidates(forged,now,sourceCatalog),/Lifecycle (?:candidates lack|official entity does not match)/,label);
    if(gateCheck) {
      assert.throws(()=>validateLifecycleContentReceipt(forged.results[0],now),/Lifecycle candidates lack/,label+' must fail the shared content helper');
      assert.equal(lifecycleEligible(forged.results[0],now),false,label+' is ineligible');
      assert.throws(()=>validateGate(forged),gateCheck===true?/Lifecycle candidates lack/:gateCheck,label+' must also fail the release gate');
    }
    rejected++;
  }
  for (const kinds of [['social:third-party-profile'],['action:reservation'],['menu'],[]]) await reject('nonofficial kind '+kinds,(_,r)=>{r.kinds=kinds;});
  for (const field of ['contentReceipt','officialEntityIds','attemptedAt','assessedAt','receipts']) await reject('missing '+field,(_,r)=>{delete r[field];});
  await reject('unattempted200',(_,r)=>{r.attempted=false;});
  await reject('reused200',(_,r)=>{r.reusedObservation=true;});
  await reject('held200',(_,r)=>{r.state='held';});
  await reject('non-success',(_,r)=>{r.state='restricted';r.status=403;r.receipts[0].status=403;r.contentReceipt.status=403;});
  await reject('expired200',(_,r)=>{r.attemptedAt=iso(-90003000);r.observedAt=r.receipts[0].observedAt=r.contentReceipt.observedAt=iso(-90002000);r.contentReceipt.completedAt=iso(-90001000);});
  await reject('future observation',(_,r)=>{r.observedAt=r.receipts[0].observedAt=r.contentReceipt.observedAt=iso(60000);});
  await reject('missing final response',(_,r)=>{r.receipts=[];});
  await reject('final status mismatch',(_,r)=>{r.receipts[0].status=204;});
  await reject('receipt wrong URL',(_,r)=>{r.receipts[0].url='https://example.com/other';});
  await reject('receipt wrong attempt',(_,r)=>{r.receipts[0].attempt=2;});
  await reject('empty official identities',(_,r)=>{r.officialEntityIds=[];});
  await reject('duplicate official identity',(_,r)=>{r.officialEntityIds=['venue','venue'];});
  await reject('identity outside row',(_,r)=>{r.officialEntityIds=['unknown'];});
  await reject('forged official ownership',(f,r)=>{r.entityIds=r.officialEntityIds=['social-only'];f.lifecycleCandidates[0].restaurantIds=['social-only'];});
  for (const [field,value] of [
    ['version',2],['url','https://example.com/other'],['status',201],['observedAt',iso(-2100)],
    ['mediaType','application/json'],['mediaType','text/html-malicious'],['mediaType','text/plain'],
    ['maxBytes',512001],['bytesRead',512001],['bytesRead',-1],['bytesRead',1.5],['bytesRead',0],
    ['readCompleted',false],['readCompleted',undefined],['cancelCompleted',false],['cancelCompleted',undefined],
    ['termination','pending'],['termination','byte_limit'],['completedAt',undefined],
    ['completedAt',iso(-2500)],['completedAt',iso(-200)],['completedAt',iso(60000)]
  ]) await reject('content '+field+'='+value,(_,r)=>{r.contentReceipt[field]=value;},catalog,field==='bytesRead' && value===0);
  // A claimed HTML content marker cannot override the genuine final response
  // header, including across redirects. All four consumer paths reject these.
  for(const mediaType of ['text/plain','application/json','',undefined,null,'text/html-malicious']) await reject('HTTP header laundering '+mediaType,(_,r)=>{
    if(mediaType===undefined) delete r.receipts[0].mediaType; else r.receipts[0].mediaType=mediaType;
  },catalog,true);
  for(const [header,claimed] of [['text/html','application/xhtml+xml'],['application/xhtml+xml','text/html']]) await reject('HTTP/content MIME mismatch '+header,(_,r)=>{r.receipts[0].mediaType=header;r.contentReceipt.mediaType=claimed;},catalog,true);
  await reject('HTML redirect header laundering plain-text final response',(_,r)=>{
    const target='https://example.com/official';r.finalUrl=r.contentReceipt.url=target;
    r.receipts=[{url,status:302,observedAt:iso(-2500),attempt:1,redirectUrl:target,requestId:'1',attemptedAt:iso(-3000),mediaType:'text/html'},
      {url:target,status:200,observedAt,attempt:1,requestId:'2',attemptedAt:iso(-2200),mediaType:'text/plain'}];
  },catalog,true);
  const receiptChain=lengths=>lengths.flatMap((length,index)=>Array.from({length},(_,step)=>({url,status:step===length-1?(index===lengths.length-1?200:404):302,observedAt,attempt:index+1,requestId:String(lengths.slice(0,index).reduce((sum,n)=>sum+n,0)+step+1),attemptedAt:iso(-3000),mediaType:'text/html',...(step===length-1?{}:{redirectUrl:url})})));
  for(const lengths of [[5],[4,5]]) await reject('more than four HTTP receipts per attempt '+lengths,(_,r)=>{r.attempt=lengths.length;r.receipts=receiptChain(lengths);},catalog,/HTTP chain exceeds four-request bound/);
  for(const lengths of [[4],[4,4]]) {
    const good=structuredClone(links);good.results[0].attempt=lengths.length;good.results[0].receipts=receiptChain(lengths);
    validateGate(good);assert.deepEqual(currentLifecycleCandidates(good,now,catalog),good.lifecycleCandidates);
    await save('source-link-health-report',good);await run();runScript('check-report-deployment-parity.mjs');
  }
  await reject('flattened-only injection',(_,r)=>{r.lifecycle=[];});
  await reject('flattened foreign identity',f=>{f.lifecycleCandidates[0].restaurantIds=['social-only'];});
  await reject('flattened altered phrase',f=>{f.lifecycleCandidates[0].phrase='permanently closed';});
  await reject('PR extraction bypass',f=>{f.lifecycleExtraction=false;});

  // Same URL can have an official owner and an unrelated social/action owner.
  // Only the exact official owner is allowed into a lifecycle candidate.
  const mixed=structuredClone(links);mixed.results[0].kinds.push('action:reservation');mixed.results[0].entityIds.push('social-only');
  await save('source-link-health-report',mixed);report=await run();runScript('check-report-deployment-parity.mjs');
  assert.equal(report.liveSourceAudit.candidates,1);
  assert.deepEqual(report.candidates.find(x=>x.sourceLayer==='release_official_page_fetch').restaurantIds,['venue']);
  assert.equal(report.candidates.filter(x=>x.sourceLayer==='release_official_page_fetch' && x.restaurantId==='social-only').length,0);
  await reject('merged row falsely labels social owner',(f,r)=>{r.entityIds.push('social-only');r.officialEntityIds.push('social-only');f.lifecycleCandidates[0].restaurantIds.push('social-only');});

  // Bind to full canonical website, not merely the same host. Fragments are not
  // sent over HTTP; www/trailing-dot aliases use the established host identity.
  for (const website of ['https://example.com/other?site=one','https://example.com/location?site=two','http://example.com/location?site=one']) {
    const sourceCatalog={restaurants:[{...catalog.restaurants[0],website},catalog.restaurants[1]]};
    await save('catalog',sourceCatalog);
    await reject('catalog website mismatch '+website,()=>{},sourceCatalog);
  }
  await save('catalog',{restaurants:[{...catalog.restaurants[0],website:'https://www.example.com./location?site=one#hours'},catalog.restaurants[1]]});
  await save('source-link-health-report',links);await run();runScript('check-report-deployment-parity.mjs');
  await save('catalog',catalog);
  for (const content of [{mediaType:'application/xhtml+xml'},{termination:'byte_limit',bytesRead:lifecycleContentLimit}]) {
    const good=structuredClone(links);Object.assign(good.results[0].contentReceipt,content);
    if(content.mediaType) good.results[0].receipts[0].mediaType=content.mediaType;
    validateGate(good);assert.deepEqual(currentLifecycleCandidates(good,now,catalog),good.lifecycleCandidates);
    await save('source-link-health-report',good);await run();runScript('check-report-deployment-parity.mjs');
  }
  const redirect=structuredClone(links), target='https://example.com/official';
  redirect.results[0].finalUrl=redirect.results[0].contentReceipt.url=target;
  redirect.results[0].receipts=[{url,status:302,observedAt:iso(-2500),attempt:1,redirectUrl:target,requestId:'1',attemptedAt:iso(-3000),mediaType:'text/plain'},{url:target,status:200,observedAt,attempt:1,requestId:'2',attemptedAt:iso(-2200),mediaType:'text/html'}];
  validateGate(redirect);assert.deepEqual(currentLifecycleCandidates(redirect,now,catalog),redirect.lifecycleCandidates);
  await save('source-link-health-report',redirect);await run();runScript('check-report-deployment-parity.mjs');

  await save('source-link-health-report',{...links,sourceCommitSha:'old-head'});report=await run();
  assert.equal(report.liveSourceAudit.state,'not_current_complete');
  assert(!report.candidates.some(x=>x.sourceLayer==='release_official_page_fetch'));
  for (const generatedAt of [undefined,null,'','not-a-date',iso(60000),iso(-86400001)]) {
    await save('source-link-health-report',{...links,generatedAt});report=await run();
    assert.equal(report.liveSourceAudit.state,'not_current_complete','Invalid report date cannot be current: '+generatedAt);
    assert(!report.candidates.some(x=>x.sourceLayer==='release_official_page_fetch'));
  }
  const held={...row,state:'held',attempted:false,attemptedAt:null,attempt:0,status:null,observedAt:null,finalUrl:null,lifecycle:[],receipts:[]};delete held.contentReceipt;
  await save('source-link-health-report',{...links,results:[held],lifecycleCandidates:[]});report=await run();runScript('check-report-deployment-parity.mjs');
  assert.equal(report.liveSourceAudit.candidates,0,'Held rows cannot become closure candidates');
  assert(!lifecycleEligible(held,now));
  console.log('Lifecycle consumers passed: '+rejected+' independent rejection cases, bounded HTML receipts, exact official ownership, held/stale evidence and retained-source clocks.');
} finally { await rm(root,{recursive:true,force:true}); }
