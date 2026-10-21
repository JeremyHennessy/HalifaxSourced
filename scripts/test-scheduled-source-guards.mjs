import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'halifax-scheduled-guard-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/check-source-links.mjs','scripts/build-thumbnail-candidates.mjs','scripts/lib/fetch-public-source.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/media-rights-contract.mjs','scripts/lib/reviewed-corrections.mjs','restaurant-corrections.js','app-media.js','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[{restaurantId:"redirect",menuUrl:"https://fixture.example/reviewed-menu"}]};');
  const venues=[{id:'unsafe',name:'Unsafe venue',website:'https://www.glitterbeancafe.com/contact'},{id:'unsafe-dot',name:'Unsafe dotted venue',website:'https://glitterbeancafe.com./contact'},{id:'redirect',name:'Redirect venue',website:'https://fixture.example/contact'}];
  for(const [name,payload] of [['catalog',{restaurants:venues}],['first-party-sources',{records:[]}],['structured-place-facts',{records:[]}],['city-events',{events:[]}]])await writeFile(join(root,'data','build',name+'.json'),JSON.stringify(payload));
  const requests=[];
  for(const script of ['check-source-links.mjs','build-thumbnail-candidates.mjs']) {
    const log=join(root,script+'.requests.json');
    await writeFile(join(root,'runner.mjs'),`import {writeFile} from 'node:fs/promises';const requests=[];globalThis.fetch=async(input,options)=>{const url=String(input);requests.push(url);if(!url.startsWith('https://fixture.example/'))throw new Error('network-disabled:'+url);return new Response(null,{status:302,headers:{location:'https://bowtiecreamery.com/'}});};try{await import(${JSON.stringify(pathToFileURL(join(root,'scripts',script)).href)});}finally{await writeFile(${JSON.stringify(log)},JSON.stringify(requests));}`);
    const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'runner.mjs')],{cwd:root,env:{...process.env,LINK_HEALTH_LIMIT:'20',LINK_HEALTH_CONCURRENCY:'1',THUMBNAIL_DISCOVERY_FETCH:'1',THUMBNAIL_IMAGE_PROBE:'0',THUMBNAIL_DISCOVERY_PAGE_LIMIT:'10',THUMBNAIL_DISCOVERY_DELAY_MS:'0'},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));});
    assert.equal(result.code,0,script+': '+result.error);
    const fetched=JSON.parse(await readFile(log,'utf8'));requests.push(...fetched);
    assert(fetched.length>0,script+' must exercise a permitted source before a blocked redirect');
    assert(fetched.every(url=>url.startsWith('https://fixture.example/')),script+' fetched a quarantined source/destination: '+JSON.stringify(fetched));
    if(script==='check-source-links.mjs') assert(fetched.includes('https://fixture.example/reviewed-menu'),'Reviewed menu must exercise the same quarantine/redirect guard');
  }
  // Reproduce Node exit 13 with unreferenced/hung fetch or body promises.
  // The real collector must finish every attempted URL as inconclusive and
  // release a domain's queue for its next URL, never manufacture a success.
  const deadlineVenues = ['fetch', 'read', 'cancel', 'ok'].map(kind => ({id:kind,name:kind,website:`https://${kind}.fixture.example/`}));
  deadlineVenues.push({id:'tail',name:'Same-domain tail',website:'https://read.fixture.example/healthy'});
  await writeFile(join(root,'data/build/catalog.json'),JSON.stringify({restaurants:deadlineVenues}));
  await writeFile(join(root,'deadline-runner.mjs'),`globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/healthy')||url.includes('ok.fixture'))return new Response('<html>Open normally.</html>',{headers:{'content-type':'text/html'}});
    if(url.includes('fetch.fixture'))return new Promise(()=>{});
    if(url.includes('read.fixture'))return {ok:true,status:200,url,headers:new Headers({'content-type':'text/html'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{}})}};
    if(url.includes('cancel.fixture'))return {ok:true,status:200,url,headers:new Headers({'content-type':'application/pdf'}),body:{cancel:()=>new Promise(()=>{})}};
    throw new Error('network-disabled:'+url);
  };await import(${JSON.stringify(pathToFileURL(join(root,'scripts/check-source-links.mjs')).href)});`);
  const deadlineResult=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(root,'deadline-runner.mjs')],{cwd:root,env:{...process.env,GITHUB_EVENT_NAME:'schedule',LINK_HEALTH_SCOPE:'release',LINK_HEALTH_LIMIT:'0',LINK_HEALTH_TIMEOUT_MS:'30',LINK_HEALTH_CONCURRENCY:'5'},stdio:['ignore','pipe','pipe']});
    let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));
  });
  assert.equal(deadlineResult.code,0,'Hung source must be classified, not exit 13: '+deadlineResult.error);
  const deadlineReport=JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json')));
  assert.equal(deadlineReport.complete,true);
  assert.equal(deadlineReport.counts.checked,5);
  assert.equal(deadlineReport.counts.transient,3);
  assert.equal(deadlineReport.counts.ok,2);
  assert.equal(deadlineReport.counts.broken,0);
  for(const result of deadlineReport.results.filter(item=>item.state==='transient'))assert.equal(result.error,'timeout');
  console.log('Collector deadline regression passed: hung fetch/read/cancel become explicit timeouts; same-domain tail completes.');
  // The preview coordinator is an API-only reader, not a catalogue URL fetcher.
  // An attacker-controlled API-root environment variable and redirect response
  // must never move its existing token off the fixed GitHub API origin.
  const apiLog=join(root,'coordinator-api-requests.json');
  await writeFile(join(root,'api-runner.mjs'),`import {writeFile} from 'node:fs/promises';const requests=[];globalThis.fetch=async(input,options)=>{requests.push({url:String(input),method:options.method,redirect:options.redirect});return new Response(null,{status:302,headers:{location:'https://untrusted.example/steal-token'}});};process.on('beforeExit',()=>{});await import(${JSON.stringify(new URL('coordinate-preview-updates.mjs',import.meta.url).href)});await new Promise(resolve=>setImmediate(resolve));await writeFile(${JSON.stringify(apiLog)},JSON.stringify(requests));`);
  const apiResult=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'api-runner.mjs')],{cwd:root,env:{...process.env,GITHUB_REPOSITORY:'JeremyHennessy/HalifaxSourced',GH_TOKEN:'fixture-not-a-secret',GITHUB_API_URL:'https://untrusted.example',REQUESTED_RUN_ID:'',REQUESTED_ARTIFACT:'',GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:'',PLAN_PATH:''},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));});
  assert.equal(apiResult.code,1,'Redirect API response must stop reconciliation');
  const apiRequests=JSON.parse(await readFile(apiLog,'utf8'));
  assert.deepEqual(apiRequests,[{url:'https://api.github.com/repos/JeremyHennessy/HalifaxSourced/git/ref/heads/main',method:'GET',redirect:'error'}]);
  console.log('Coordinator API boundary passed: fixed origin, GET only, no redirects.');
  // Catalogue-source consumers must keep the shared wrapper; API-only imports
  // use fixed endpoints and are outside this source-URL test.
  for(const name of await readdir(new URL('./',import.meta.url))) {
    if(!name.endsWith('.mjs')||name.startsWith('test-')||['import-meta-social.mjs','import-google-places.mjs','import-ns-food-inspections.mjs','import-osm-restaurants.mjs'].includes(name))continue;
    const source=await readFile(new URL(name,import.meta.url),'utf8');
    if(name==='coordinate-preview-updates.mjs'){assert(source.includes("const apiRoot = 'https://api.github.com';"));assert(source.includes("method: 'GET', redirect: 'error'"));assert(!source.includes('process.env.GITHUB_API_URL'));assert(source.includes('AbortSignal.timeout(30_000)'));continue;}
    if(/\bfetch\(/.test(source))assert(source.includes('import { fetchGuardedSource as fetch }'),name+' has an unguarded source request');
  }
  // PR link QA checks status only; main/manual/scheduled retain lifecycle extraction.
  await writeFile(join(root,'data/build/catalog.json'),JSON.stringify({restaurants:[{id:'qa-fixture',name:'Fixture',website:'https://fixture.example/'}]}));
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  await writeFile(join(root,'event-runner.mjs'),`globalThis.fetch=async()=>new Response('<html>We are permanently closed.</html>',{headers:{'content-type':'text/html'}});await import(${JSON.stringify(pathToFileURL(join(root,'scripts/check-source-links.mjs')).href)});`);
  const {spawnSync:eventSpawn}=await import('node:child_process');
  for(const event of ['pull_request','push','workflow_dispatch','schedule']) {
    const result=eventSpawn(process.execPath,[join(root,'event-runner.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:event,LINK_HEALTH_SCOPE:'release',LINK_HEALTH_REUSE_RECENT:'0'}});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json'),'utf8'));
    assert.equal(report.counts.ok,1,'Status QA remains enabled');
    assert.equal(report.lifecycleExtraction,event!=='pull_request');
    assert.equal(report.lifecycleCandidates.length>0,event!=='pull_request','PR event must not extract lifecycle evidence');
  }
  const cachedPath=join(root,'data/build/source-link-health-report.json');
  const cached=JSON.parse(await readFile(cachedPath,'utf8'));
  cached.sourceCommitSha='fixture-cached-head';
  assert(cached.lifecycleCandidates.length>0);
  await writeFile(cachedPath,JSON.stringify(cached));
  const cachedResult=eventSpawn(process.execPath,[join(root,'event-runner.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',SOURCE_COMMIT_SHA:'fixture-cached-head',LINK_HEALTH_SCOPE:'release',LINK_HEALTH_REUSE_RECENT:'1'}});
  assert.equal(cachedResult.status,0,cachedResult.stderr);
  const cachedPr=JSON.parse(await readFile(cachedPath,'utf8'));
  assert(cachedPr.results.every(row=>row.reusedObservation));
  assert.equal(cachedPr.lifecycleCandidates.length,0,'Cached non-PR lifecycle evidence cannot leak into PR QA');
  console.log('Scheduled source guards passed offline: link checks and thumbnail discovery never request quarantined URLs or redirect destinations.');
} finally {await rm(root,{recursive:true,force:true});}

// PR validation must not execute collectors or upload promotable preview artifacts.
for (const [file, cron] of [
  ['structured-place-facts-preview.yml', '29 11 * * 2'],
  ['structured-specials-preview.yml', '37 11 * * 3']
]) {
  const workflow = await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
  const prJob = workflow.split('  validate-pr:\n')[1]?.split('  refresh:\n')[0];
  const collector = workflow.split('  refresh:\n')[1];
  assert(prJob?.includes("if: ${{ github.event_name == 'pull_request' }}"), file + ' needs a PR-only validator');
  assert(collector?.startsWith("    if: ${{ github.event_name != 'pull_request' }}\n"), file + ' collector must skip PRs');
  assert(prJob.includes('NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs'));
  assert(!/node scripts\/(import-|discover-|verify-official)|upload-artifact/.test(prJob), file + ' PR job cannot collect or produce preview artifacts');
  assert(workflow.includes('workflow_dispatch:') && workflow.includes(`cron: "${cron}"`), file + ' must preserve manual/scheduled collection');
}
console.log('Preview PR boundaries passed: fixture/snapshot validation only; scheduled/manual collection remains separate.');
const { spawnSync } = await import('node:child_process');
const networkGuard = new URL('./lib/deny-source-network.mjs', import.meta.url).pathname;
for (const expression of [
  "await fetch('https://fixture.invalid/')",
  "(await import('node:http')).get('http://fixture.invalid/')",
  "(await import('node:https')).request('https://fixture.invalid/')",
  "(await import('node:net')).connect(443, 'fixture.invalid')"
]) {
  const result = spawnSync(process.execPath, ['--import', networkGuard, '--input-type=module', '-e', `try { ${expression}; } catch {}`], {encoding:'utf8'});
  assert.equal(result.status, 1, 'Swallowed network attempts must still fail offline validation');
  assert.match(result.stderr, /blocked 1 network attempt/);
}
assert.equal(spawnSync(process.execPath,['--import',networkGuard,'-e','console.log("offline")']).status,0);
console.log('Offline validation transport guard passed for fetch, HTTP, HTTPS and sockets.');
