import assert from 'node:assert/strict';
import {fetchPublicSource,fetchGuardedSource} from './lib/fetch-public-source.mjs';
import {sourceAccessState} from './lib/source-access-state.mjs';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
if(!process.env.PUBLIC_FETCH_FIXTURE_CHILD){
  const root=await mkdtemp(join(tmpdir(),'halifax-public-fetch-'));
  try {
    for(const file of ['scripts/test-public-source-fetch.mjs','scripts/lib/fetch-public-source.mjs','scripts/lib/source-access-state.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/deny-source-network.mjs','source-integrity.js','data/source-link-access-holds.json']){await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(new URL('../'+file,import.meta.url),join(root,file));}
    const result=spawnSync(process.execPath,[join(root,'scripts/test-public-source-fetch.mjs')],{cwd:root,env:{...process.env,PUBLIC_FETCH_FIXTURE_CHILD:'1',NODE_OPTIONS:'--import '+join(root,'scripts/lib/deny-source-network.mjs')},encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);process.stdout.write(result.stdout);
  } finally {await rm(root,{recursive:true,force:true});}
} else {
const original=globalThis.fetch,originalExit=process.exitCode,requests=[],robots=[];
try {
  globalThis.fetch=async (url,options)=>{requests.push(url);assert.equal(options.redirect,'manual');return new Response(null,{status:301,headers:{location:'https://justitalymentone.com/'}});};
  await assert.rejects(fetchPublicSource('https://local.example/contact',{},async url=>{robots.push(url);return true;}),/quarantined/);
  assert.deepEqual(requests,['https://local.example/contact']);
  requests.length=0;
  await assert.rejects(fetchPublicSource('https://bowtiecreamery.com/',{},async()=>true),/quarantined/);
  assert.equal(requests.length,0);
  globalThis.fetch=async url=>{requests.push(url);return requests.length===1?new Response(null,{status:301,headers:{location:'/contact/'}}):new Response('safe');};
  assert.equal((await fetchPublicSource('https://local.example/contact',{},async()=>true)).status,200);
  requests.length=0;
  await assert.rejects(fetchPublicSource('https://local.example/private',{},async()=>false),/robots_disallow/);
  assert.equal(requests.length,0);
  const controller = new AbortController();
  controller.abort(new DOMException('Already expired', 'TimeoutError'));
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:controller.signal},async()=>true),/Already expired/);
  assert.equal(requests.length,0,'Aborted request never reaches transport');
  const waitingPolicy = new AbortController();
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:waitingPolicy.signal},async()=>{waitingPolicy.abort(new Error('expired policy'));return true;}),/expired policy/);
  assert.equal(requests.length,0,'Policy approval cannot revive an expired operation');
  const waitingFetch = new AbortController();
  globalThis.fetch=async url=>{requests.push(url);waitingFetch.abort(new Error('expired fetch'));return new Response(null,{status:302,headers:{location:'/late'}});};
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:waitingFetch.signal},async()=>true),/expired fetch/);
  assert.deepEqual(requests,['https://local.example/'],'An abort-ignoring response cannot admit another hop');
  requests.length=0;
  const events=[];
  globalThis.fetch=async url=>{requests.push(url);return requests.length===1?new Response(null,{status:302,headers:{location:'/next'}}):new Response(null,{status:429});};
  const observer={beforeRequest:url=>events.push(['request',url]),afterResponse:(url,response)=>events.push(['response',url,response.status])};
  assert.equal((await fetchPublicSource('https://local.example/',{},async()=>true,observer)).status,429);
  assert.deepEqual(events,[['request','https://local.example/'],['response','https://local.example/',302],['request','https://local.example/next'],['response','https://local.example/next',429]]);
  const late=new AbortController();events.length=0;
  globalThis.fetch=async()=>{late.abort(new Error('late response'));return new Response(null,{status:429});};
  await assert.rejects(fetchPublicSource('https://late-other.example/',{signal:late.signal},async()=>true,observer),/late response/);
  assert.deepEqual(events,[['request','https://late-other.example/']],'Abort-ignoring response cannot revive the ordinary observation callback');
  assert(sourceAccessState().access.find('https://www.late-other.example/path'),'A late actual429 still latches a host restriction');

  requests.length=0;robots.length=0;
  globalThis.fetch=async url=>{requests.push(String(url));return new Response('safe');};
  for(const url of ['https://www.instagram.com/never-request','https://cantongardenns.com/robots.txt']) await assert.rejects(fetchPublicSource(url,{},async u=>{robots.push(u);return true;}),error=>error.code==='SOURCE_ACCESS_HOLD'&&error.attempted===false);
  const exact=sourceAccessState().policy.observations.find(row=>row.status===403).url;
  await assert.rejects(fetchPublicSource(exact,{},async u=>{robots.push(u);return true;}),/source_access_hold/);
  assert.equal(requests.length,0);assert.equal(robots.length,0,'Known target hold short-circuits unnecessary robots requests');
  const sibling=new URL('/unrestricted-fixture-sibling',exact).href;
  assert.equal((await fetchPublicSource(sibling,{},async()=>true)).status,200,'Exact403 does not suppress another resource on that host');
  requests.length=0;
  await fetchPublicSource('https://recursive-robots.example/page',{},async url=>{await fetchGuardedSource(new URL('/robots.txt',url));return true;});
  assert.deepEqual(requests,['https://recursive-robots.example/robots.txt','https://recursive-robots.example/page'],'Header lock cannot deadlock recursive robots lookup');
  requests.length=0;
  globalThis.fetch=async url=>{requests.push(String(url));return new Response(null,{status:429});};
  const pair=await Promise.allSettled([fetchGuardedSource('https://queued-shared.example/first'),fetchGuardedSource('https://www.queued-shared.example/second')]);
  assert.equal(pair[0].status,'fulfilled');assert.equal(pair[1].reason.code,'SOURCE_ACCESS_HOLD');assert.deepEqual(requests,['https://queued-shared.example/first']);
  const count=sourceAccessState().pendingTransportReviews.length, normal=new AbortController();
  globalThis.fetch=async(_url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  const pending=fetchGuardedSource('https://normal-native-abort.example/',{signal:normal.signal});setTimeout(()=>normal.abort(new DOMException('normal abort','TimeoutError')),5);
  await assert.rejects(pending,/normal abort/);await sourceAccessState().drainDecisions();
  assert.equal(sourceAccessState().pendingTransportReviews.length,count,'Prompt native abort settlement is not durable unknown evidence');
  assert.equal(process.exitCode,1,'Normal timeout must not clear an earlier process failure');
} finally {globalThis.fetch=original;process.exitCode=originalExit;}

console.log('Public fetch regression passed: mandatory policy before robots and every hop, recursive robots without deadlock, canonical queue stop, late restrictions and normal abort settlement.');
}
