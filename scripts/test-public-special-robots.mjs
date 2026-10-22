import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

// Actual composite entrypoint, unchanged real helpers, finite fake transport only.
// The token below is deliberately synthetic public-client metadata, not a secret.
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic_fixture.not_a_credential';
const ua = 'HalifaxSourced/0.8 (+https://github.com/JeremyHennessy/HalifaxSourced)';
const ids = ['halifax-events-happy-hour', 'discover-halifax-dine-around-2026', 'downtown-dartmouth-food-crawl-spring-2026'];
const page = 'https://halifaxevents.ca/happy-hour';
const bundle = 'https://halifaxevents.ca/assets/fixture.js';
const apiOrigin = 'https://fixtureproject.supabase.co';
const seed = 'https://downtownhalifax.ca/dinearound';
const detail = 'https://discoverhalifaxns.com/dinearound/menu/fixture?menu=40-dinner';
const detail2 = 'https://discoverhalifaxns.com/dinearound/menu/second';
const food = 'https://www.downtowndartmouth.ca/foodcrawl';
const select = 'id,slug,venue_name,special_title,deal_type,deal_details,days_of_week,start_time,end_time,second_start_time,second_end_time,venue_address,neighbourhood,price_from,external_url,image_url,valid_from,valid_until,status,verification_status,last_verified,is_active,is_featured,is_claimable,created_at,updated_at';
const api = `${apiOrigin}/rest/v1/happy_hours?${new URLSearchParams({select, status:'eq.approved', is_active:'eq.true', order:'updated_at.desc', limit:'7'})}`;
const robot = url => `${new URL(url).origin}/robots.txt`;
const policies = [...new Set([page, api, seed, detail, food].map(robot))];
const html = lines => lines.map(line => `<p>${line}</p>`).join('');
const foodHtml = count => html(['Spring Food Crawl', 'May 21, 2026', 'Fixture Venue', '123 Main Street', ...Array.from({length:count}, (_, i) => `$5 Fixture offer ${i}`), 'Downtown Dartmouth Business Commission']);
const menu = '<meta property="og:title" content="Fixture Venue | Dine Around"><meta property="og:image" content="https://images.example/menu.jpg">' + html(['Fixture Venue', '123 Main Street', 'Halifax, Nova Scotia', 'Dine Around 2026', '$40 three course dinner', 'Information']) + '<a href="https://external.example/">Website</a><script>"menu_file":{"url":"https://files.example/menu.pdf"}</script>';
const row = {id:'fixture', slug:'fixture', venue_name:'Fixture Venue', special_title:'Happy hour', days_of_week:[1,2], start_time:'16:00:00', end_time:'18:00:00', price_from:5, image_url:'https://images.example/happy.jpg', status:'approved', is_active:true, updated_at:'2026-01-01T00:00:00Z', last_verified:'2025-12-01T00:00:00Z'};
const prior = ids.flatMap((sourceId, index) => [0,1].map(n => ({sourceId, sourceRecordId:`old-${index}-${n}`, venueName:'Historic venue', observedAt:n ? null : '2020-01-01T00:00:00Z', sourceUpdatedAt:'2019-01-01', lastVerifiedAt:null, validFrom:'2020-02-01', validTo:'2020-02-28', rightsState:'restricted', reviewState:'needs-review', sourceImageUrl:'https://images.example/old.jpg', arbitraryUnknown:{nested:[null,'preserve']}, matchMethod:'conflict', restaurantId:null})));
function baseline() {
  return Object.fromEntries([...policies.map(url => [url,{body:'User-agent: *\nDisallow:', type:'text/plain'}]),
    [page,{body:'<script type="module" src="/assets/fixture.js"></script>'}],
    [bundle,{body:`${apiOrigin} ${token}`, type:'text/javascript'}],
    [api,{body:JSON.stringify([row]), type:'application/json'}],
    [seed,{body:`<a href="${detail}">Menu</a><a href="${detail}">Duplicate</a>`}],
    [detail,{body:menu}], [food,{body:foodHtml(20)}]]);
}
const root = await mkdtemp(join(tmpdir(), 'public-special-robots-'));
let passed = 0;
try {
  await mkdir(join(root,'scripts/lib'), {recursive:true});
  await mkdir(join(root,'data/build'), {recursive:true});
  for (const file of ['scripts/import-public-special-source-leads.mjs','scripts/lib/public-special-refresh-safety.mjs','scripts/lib/robots-policy.mjs','scripts/lib/fetch-public-source.mjs','scripts/lib/deny-source-network.mjs','source-integrity.js']) await copyFile(new URL(`../${file}`,import.meta.url),join(root,file));
  await writeFile(join(root,'data/build/catalog.json'), JSON.stringify({restaurants:[{id:'fixture-venue',name:'Fixture Venue',address:'123 Main Street'}]}));
  await writeFile(join(root,'runner.mjs'), `
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('./config.json',import.meta.url)));
const trace=[]; const unexpected=[]; const counts=new Map();
globalThis.fetch=async (input,options={})=>{
 const url=String(input); const headers=Object.fromEntries(new Headers(options.headers));
 trace.push({url,headers,redirect:options.redirect,signal:options.signal instanceof AbortSignal});
 const item=config.routes[url]; const count=(counts.get(url)||0)+1; counts.set(url,count);
 if(!item || count>(item.max||1) || trace.length>30){unexpected.push(url);throw new Error('unexpected fixture URL');}
 if(item.throw)throw new TypeError('synthetic network failure');
 if(item.stallFetch)return new Promise(()=>{});
 const response=new Response(item.status===204||item.status===304?null:(item.body??''),{status:item.status||200,headers:{'content-type':item.type||'text/html',...(item.location?{location:item.location}:{})}});
 Object.defineProperty(response,'url',{value:url});
 if(item.throwBody)response.text=async()=>{throw new Error('synthetic body failure');};
 if(item.stallBody)response.text=()=>new Promise(()=>{});
 return response;
};
let failure=null;
try { await import('./scripts/import-public-special-source-leads.mjs'); } catch(error) {failure=error.message;}
await writeFile(new URL('./trace.json',import.meta.url),JSON.stringify({trace,unexpected,failure}));
assert.deepEqual(unexpected,[], 'caught unexpected requests are still fatal');
if(failure)process.exitCode=1;
`);
  async function run(name, {routes=baseline(), previous=prior, badPrior, failed=[], absent=[], expectedCounts, check, abort=false}={}) {
    const snapshot = join(root,'data/build/public-special-source-leads.json');
    const jsPath=join(root,'data/public-special-source-leads.js');
    await rm(snapshot,{force:true}); await rm(jsPath,{force:true});
    if(previous!==null || badPrior!==undefined) await writeFile(snapshot,badPrior ?? JSON.stringify({records:previous}));
    if(abort)await writeFile(jsPath,'unchanged output sentinel');
    await writeFile(join(root,'config.json'),JSON.stringify({routes}));
    const result=spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'runner.mjs')],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,PUBLIC_SPECIAL_LEAD_TIMEOUT_MS:'40',PUBLIC_SPECIAL_LEAD_LIMIT:'7',PUBLIC_SPECIAL_CAMPAIGN_LIMIT:'2',PUBLIC_SPECIAL_CAMPAIGN_CRAWL_DELAY_MS:'0'}});
    assert.equal(result.error,undefined,`${name}: child timeout/error`);
    const {trace,unexpected,failure}=JSON.parse(await readFile(join(root,'trace.json'),'utf8'));
    assert.deepEqual(unexpected,[],`${name}: unexpected request`);
    assert.ok(trace.length<=30,`${name}: finite trace`);
    if(abort){assert.notEqual(result.status,0,name);assert.ok(failure,name);assert.deepEqual(trace,[],name);assert.equal(await readFile(snapshot,'utf8'),badPrior,name);assert.equal(await readFile(jsPath,'utf8'),'unchanged output sentinel',name);passed++;return;}
    assert.equal(result.status,0,`${name}: ${result.stderr}`);
    const payload=JSON.parse(await readFile(snapshot,'utf8'));
    const context={window:{}};vm.runInNewContext(await readFile(jsPath,'utf8'),context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS)),payload,`${name}: JSON/JS parity`);
    assert.deepEqual([...new Set(payload.failures.map(f=>f.sourceId))].sort(),failed.map(i=>ids[i]).sort(),`${name}: failed families`);
    for(const call of trace){
      assert.equal(call.redirect,'manual',name);assert.equal(call.signal,true,name);
      if(call.url.includes('/robots'))assert.deepEqual(call.headers,{'user-agent':ua},`${name}: credential-free policy`);
      else if(new URL(call.url).hostname==='fixtureproject.supabase.co')assert.deepEqual(call.headers,{apikey:token,authorization:`Bearer ${token}`,accept:'application/json','user-agent':ua},`${name}: exact API headers`);
      else assert.deepEqual(call.headers,{accept:call.url.includes('/assets/')?'text/javascript,application/javascript':'text/html,application/xhtml+xml','user-agent':ua},`${name}: unchanged HTML/JS headers`);
    }
    for(const index of failed){
      const actual=payload.records.filter(r=>r.sourceId===ids[index]);
      const original=(previous||[]).filter(r=>r.sourceId===ids[index]);
      assert.equal(actual.length,original.length,`${name}: atomic retention`);
      for(const record of actual){const old=original.find(r=>r.sourceRecordId===record.sourceRecordId);const strip=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['refreshState','sourceFailure'].includes(k)));assert.deepEqual(strip(record),strip(old),`${name}: preserve all clocks/rights/unknown fields`);assert.equal(record.refreshState,'retained_after_failure');assert.equal(record.sourceFailure.lastAttemptAt,payload.generatedAt);}
    }
    for(const url of absent)assert.ok(!trace.some(c=>c.url===url),`${name}: forbidden ${url}`);
    const counts = expectedCounts || ids.map((id,index)=>failed.includes(index)?(previous||[]).filter(r=>r.sourceId===id).length:[1,1,20][index]);
    assert.deepEqual(ids.map(id=>payload.records.filter(r=>r.sourceId===id).length),counts,`${name}: unaffected family success`);
    if(check)check(payload,trace);
    passed++;return payload;
  }
  await run('all three real families', {expectedCounts:[1,1,20],check:(p,t)=>{
    assert.equal(t.filter(c=>c.url===robot(page)).length,1);assert.equal(t.filter(c=>c.url===api).length,1);
    for(const index of [0,1]){const r=p.records.find(r=>r.sourceId===ids[index]);assert.equal(r.reviewState,'source_signal');assert.equal(r.rightsState,'requires_rights_review');}
    const c=p.records.find(r=>r.sourceId===ids[1]);assert.equal(c.venueName,'Fixture Venue');assert.equal(c.price,40);assert.equal(c.validFrom,'2026-02-01');assert.equal(c.validTo,'2026-02-28');assert.equal(c.menuPdfUrl,'https://files.example/menu.pdf');
    for(const r of p.records.filter(r=>r.sourceId===ids[2])){assert.equal(r.validFrom,'2026-05-21');assert.equal(r.validTo,'2026-05-21');assert.equal(r.startTime,'17:30');assert.equal(r.endTime,'20:00');assert.equal(r.rightsState,null);}
  }});
  // Exercise the policy at all six reachable content boundaries, including JSON.
  const boundaries=[[page,0],[bundle,0],[api,0],[seed,1],[detail,1],[food,2]];
  for(const [url,index] of boundaries){
    const routes=baseline();routes[robot(url)]={body:`User-agent: *\nDisallow: ${new URL(url).pathname}` ,type:'text/plain'};
    await run(`path deny ${url}`,{routes,failed:[index],absent:[url,...(url===page?[bundle,api]:url===bundle?[api]:[])]});
  }
  for(const [name,policy,allowed] of [
    ['valid',{body:'User-agent: *\nDisallow: /unrelated',type:'text/plain'},true],
    ['empty',{body:'',type:'text/plain'},true],['comment',{body:'# empty',type:'text/plain'},true],
    ['404',{status:404},true],['410',{status:410},true],
    ...[401,403,429,500,503,204,206,304,418].map(status=>[String(status),{status},false]),
    ['network',{throw:true}],['fetch deadline',{stallFetch:true}],['body failure',{throwBody:true}],['body deadline',{stallBody:true}],
    ['HTML',{body:'<html>challenge</html>',type:'text/html'}],['JSON',{body:'{}',type:'application/json'}],
    ['malformed',{body:'unavailable',type:'text/plain'}],['oversized',{body:'#'.repeat(512*1024+1),type:'text/plain'}],
    ['query',{body:'User-agent: *\nDisallow: /rest/v1/happy_hours?select=',type:'text/plain'}],
    ['wildcard',{body:'User-agent: *\nDisallow: /*?*status=eq.approved*',type:'text/plain'}],
    ['anchor',{body:`User-agent: *\nDisallow: ${new URL(api).pathname}${new URL(api).search}$`,type:'text/plain'}],
    ['legacy selected group',{body:'User-agent: NotHalifaxSourced\nDisallow: /rest\nUser-agent: *\nDisallow: /unrelated',type:'text/plain'}],
    ['allow does not reopen',{body:'User-agent: *\nDisallow: /\nAllow: /rest',type:'text/plain'}]
  ]){const routes=baseline();routes[robot(api)]=policy;await run(`API policy ${name}`,{routes,failed:allowed?[]:[0],absent:allowed?[]:[api]});}
  for(const [name,patch] of [['HTTP',{status:503}],['JSON parse',{body:'not JSON',type:'application/json'}],['non-array',{body:'{}',type:'application/json'}]]){const routes=baseline();routes[api]=patch;await run(`API ${name}`,{routes,failed:[0]});}
  for(const [name,target,patch] of [
    ['missing module',page,{body:'<html>no script</html>'}],['invalid bundle',page,{body:'<script type="module" src="javascript:fixture.js"></script>'}],
    ['missing metadata',bundle,{body:'no client'}],['bundle HTTP',bundle,{status:503}],['bundle body',bundle,{throwBody:true}],
    ['seed HTTP',seed,{status:503}],['food HTTP',food,{status:503}],['food section',food,{body:'missing'}],['food partial 19',food,{body:foodHtml(19)}]
  ]){const routes=baseline();routes[target]=patch;await run(name,{routes,failed:[target===seed?1:target===food?2:0]});}
  {const routes=baseline();routes[page]={body:'<script src="/assets/fixture.js"></script>'};await run('fallback script regex',{routes,expectedCounts:[1,1,20]});}
  // Every redirect is checked before transmission, including API auth headers.
  for(const [url,index] of [[page,0],[bundle,0],[api,0],[seed,1],[detail,1],[food,2]]){
    for(const kind of ['allow','deny','cross-host','quarantine','missing','invalid','loop']){
      const routes=baseline();const target=kind==='cross-host'?'https://other.example/blocked':kind==='quarantine'?'https://glitterbeancafe.com./blocked':kind==='invalid'?'http://[':kind==='loop'?url:new URL(url===bundle?'/assets/redirected.js':'/redirected',url).href;
      const original=routes[url];routes[url]={status:302,...(kind==='missing'?{}:{location:target}),...(kind==='loop'?{max:4}:{})};
      if(kind==='allow')routes[target]=original;
      if(kind==='deny')routes[robot(url)]={body:'User-agent: *\nDisallow: /redirected\nDisallow: /assets/redirected',type:'text/plain'};
      await run(`${kind} content redirect ${url}`,{routes,failed:kind==='allow'?[]:[index],absent:['deny','cross-host','quarantine'].includes(kind)?[target]:[],check:(_,trace)=>{assert.equal(trace.filter(c=>c.url===robot(url)).length,1);}});
    }
  }
  for(const kind of ['allow','deny','cross-host','quarantine','missing','invalid','loop']){
    const routes=baseline();const url=robot(api);const target=kind==='cross-host'?'https://other.example/robots.txt':kind==='quarantine'?'https://glitterbeancafe.com./robots.txt':kind==='invalid'?'http://[':kind==='loop'?url:`${apiOrigin}/robots-final`;
    routes[url]={status:302,...(kind==='missing'?{}:{location:target}),...(kind==='loop'?{max:4}:{})};
    if(['allow','deny'].includes(kind))routes[target]={body:`User-agent: *\nDisallow: ${kind==='allow'?'':'/'}`,type:'text/plain'};
    await run(`${kind} API policy redirect`,{routes,failed:kind==='allow'?[]:[0],absent:kind==='allow'?[]:[api,...(['cross-host','quarantine'].includes(kind)?[target]:[])]});
  }
  {const routes=baseline();routes[seed]={body:`<a href="${detail}">1</a><a href="${detail2}">2</a><a href="https://discoverhalifaxns.com/dinearound/menu/never">limited</a>`};routes[detail2]={status:302,location:'/blocked'};routes[robot(detail)]={body:'User-agent: *\nDisallow: /blocked',type:'text/plain'};await run('late campaign failure rolls back partial results',{routes,failed:[1],absent:['https://discoverhalifaxns.com/blocked'],check:(p,t)=>{assert.ok(t.some(c=>c.url===detail));assert.equal(p.failures.filter(f=>f.sourceId===ids[1]).length,1);}});}
  for(const policy of [{status:429},{throw:true},{stallFetch:true},{throwBody:true},{stallBody:true}]){
    const routes=baseline();routes[seed]={body:`<a href="${detail}">1</a><a href="${detail2}">2</a>`};routes[robot(detail)]=policy;
    await run('cached unavailable detail policy',{routes,failed:[1],absent:[detail,detail2],check:(p,t)=>{assert.equal(t.filter(c=>c.url===robot(detail)).length,1);assert.equal(p.failures.filter(f=>f.sourceId===ids[1]).length,2);}});
  }
  {const routes=baseline();routes[api]={body:'[]',type:'application/json'};routes[seed]={body:'no links'};await run('successful empty removes history',{routes,expectedCounts:[0,0,20]});}
  const denyAll=()=>{const routes=baseline();for(const url of policies)routes[url]={status:503};return routes;};
  const first=await run('all sources fail',{routes:denyAll(),failed:[0,1,2],expectedCounts:[2,2,2]});
  const second=await run('repeated failure',{routes:denyAll(),previous:first.records,failed:[0,1,2],expectedCounts:[2,2,2]});
  await run('recovery replaces retained records',{previous:second.records,expectedCounts:[1,1,20],check:p=>assert.ok(p.records.every(r=>!r.refreshState&&!r.sourceFailure))});
  await run('failed without history',{routes:denyAll(),previous:null,failed:[0,1,2],expectedCounts:[0,0,0]});
  await run('ENOENT history success',{previous:null,expectedCounts:[1,1,20]});
  for(const badPrior of ['{','{}','{"records":[{}]}','{"records":{}}'])await run('invalid previous snapshot aborts before request/write',{badPrior,abort:true});
  console.log(`Public-special actual-entrypoint robots fixtures passed: ${passed}; all three families, synthetic API, finite transport, atomic retention.`);
} finally {await rm(root,{recursive:true,force:true});}
