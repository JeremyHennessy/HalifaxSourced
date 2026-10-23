import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { feedEntryBlocks, validatePreviousFeedSnapshot } from './lib/first-party-feed-safety.mjs';
// A real denial or unresolved native request is an intentional nonpublishable
// subprocess result, not a failed fixture. Derive this from the finite plan,
// then independently require its diagnostic rather than accepting any exit1.
function assertAccessExit(result, specs, label, boundary = null) {
  const restrictions = specs.filter(spec => [401,403,429].includes(spec?.status));
  assert(!specs.some(spec => spec?.delayFetch || spec?.lateFetch), label + ': native delay alone cannot establish a settlement boundary');
  const unsettled = specs.some(spec => spec?.stallFetch) || boundary?.stage === 'after-suspension';
  const expected = restrictions.length || unsettled ? 1 : 0;
  assert.equal(result.error,undefined,label + ': child must finish within its existing bound');
  assert.equal(result.signal,null,label + ': child must not be killed');
  assert.equal(result.status,expected,label + '\n' + result.stderr);
  const diagnostics = result.stderr.split('\n').filter(line => line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line => JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
  for (const spec of restrictions) assert(diagnostics.some(item => ['http_restriction','late_http_restriction'].includes(item.kind) && item.evidence.receipt.status === spec.status),label + ': actual denial diagnostic');
  if (unsettled) assert(diagnostics.some(item => item.kind === 'unsettled_transport'),label + ': unresolved request diagnostic');
  assert(diagnostics.every(item => item.disposition === 'nonpublishable_requires_review' && (item.kind === 'unsettled_transport' ? unsettled : restrictions.some(spec => item.evidence.receipt?.status === spec.status))),label + ': no unexpected access diagnostic');
}


// Keep the virtual fixture clock after real committed access observations; otherwise
// the production policy must (correctly) reject receipts that seem to be in the future.
const accessLedger = JSON.parse(await readFile(new URL('../data/source-link-access-holds.json',import.meta.url),'utf8'));
const latestAcceptedReceipt = Math.max(...[accessLedger,...(accessLedger.historicalEvidence||[])].flatMap(group=>group.observations.map(row=>Date.parse(row.observedAt))));
const clock = new Date(Math.max(Date.parse('2026-10-23T16:00:00.000Z'),latestAcceptedReceipt + 1000)).toISOString();
const feed = 'https://fixture.example/feed?kind=rss';
const tail = 'https://fixture.example/tail';
const robot = 'https://fixture.example/robots.txt';
const policy = {body:'User-agent: *\nDisallow:',type:'text/plain'};
const entry = (title='Fresh patio', link='https://fixture.example/fresh', date='2026-10-21T12:00:00Z') => `<item><title>${title}</title><link>${link}</link>${date ? `<pubDate>${date}</pubDate>` : ''}<description><![CDATA[Short patio summary <b>only</b>.]]></description><media:thumbnail url="https://images.example/photo.jpg"/></item>`;
const rss = entries => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture</title>${entries}</channel></rss>`;
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture</title><entry><title>Atom brunch</title><link href="https://fixture.example/atom"/><updated>2026-10-21T12:00:00Z</updated><summary>Breakfast</summary></entry></feed>';
const record = (restaurantId='venue', url=feed, patch={}) => ({restaurantId,name:'Fixture',website:'https://fixture.example/',reviewState:'verified',feeds:[{url,type:'application/rss+xml',reviewState:'verified_link',...patch}]});
const old = (patch={}) => ({restaurantId:'venue',restaurantName:'Historic name',platform:'website_feed',title:'Original patio observation',excerpt:'Original bounded excerpt',postUrl:'https://fixture.example/old',feedUrl:feed,mediaUrl:'https://images.example/old.jpg',publishedAt:'2026-10-01T12:00:00.000Z',observedAt:'2026-10-02T12:00:00.000Z',lastVerifiedAt:null,sourceUpdatedAt:'2026-09-30T12:00:00.000Z',reviewedAt:'2026-10-03T12:00:00.000Z',signalMatches:{patio:['patio']},sourceKind:'official_feed',associationBasis:'unique_feed_link_from_official_website',confidence:'official_source_signal',reviewState:'source_signal',rightsState:'public_reference_not_media_licence',permissionConfirmed:false,arbitraryProvenance:{nested:[null,'unchanged']},...patch});
const snapshot = posts => ({version:3,generatedAt:'2026-10-03T00:00:00.000Z',posts,signals:posts.filter(p=>Object.values(p.signalMatches).some(h=>h.length))});
const js = payload => `window.HALIFAX_WEBSITE_FEED_SIGNALS = ${JSON.stringify(payload)};\n`;
const routes = () => ({[robot]:policy,[feed]:{body:rss(entry()),type:'application/rss+xml'}});
const root = await mkdtemp(join(tmpdir(),'halifax-feed-safety-'));
let passed=0, activeCase=null, fixtureFailed=false;
try {
  await mkdir(join(root,'scripts/lib'),{recursive:true}); await mkdir(join(root,'data/build'),{recursive:true});
  for(const file of ['scripts/import-first-party-feed-signals.mjs','scripts/lib/first-party-feed-safety.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/robots-policy.mjs','scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json','scripts/lib/deny-source-network.mjs','source-integrity.js']) await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  await writeFile(join(root,'runner.mjs'),`
import assert from 'node:assert/strict';
import fsPromises, {readFile,writeFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {sourceAccessState} from './scripts/lib/source-access-state.mjs';
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url)));
const RealDate=Date; globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[config.clock]));} static now(){return RealDate.parse(config.clock);} };
const trace=[], unexpected=[], counts=new Map(), events=[];
const note=(event,extra={})=>{const row={sequence:events.length,event,...extra};events.push(row);appendFileSync(new URL('./events.jsonl',import.meta.url),JSON.stringify(row)+'\\n');};
const boundary=config.boundary;
let releaseBoundary, markProcessed, state, released=false;
const releasedPromise=new Promise(resolve=>releaseBoundary=stage=>{if(released)throw Error('Duplicate boundary release');released=true;note('release',{stage});resolve();});
const processedPromise=new Promise(resolve=>markProcessed=resolve);
if(boundary){
 new Headers(); // Initialize fixture machinery before the unchanged 50ms operation deadlines.
 const NativeController=AbortController;let controllerId=0;
 globalThis.AbortController=class extends NativeController {
  constructor(){super();this.fixtureId=++controllerId;note('controller',{id:this.fixtureId});}
  abort(reason){note('abort',{id:this.fixtureId});super.abort(reason);if(boundary.stage==='outer-abort'&&this.fixtureId===1)queueMicrotask(()=>releaseBoundary('outer-abort'));}
 };
 state=sourceAccessState();
 const suspend=state.suspend,response=state.response,failed=state.failed;
 state.suspend=request=>{note('suspend-called',{url:request.target,settled:request.settled});const hold=suspend(request);note('suspend-result',{url:request.target,reason:hold?.reason||null});if(request.target===boundary.url&&boundary.stage==='after-suspension')releaseBoundary('after-suspension');return hold;};
 state.response=(request,value,late)=>{const receipt=response(request,value,late);note('native-settled',{url:request.target,status:value.status,late,pending:state.pendingTransportReviews.length});if(request.target===boundary.url&&boundary.resource!=='body')markProcessed();return receipt;};
 state.failed=request=>{failed(request);note('native-rejected',{url:request.target,pending:state.pendingTransportReviews.length});if(request.target===boundary.url)markProcessed();};
 const actualWrite=fsPromises.writeFile;
 fsPromises.writeFile=async(...args)=>{const result=await actualWrite(...args);if(String(args[0]).endsWith('/data/website-feed-signals.js')){note('snapshot-written');if(boundary.stage==='after-snapshot')releaseBoundary('after-snapshot');}return result;};
 syncBuiltinESMExports();
}
globalThis.fetch=async(input,options={})=>{
 const url=String(input);const item=config.routes[url]; const count=(counts.get(url)||0)+1;counts.set(url,count);
 trace.push({url,headers:Object.fromEntries(new Headers(options.headers)),redirect:options.redirect,aborted:options.signal?.aborted,signal:options.signal instanceof AbortSignal});
 note('fetch',trace.at(-1));
 if(!item || count>(item.max||1) || trace.length>300){unexpected.push(url);throw new Error('Unexpected fixture URL: '+url);}
 if(item.throw)throw new TypeError('synthetic network failure');
 const selected=boundary?.url===url;
 if(selected){
  options.signal.addEventListener('abort',()=>{note('request-abort',{url});if(boundary.stage==='abort-cleanup')queueMicrotask(()=>releaseBoundary('abort-cleanup'));},{once:true});
  if(boundary.resource!=='body')await releasedPromise;
  if(boundary.outcome==='reject'){note('fetch-reject',{url});throw new TypeError('synthetic native rejection at selected boundary');}
 }
 if(item.stallFetch)return new Promise(()=>{});
 const response=new Response([204,304].includes(item.status)?null:(item.body??''),{status:item.status||200,headers:{...(item.type===null?{}:{'content-type':item.type||'application/rss+xml'}),...(item.location?{location:item.location}:{}),...(item.length?{'content-length':String(item.length)}:{})}});
 Object.defineProperty(response,'url',{value:url});
 if(item.throwBody)response.text=async()=>{throw new Error('synthetic body failure');};
 if(item.stallBody)response.text=()=>new Promise(()=>{});
 if(boundary){
  const text=response.text.bind(response);
  response.text=async()=>{note('body-read',{url});if(selected&&boundary.resource==='body')await releasedPromise;const value=await text();note('body-return',{url});if(selected&&boundary.resource==='body')markProcessed();return value;};
  note('response-return',{url,aborted:options.signal.aborted});
 }
 return response;
};
let failure=null;try {await import('./scripts/import-first-party-feed-signals.mjs');}catch(error){failure=error.message;}
if(boundary&&!failure){await processedPromise;await state.drainDecisions();await new Promise(resolve=>setImmediate(resolve));assert(released,'Selected boundary must execute');}
await writeFile(new URL('./trace.json',import.meta.url),JSON.stringify({trace,unexpected,failure,events,pendingTransportReviews:state?.pendingTransportReviews||[],lateRestrictionReceipts:state?.lateRestrictionReceipts||[]}));
assert.deepEqual(unexpected,[],'unexpected transport remains fatal even if caught by importer');
if(failure){console.error(failure);process.exitCode=1;}
`);
  async function run(name,{network=routes(),records=[record()],prior=snapshot([old()]),exclusions=[],env={},failed=0,retained=0,posts=1,check,abort=false,badJson,badJs,sourceText,overrideText,boundary=null,time=clock}={}) {
    activeCase={name,boundary,env:{FEED_PULL_TIMEOUT_MS:'50',FEED_PULL_DELAY_MS:'0',FEED_PULL_LIMIT:'120',FEED_PULL_CONCURRENCY:'2',FEED_LOOKBACK_DAYS:'180',FEED_EXCERPT_CHARS:'420',...env},childTimeoutMs:5000};
    const jsonPath=join(root,'data/build/website-feed-signals.json'),jsPath=join(root,'data/website-feed-signals.js');
    await rm(jsonPath,{force:true}); await rm(jsPath,{force:true});
    if(prior!==null){await writeFile(jsonPath,badJson??JSON.stringify(prior));await writeFile(jsPath,badJs??js(prior));}
    if(badJson===null)await rm(jsonPath,{force:true}); if(badJs===null)await rm(jsPath,{force:true});
    const beforeJson=await readFile(jsonPath,'utf8').catch(()=>null),beforeJs=await readFile(jsPath,'utf8').catch(()=>null);
    await writeFile(join(root,'data/build/first-party-sources.json'),sourceText??JSON.stringify({records}));
    await writeFile(join(root,'data/feed-review-overrides.json'),overrideText??JSON.stringify({records:exclusions}));
    await writeFile(join(root,'config.json'),JSON.stringify({routes:network,clock:time,boundary}));
    await rm(join(root,'trace.json'),{force:true});
    await rm(join(root,'events.jsonl'),{force:true});
    const result=spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'runner.mjs')],{cwd:root,encoding:'utf8',timeout:5000,env:{...process.env,FEED_PULL_TIMEOUT_MS:'50',FEED_PULL_DELAY_MS:'0',FEED_PULL_LIMIT:'120',FEED_PULL_CONCURRENCY:'2',FEED_LOOKBACK_DAYS:'180',FEED_EXCERPT_CHARS:'420',...env}});
    activeCase.result={status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,error:result.error?{name:result.error.name,message:result.error.message,code:result.error.code}:null};
    activeCase.before={json:beforeJson,js:beforeJs};
    assert.equal(result.error,undefined,`${name}: process failed/timed out`);
    const trace=JSON.parse(await readFile(join(root,'trace.json'),'utf8').catch(error=>{throw new Error(name+': '+result.stderr+' '+result.stdout+' '+error.message);}));
    assert.deepEqual(trace.unexpected,[],`${name}: unexpected requests`);
    if(abort){assert.notEqual(result.status,0,name);assert.ok(trace.failure,name);assert.deepEqual(trace.trace,[],`${name}: validate before network`);assert.equal(await readFile(jsonPath,'utf8').catch(()=>null),beforeJson,name);assert.equal(await readFile(jsPath,'utf8').catch(()=>null),beforeJs,name);passed++;return;}
    assertAccessExit(result,trace.trace.map(call=>network[call.url]),name,boundary);
    const payload=JSON.parse(await readFile(jsonPath,'utf8'));
    const script=await readFile(jsPath,'utf8');assert.deepEqual(JSON.parse(script.replace(/^window\.HALIFAX_WEBSITE_FEED_SIGNALS = /,'').replace(/;\n$/,'')),payload,`${name}: parity`);
    validatePreviousFeedSnapshot(payload);
    assert.equal(payload.failedFeeds,failed,`${name}: failures`);assert.equal(payload.retainedPosts,retained,`${name}: retained`);assert.equal(payload.posts.length,posts,`${name}: posts`);
    for(const call of trace.trace){assert.equal(call.redirect,'manual',name);assert.equal(call.signal,true,name);assert.equal(call.aborted,false,`${name}: no aborted request admitted`);if(new URL(call.url).pathname.startsWith('/robots'))assert.deepEqual(call.headers,{'user-agent':'HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)'},`${name}: policy headers`);}
    if(retained===1 && posts===1 && prior.posts.length===1)assert.deepEqual(payload.posts,prior.posts,`${name}: original clocks/review/rights/source preserved`);
    if(check)check(payload,trace.trace,trace);passed++;return payload;
  }
  await run('valid RSS', {check:p=>{assert.equal(p.feedsChecked,1);assert.equal(p.posts[0].observedAt,clock);assert.equal(p.posts[0].excerpt,'Short patio summary only .');assert.equal(p.posts[0].mediaUrl,'https://images.example/photo.jpg');}});
  await run('first run', {prior:null});
  await run('Atom', {network:{[robot]:policy,[feed]:{body:atom,type:'application/atom+xml'}}});
  for(const type of ['application/xml','text/xml','text/plain',null])await run('qualified MIME '+type,{network:{[robot]:policy,[feed]:{body:rss(entry()),type}}});
  for(const body of [rss(''),'<rss><channel/></rss>','<feed xmlns="http://www.w3.org/2005/Atom"/>','<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel/></rdf:RDF>'])await run('successful valid empty',{network:{[robot]:policy,[feed]:{body}},posts:0,check:p=>{assert.equal(p.feedsChecked,1);assert.deepEqual(p.signals,[]);}});
  for(const body of [rss('<!--'+entry()+'-->'),rss('<description><![CDATA['+entry().replace(/<!\[CDATA\[|\]\]>/g,'')+']]></description>')])await run('comment/CDATA pseudo-items stay empty',{network:{[robot]:policy,[feed]:{body}},posts:0});
  for(const extra of ['<!--<title>Wrong</title><link>https://wrong.example/</link><media:thumbnail url="https://wrong.example/photo.jpg"/>-->', '<description><![CDATA[<title>Wrong</title><link>https://wrong.example/</link><media:thumbnail url="https://wrong.example/photo.jpg"/>]]></description>'])await run('field-level comment/CDATA cannot supply metadata',{network:{[robot]:policy,[feed]:{body:rss(entry().replace('<item>','<item>'+extra))}},check:p=>{assert.equal(p.posts[0].title,'Fresh patio');assert.equal(p.posts[0].postUrl,'https://fixture.example/fresh');assert.equal(p.posts[0].mediaUrl,'https://images.example/photo.jpg');}});
  await run('all published outside lookback is valid empty',{network:{[robot]:policy,[feed]:{body:rss(entry('Old patio','https://fixture.example/older','2020-01-01'))}},posts:0,check:p=>assert.equal(p.feedsChecked,1)});
  for(const status of [201,202,204,206,304,400,401,403,404,410,429,500,503])await run('content status '+status,{network:{[robot]:policy,[feed]:{status,body:rss(entry())}},failed:1,retained:1});
  for(const patch of [{throw:true},{stallFetch:true},{throwBody:true},{stallBody:true},{body:rss(entry()),type:'text/html'},{body:rss(entry()),type:'application/json'},{length:4194305},{body:'x'.repeat(4194305)}])await run('content failure '+Object.keys(patch).join(','),{network:{[robot]:policy,[feed]:patch},failed:1,retained:1});
  for(const body of ['', '   ','<html><body>Challenge</body></html>','{}','<error>Denied</error>','<rss/>','<rss><channel>','<rss><channel></rss>','<rss><channel/></rss>tail','<rss><channel/></rss><rss><channel/></rss>','<!DOCTYPE rss SYSTEM "https://not-allowed.example/dtd"><rss><channel/></rss>',rss('<item><title>Missing permalink</title></item>'),rss(entry()+'<item><title>Bad second entry</title></item>'),rss(entry().replace('Fresh patio','bad & entity')),rss(entry().replace('Fresh patio','bad &#99999999;')),rss('<entry/>'),rss('<wrapper>'+entry()+'</wrapper>'),rss(entry().replace('url="https://images.example/photo.jpg"','url="one" url="two"'))])await run('malformed/challenge feed',{network:{[robot]:policy,[feed]:{body}},failed:1,retained:1});
  for(const [name,patch,allowed] of [
    ['empty',{body:'',type:'text/plain'},true],['comment',{body:'# empty',type:'text/plain'},true],['sitemap',{body:'Sitemap: https://fixture.example/sitemap.xml',type:'text/plain'},true],['absent404',{status:404},true],['absent410',{status:410},true],
    ...[201,204,206,304,401,403,429,500,503].map(status=>[String(status),{status},false]),
    ['network',{throw:true}],['fetch stall',{stallFetch:true}],['body error',{throwBody:true}],['body stall',{stallBody:true}],['HTML',{body:'<html>challenge</html>',type:'text/plain'}],['JSON',{body:'{}',type:'text/plain'}],['type',{body:'User-agent: *\nDisallow:',type:'text/html'}],['invalid rule',{body:'User-agent: *\nDisallow: feed',type:'text/plain'}],
    ...['User-agent: *\nDisallow: /feed?kind=rss$', 'User-agent: *\nDisallow: /*?*kind=*', 'User-agent: HalifaxSourced\nDisallow: /other\nUser-agent: HalifaxSourced\nDisallow: /feed', 'User-agent: NotHalifaxSourced\nDisallow: /feed\nUser-agent: *\nDisallow: /other', 'User-agent: *\nDisallow: /\nAllow: /feed'].map(body=>['rule',{body,type:'text/plain'}])
  ])await run('robots '+name,{network:{[robot]:patch,...(allowed?{[feed]:{body:rss(entry())}}:{})},failed:allowed?0:1,retained:allowed?0:1,check:(_,t)=>{assert.equal(t.filter(c=>c.url===robot).length,1);if(!allowed)assert.ok(!t.some(c=>c.url===feed));}});
  for(const resource of ['content','robots'])for(const kind of ['allow','deny','cross-host','quarantine','missing','invalid','loop','new-origin-allow','new-origin-deny']){
    const network=routes(),url=resource==='content'?feed:robot;
    const target=kind==='cross-host'?'https://other.example/target':kind==='quarantine'?'https://glitterbeancafe.com./target':kind==='invalid'?'http://[':kind==='loop'?url:kind.startsWith('new-origin')?'http://fixture.example:8080/target':`https://fixture.example/${resource==='robots'?'robots-final':'target'}`;
    network[url]={status:302,...(kind==='missing'?{}:{location:target}),...(kind==='loop'?{max:4}:{})};
    const allowed=['allow','new-origin-allow'].includes(kind);
    if(resource==='content' && ['deny','new-origin-deny'].includes(kind))network[kind==='deny'?robot:'http://fixture.example:8080/robots.txt']={body:'User-agent: *\nDisallow: /target',type:'text/plain'};
    if(resource==='content' && kind==='new-origin-allow')network['http://fixture.example:8080/robots.txt']=policy;
    if(allowed || (resource==='robots' && ['deny','new-origin-deny'].includes(kind)))network[target]=resource==='robots'?{body:`User-agent: *\nDisallow: ${allowed?'':'/'}`,type:'text/plain'}:{body:rss(entry())};
    await run(`${resource} redirect ${kind}`,{network,failed:allowed?0:1,retained:allowed?0:1,check:(_,t)=>{if(['cross-host','quarantine'].includes(kind))assert.ok(!t.some(c=>c.url===target));}});
  }
  // Native resolution/rejection during the one-turn abort cleanup is settled,
  // not durable uncertainty. A response released only after actual suspension
  // must retain that unknown outcome. Neither boundary admits expired content.
  const boundaries=[];
  for(const resource of ['robots','content'])for(const stage of ['abort-cleanup','after-suspension'])for(const outcome of [200,302,401,403,429,'reject'])boundaries.push({resource,stage,outcome});
  for(const outcome of [200,302])boundaries.push({resource:'robots',stage:'outer-abort',outcome});
  for(const stage of ['abort-cleanup','after-snapshot'])boundaries.push({resource:'body',stage,outcome:200});
  for(const boundary of boundaries){
    const {resource,stage,outcome}=boundary,url=resource==='robots'?robot:feed;
    boundary.url=url;
    const patch={body:resource==='robots'?policy.body:rss(entry()),type:resource==='robots'?'text/plain':'application/rss+xml',...(outcome==='reject'?{}:{status:outcome}),...(outcome===302?{location:'/boundary-redirect'}:{})};
    const network={...routes(),[url]:patch};
    const liveRobotsRedirect=resource==='robots'&&stage==='outer-abort'&&outcome===302;
    const redirected='https://fixture.example/boundary-redirect';
    if(liveRobotsRedirect)network[redirected]=policy;
    const label=`deadline boundary ${resource} / ${stage} / ${outcome}`;
    await run(label,{network,boundary,failed:1,retained:1,check:(payload,calls,details)=>{
      assert.equal(payload.feedsChecked,0,label+': no late successful feed');
      assert.deepEqual(calls.map(call=>call.url),resource==='robots'?(liveRobotsRedirect?[robot,redirected]:[robot]):[robot,feed],label+': no expired-signal transport or content admission');
      const events=details.events,at=event=>events.findIndex(item=>item.event===event&&(event.startsWith('native-')?item.url===url:true));
      const requestAbort=events.findIndex(item=>item.event==='request-abort'&&item.url===url);
      const settled=at(outcome==='reject'?'native-rejected':'native-settled');
      const unresolved=stage==='after-suspension';
      assert.equal(details.pendingTransportReviews.length,unresolved?1:0,label+': exact controlled uncertainty');
      if(unresolved){assert(requestAbort>=0&&at('suspend-result')>requestAbort&&settled>at('suspend-result'),label+': actual abort then suspension then settlement');const hold=details.pendingTransportReviews[0];assert.equal(hold.reason,'transport_unresolved');assert.equal(hold.evidence.status,null);assert.equal(hold.evidence.observedAt,null);}
      else assert(!events.some(item=>item.event==='suspend-called'),label+': settled request must not be suspended');
      if(stage==='abort-cleanup'&&resource!=='body')assert(requestAbort>=0&&settled>requestAbort,label+': settle after native abort but before cleanup suspension');
      if(stage==='outer-abort'){assert(events.findIndex(item=>item.event==='abort'&&item.id===1)<settled,label+': feed deadline precedes robots response');assert.equal(requestAbort,-1,label+': independent robots signal remains live');}
      if(resource!=='body'&&stage!=='outer-abort')assert(!events.some(item=>item.event==='body-read'&&item.url===url),label+': expired response body must not be consumed');
      if(resource==='body'){assert(events.findIndex(item=>item.event==='body-return'&&item.url===url)>requestAbort,label+': body completes only after abort');if(stage==='after-snapshot')assert(at('release')>at('snapshot-written'),label+': late body cannot revise published evidence');}
      const restriction=[401,403,429].includes(outcome);
      assert.equal(details.lateRestrictionReceipts.length,restriction?1:0,label+': actual late denial only');
      if(restriction){const receipt=details.lateRestrictionReceipts[0];assert.equal(receipt.status,outcome);assert.equal(receipt.url,url);assert.equal(receipt.suspensionId,unresolved?details.pendingTransportReviews[0].id:null);}
    }});
    console.log(label+' passed');
  }
  for(const patch of [{status:503},{throw:true},{stallFetch:true},{throwBody:true},{stallBody:true}])await run('cached robots failure across same-host feeds',{network:{[robot]:patch},records:[record(),record('venue',tail)],prior:snapshot([old(),old({feedUrl:tail,postUrl:'https://fixture.example/old-tail'})]),failed:2,retained:2,posts:2,check:(_,t)=>assert.equal(t.length,1)});
  await run('body deadline releases same-host queue',{network:{[robot]:policy,[feed]:{stallBody:true},[tail]:{body:rss(entry('Tail brunch','https://fixture.example/tail-post'))}},records:[record(),record('venue',tail)],failed:1,retained:1,posts:2,check:p=>assert.equal(p.feedsChecked,1)});
  await run('different feeds fail atomically',{network:{[robot]:policy,[feed]:{body:rss(entry())},[tail]:{status:500}},records:[record(),record('venue',tail)],prior:snapshot([old(),old({feedUrl:tail,postUrl:'https://fixture.example/old-tail'})]),failed:1,retained:1,posts:2,check:p=>{assert.ok(p.posts.some(x=>x.postUrl.endsWith('old-tail')));assert.ok(!p.posts.some(x=>x.postUrl.endsWith('/old')));}});
  for(const env of [{FEED_PULL_LIMIT:'0'},{FEED_PULL_LIMIT:'1'}])await run('pre-limit eligible history',{network:env.FEED_PULL_LIMIT==='0'?{}:routes(),records:[record(),record('venue',tail)],prior:snapshot([old(),old({feedUrl:tail,postUrl:'https://fixture.example/old-tail'})]),env,retained:env.FEED_PULL_LIMIT==='0'?2:1,posts:2,check:p=>assert.equal(p.retainedUnattempted,env.FEED_PULL_LIMIT==='0'?2:1)});
  for(const [name,records,exclusions] of [
    ['missing',[],[]],['reassigned',[record('new-venue')],[]],['shared',[record(),record('other')],[]],['excluded',[record()],[{reviewState:'reviewed_exclusion',feedUrls:[feed]}]],['oembed',[record('venue',feed,{type:'oembed'})],[]],['not verified',[record('venue',feed,{reviewState:'needs-review'})],[]],['quarantined',[record('venue','https://glitterbeancafe.com./feed')],[]],['explicit unsafe duplicate',[record(),record('venue',feed,{identityValidated:false})],[]],['explicit quarantine review duplicate',[record(),record('venue',feed,{reviewState:'quarantined'})],[]],['explicit excluded review duplicate',[record(),record('venue',feed,{reviewState:'reviewed_exclusion'})],[]],
    ...['quarantined','identityValidated','locationValidated','locationSpecific','sharedBrandProfile'].map(flag=>[flag,[record('venue',feed,{[flag]:['quarantined','sharedBrandProfile'].includes(flag)})],[]]),
    ['unsafe parent',[{...record(),website:'https://glitterbeancafe.com./'}],[]],['quarantined parent review',[{...record(),reviewState:'quarantined'}],[]],['excluded parent review',[{...record(),reviewState:'reviewed_exclusion'}],[]],['rejected parent review',[{...record(),reviewState:'rejected'}],[]],...['quarantined','reviewed_exclusion','rejected'].map(state=>['conflicting parent '+state,[record(),{...record(),reviewState:state}],[]])
  ])await run('association '+name,{network:{},records,exclusions,env:{FEED_PULL_LIMIT:'0'},posts:0});
  for(const state of ['quarantined','reviewed_exclusion','rejected'])for(const duplicate of [false,true])await run('denied parent blocks successful collection '+state,{network:{},records:[...(duplicate?[record()]:[]),{...record(),reviewState:state}],posts:0});
  for(const scope of ['parent','feed'])await run('truthy quarantine '+scope,{network:{},records:[scope==='parent'?{...record(),quarantined:'manual_review'}:record('venue',feed,{quarantined:'manual_review'})],posts:0});
  await run('quarantined prior review not resurrected',{prior:snapshot([old({reviewState:'quarantined'})]),abort:true});
  for(const patch of [{reviewState:'reviewed_exclusion'},{reviewState:'approved'},{quarantined:true},{quarantined:'manual_review'},{identityValidated:false},{locationValidated:false},{locationSpecific:false},{sharedBrandProfile:true}])await run('prior denial cannot reopen on successful same-key refresh',{network:{[robot]:policy,[feed]:{body:rss(entry('Fresh patio','https://fixture.example/old'))}},prior:snapshot([old(patch)]),abort:true});
  await run('feed cannot override restaurant identity',{records:[record('venue',feed,{restaurantId:'wrong'})],check:p=>assert.equal(p.posts[0].restaurantId,'venue')});
  await run('feed alias cannot change failed retention key',{records:[record('venue',feed,{feedUrl:tail})],network:{[robot]:policy,[feed]:{status:500}},failed:1,retained:1});
  await run('feed alias cannot bypass duplicate exclusion',{records:[record('venue',feed,{feedUrl:tail}),record('venue',feed,{reviewState:'reviewed_exclusion'})],network:{},posts:0});
  await run('feed alias cannot retain unrelated history',{records:[record('venue',feed,{feedUrl:tail})],prior:snapshot([old({feedUrl:tail})]),network:{[robot]:policy,[feed]:{status:500}},failed:1,posts:0});
  await run('feed alias cannot change successful completion key',{records:[record('venue',feed,{feedUrl:tail})],network:{[robot]:policy,[feed]:{body:rss('')}},posts:0});
  await run('duplicate association fetch once',{records:[record(),record()],check:p=>assert.equal(p.feedsChecked,1)});
  const stale=old({publishedAt:'2020-01-01T00:00:00Z'}),undated=old({postUrl:'https://fixture.example/undated',publishedAt:null}),future=old({postUrl:'https://fixture.example/future',publishedAt:'2027-01-01T00:00:00Z'});
  await run('bounded old/unknown/future history',{network:{},prior:snapshot([stale,undated,future]),env:{FEED_PULL_LIMIT:'0'},retained:1,posts:1,check:p=>{assert.deepEqual(p.posts,[undated]);assert.equal(p.historyOutsideRetentionBounds,2);}});
  // Fresh non-signal wins; do not dedupe signals independently and resurrect the
  // retained signal from a second, failed feed with the same restaurant/post URL.
  await run('post/signal winner consistency',{network:{[robot]:policy,[feed]:{body:rss(entry('Plain news','https://fixture.example/old').replace('Short patio summary','Plain summary'))},[tail]:{status:500}},records:[record(),record('venue',tail)],prior:snapshot([old({feedUrl:tail})]),failed:1,retained:0,posts:1,check:p=>assert.deepEqual(p.signals,[])});
  await run('80-item bound',{network:{[robot]:policy,[feed]:{body:rss(Array.from({length:85},(_,i)=>entry('News '+i,'https://fixture.example/'+i)).join(''))}},posts:80});
  const first=await run('retention run one',{network:{[robot]:{status:503}},failed:1,retained:1});
  const second=await run('retention run two',{network:{[robot]:{status:503}},prior:first,failed:1,retained:1,time:'2026-10-24T10:00:00.000Z'});
  assert.deepEqual(second.posts,first.posts);assert.notEqual(second.generatedAt,first.generatedAt);assert.notEqual(second.failures[0].attemptedAt,first.failures[0].attemptedAt);
  for(const bad of ['{broken','{}','{"posts":null,"signals":[]}',JSON.stringify(snapshot([old({excerpt:'x'.repeat(701)})])),JSON.stringify(snapshot([old({observedAt:'bad'})])),JSON.stringify(snapshot([old({observedAt:null})])),JSON.stringify(snapshot([old({observedAt:undefined})])),JSON.stringify(snapshot([old({content:'unbounded'})])),JSON.stringify(snapshot([old(),old()])),JSON.stringify({...snapshot([old()]),signals:[]}),JSON.stringify(snapshot([old({signalMatches:{patio:'patio'}})]))])await run('malformed prior refuses overwrite',{badJson:bad,abort:true});
  for(const badJs of ['not an assignment',js(snapshot([])),null])await run('bad/missing script twin',{badJs,abort:true});
  await run('missing JSON twin',{badJson:null,abort:true});
  for(const sourceText of ['{}','{"records":null}','{"records":[null]}','{"records":[{"restaurantId":"venue","feeds":{}}]}'])await run('malformed source associations',{sourceText,abort:true});
  for(const overrideText of ['{}','{"records":[{"reviewState":"reviewed_exclusion"}]}'])await run('malformed exclusions',{overrideText,abort:true});
  for(const [key,value] of [['FEED_PULL_LIMIT','-1'],['FEED_PULL_LIMIT','NaN'],['FEED_PULL_CONCURRENCY','NaN'],['FEED_PULL_TIMEOUT_MS','0'],['FEED_LOOKBACK_DAYS','Infinity'],['FEED_PULL_DELAY_MS','-1']])await run('invalid bound '+key,{env:{[key]:value},abort:true});
  // Conservative parser rejects structural corruption independently of whether
  // the first 80 extractable items looked valid.
  assert.throws(()=>feedEntryBlocks(rss(entry()).replace('</rss>','')));
} catch(error) {
  fixtureFailed=true;
  const files={};
  for(const file of ['config.json','trace.json','events.jsonl','data/build/first-party-sources.json','data/feed-review-overrides.json','data/build/website-feed-signals.json','data/website-feed-signals.js'])files[file]=await readFile(join(root,file),'utf8').catch(()=>null);
  const failure={version:1,fixtureRoot:root,selectedCase:activeCase,assertion:{name:error.name,message:error.message,stack:error.stack},files};
  const serialized=JSON.stringify(failure),sha256=createHash('sha256').update(serialized).digest('hex');
  await writeFile(join(root,'fixture-failure.json'),serialized+'\n',{flag:'wx'});
  // Persist the exact per-case context in existing job logs as well as the
  // retained temp directory. This needs no new artifact workflow or storage.
  const encoded=Buffer.from(serialized).toString('base64'),total=Math.ceil(encoded.length/8192);
  for(let index=0;index<total;index++)console.error('HALIFAX_FEED_FIXTURE_FAILURE_CHUNK '+JSON.stringify({version:1,sha256,index,total,encoding:'base64',data:encoded.slice(index*8192,(index+1)*8192)}));
  console.error('First-party feed fixture failure retained at '+join(root,'fixture-failure.json'));
  throw error;
} finally {if(!fixtureFailed)await rm(root,{recursive:true,force:true});}
console.log(`First-party feed safety passed: ${passed} actual-entrypoint offline cases; atomic failure/unattempted retention, original clocks/rights, strict prior parity, robots/per-hop deadlines and finite mocked transport.`);
