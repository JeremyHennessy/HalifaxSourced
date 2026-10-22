import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { feedEntryBlocks, validatePreviousFeedSnapshot } from './lib/first-party-feed-safety.mjs';
// A real denial or unresolved native request is an intentional nonpublishable
// subprocess result, not a failed fixture. Derive this from the finite plan,
// then independently require its diagnostic rather than accepting any exit1.
function assertAccessExit(result, specs, label, startupExit = 0) {
  const restrictions = specs.filter(spec => [401,403,429].includes(spec?.status));
  const unsettled = specs.some(spec => spec?.stallFetch || spec?.stallsFetch || spec?.lateFetch || spec?.delayFetch);
  const expected = startupExit || (restrictions.length || unsettled ? 1 : 0);
  assert.equal(result.error,undefined,label + ': child must finish within its existing bound');
  assert.equal(result.signal,null,label + ': child must not be killed');
  assert.equal(result.status,expected,label + '\n' + result.stderr);
  const diagnostics = result.stderr.split('\n').filter(line => line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line => JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
  for (const spec of restrictions) assert(diagnostics.some(item => ['http_restriction','late_http_restriction'].includes(item.kind) && item.evidence.receipt.status === spec.status),label + ': actual denial diagnostic');
  if (unsettled) assert(diagnostics.some(item => item.kind === 'unsettled_transport'),label + ': unresolved request diagnostic');
  assert(diagnostics.every(item => item.disposition === 'nonpublishable_requires_review' && (item.kind === 'unsettled_transport' ? unsettled : restrictions.some(spec => item.evidence.receipt?.status === spec.status))),label + ': no unexpected access diagnostic');
}


const clock = '2026-10-23T10:00:00.000Z';
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
let passed=0;
try {
  await mkdir(join(root,'scripts/lib'),{recursive:true}); await mkdir(join(root,'data/build'),{recursive:true});
  for(const file of ['scripts/import-first-party-feed-signals.mjs','scripts/lib/first-party-feed-safety.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/robots-policy.mjs','scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json','scripts/lib/deny-source-network.mjs','source-integrity.js']) await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  await writeFile(join(root,'runner.mjs'),`
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url)));
const RealDate=Date; globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[config.clock]));} static now(){return RealDate.parse(config.clock);} };
const trace=[], unexpected=[], counts=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
globalThis.fetch=async(input,options={})=>{
 const url=String(input);const item=config.routes[url]; const count=(counts.get(url)||0)+1;counts.set(url,count);
 trace.push({url,headers:Object.fromEntries(new Headers(options.headers)),redirect:options.redirect,aborted:options.signal?.aborted,signal:options.signal instanceof AbortSignal});
 if(!item || count>(item.max||1) || trace.length>300){unexpected.push(url);throw new Error('Unexpected fixture URL: '+url);}
 if(item.throw)throw new TypeError('synthetic network failure');
 if(item.delayFetch)await sleep(item.delayFetch);
 if(item.stallFetch)return new Promise(()=>{});
 const response=new Response([204,304].includes(item.status)?null:(item.body??''),{status:item.status||200,headers:{...(item.type===null?{}:{'content-type':item.type||'application/rss+xml'}),...(item.location?{location:item.location}:{}),...(item.length?{'content-length':String(item.length)}:{})}});
 Object.defineProperty(response,'url',{value:url});
 if(item.throwBody)response.text=async()=>{throw new Error('synthetic body failure');};
 if(item.stallBody)response.text=()=>new Promise(()=>{});
 if(item.delayBody)response.text=async()=>{await sleep(item.delayBody);return item.body||'';};
 return response;
};
let failure=null;try {await import('./scripts/import-first-party-feed-signals.mjs');}catch(error){failure=error.message;}
if(config.settleMs)await sleep(config.settleMs);
await writeFile(new URL('./trace.json',import.meta.url),JSON.stringify({trace,unexpected,failure}));
assert.deepEqual(unexpected,[],'unexpected transport remains fatal even if caught by importer');
if(failure){console.error(failure);process.exitCode=1;}
`);
  async function run(name,{network=routes(),records=[record()],prior=snapshot([old()]),exclusions=[],env={},failed=0,retained=0,posts=1,check,abort=false,badJson,badJs,sourceText,overrideText,settleMs=0,time=clock}={}) {
    const jsonPath=join(root,'data/build/website-feed-signals.json'),jsPath=join(root,'data/website-feed-signals.js');
    await rm(jsonPath,{force:true}); await rm(jsPath,{force:true});
    if(prior!==null){await writeFile(jsonPath,badJson??JSON.stringify(prior));await writeFile(jsPath,badJs??js(prior));}
    if(badJson===null)await rm(jsonPath,{force:true}); if(badJs===null)await rm(jsPath,{force:true});
    const beforeJson=await readFile(jsonPath,'utf8').catch(()=>null),beforeJs=await readFile(jsPath,'utf8').catch(()=>null);
    await writeFile(join(root,'data/build/first-party-sources.json'),sourceText??JSON.stringify({records}));
    await writeFile(join(root,'data/feed-review-overrides.json'),overrideText??JSON.stringify({records:exclusions}));
    await writeFile(join(root,'config.json'),JSON.stringify({routes:network,clock:time,settleMs}));
    await rm(join(root,'trace.json'),{force:true});
    const result=spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'runner.mjs')],{cwd:root,encoding:'utf8',timeout:5000,env:{...process.env,FEED_PULL_TIMEOUT_MS:'50',FEED_PULL_DELAY_MS:'0',FEED_PULL_LIMIT:'120',FEED_PULL_CONCURRENCY:'2',FEED_LOOKBACK_DAYS:'180',FEED_EXCERPT_CHARS:'420',...env}});
    assert.equal(result.error,undefined,`${name}: process failed/timed out`);
    const trace=JSON.parse(await readFile(join(root,'trace.json'),'utf8').catch(error=>{throw new Error(name+': '+result.stderr+' '+result.stdout+' '+error.message);}));
    assert.deepEqual(trace.unexpected,[],`${name}: unexpected requests`);
    if(abort){assert.notEqual(result.status,0,name);assert.ok(trace.failure,name);assert.deepEqual(trace.trace,[],`${name}: validate before network`);assert.equal(await readFile(jsonPath,'utf8').catch(()=>null),beforeJson,name);assert.equal(await readFile(jsPath,'utf8').catch(()=>null),beforeJs,name);passed++;return;}
    assertAccessExit(result,trace.trace.map(call=>network[call.url]),name);
    const payload=JSON.parse(await readFile(jsonPath,'utf8'));
    const script=await readFile(jsPath,'utf8');assert.deepEqual(JSON.parse(script.replace(/^window\.HALIFAX_WEBSITE_FEED_SIGNALS = /,'').replace(/;\n$/,'')),payload,`${name}: parity`);
    validatePreviousFeedSnapshot(payload);
    assert.equal(payload.failedFeeds,failed,`${name}: failures`);assert.equal(payload.retainedPosts,retained,`${name}: retained`);assert.equal(payload.posts.length,posts,`${name}: posts`);
    for(const call of trace.trace){assert.equal(call.redirect,'manual',name);assert.equal(call.signal,true,name);assert.equal(call.aborted,false,`${name}: no aborted request admitted`);if(new URL(call.url).pathname.startsWith('/robots'))assert.deepEqual(call.headers,{'user-agent':'HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)'},`${name}: policy headers`);}
    if(retained===1 && posts===1 && prior.posts.length===1)assert.deepEqual(payload.posts,prior.posts,`${name}: original clocks/review/rights/source preserved`);
    if(check)check(payload,trace.trace);passed++;return payload;
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
  // Observe beyond the deadline: ignored aborts must not admit a later redirect
  // or content request, nor append a late parsed item to a committed snapshot.
  for(const [url,patch] of [[robot,{delayFetch:100,body:'User-agent: *\nDisallow:',type:'text/plain'}],[robot,{delayFetch:100,status:302,location:'/robots-late'}],[feed,{delayFetch:100,status:302,location:'/late'}],[feed,{delayBody:100,body:rss(entry())}]])await run('late result cannot mutate/admit',{network:{...routes(),[url]:patch},failed:1,retained:1,settleMs:150});
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
} finally {await rm(root,{recursive:true,force:true});}
console.log(`First-party feed safety passed: ${passed} actual-entrypoint offline cases; atomic failure/unattempted retention, original clocks/rights, strict prior parity, robots/per-hop deadlines and finite mocked transport.`);
