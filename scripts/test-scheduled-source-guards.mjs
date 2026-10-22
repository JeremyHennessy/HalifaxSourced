import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { LANES, planPreviewUpdates } from './lib/preview-coordinator.mjs';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'halifax-scheduled-guard-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/check-source-links.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/link-health-urls.mjs','scripts/lib/link-health-report.mjs','data/source-link-access-holds.json','scripts/build-thumbnail-candidates.mjs','scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/media-rights-contract.mjs','scripts/lib/reviewed-corrections.mjs','restaurant-corrections.js','app-media.js','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
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
  assert.equal(deadlineResult.code,1,'Unresolved native fetch must block publication, not exit13: '+deadlineResult.error);
  assert.match(deadlineResult.error,/HALIFAX_SOURCE_ACCESS_DIAGNOSTIC .*unsettled_transport/);
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
    if(/\bfetch\(/.test(source))assert(source.includes('import { fetchGuardedSource as fetch'),name+' has an unguarded source request');
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
function assertPreviewPrBoundary(workflow, file, cron, collectorName = 'refresh') {
  const prJob = workflow.split('  validate-pr:\n')[1]?.split('  ' + collectorName + ':\n')[0];
  const collector = workflow.split('  ' + collectorName + ':\n')[1];
  assert(prJob?.startsWith("    if: ${{ github.event_name == 'pull_request' }}\n"), file + ' needs a PR-only validator');
  assert(collector?.startsWith("    if: ${{ github.event_name != 'pull_request' }}\n"), file + ' collector must skip PRs');
  assert(prJob.includes('ref: ${{ github.event.pull_request.head.sha }}'), file + ' must validate the exact PR head');
  assert(prJob.includes('NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs'), file + ' must deny source network access');
  assert(!/node scripts\/(import-|discover-|verify-official)|upload-artifact/.test(prJob), file + ' PR job cannot collect or produce preview artifacts');
  assert(workflow.includes('workflow_dispatch:') && workflow.includes(`cron: "${cron}"`), file + ' must preserve manual/scheduled collection');
  return prJob;
}
const sourceValidationCommands = [
  'node --check scripts/import-official-sites.mjs',
  'node --check scripts/verify-official-source-pages.mjs',
  'node --check scripts/import-structured-events.mjs',
  'node --check scripts/lib/robots-policy.mjs',
  'node scripts/test-public-source-fetch.mjs',
  'node scripts/test-first-party-feed-safety.mjs',
  'node scripts/test-robots-policy.mjs',
  'node scripts/test-robots-policy-adapters.mjs',
  'node scripts/test-robots-redirect-guards.mjs',
  'node scripts/test-source-verifier-startup.mjs',
  'node scripts/test-scheduled-source-guards.mjs',
  'node scripts/test-thumbnail-observation-clocks.mjs'
];
// The fixture executes prerequisites and their imports/VM-loaded code, not only
// the thumbnail builder. Data glob coverage includes accepted and fallback inputs;
// it only widens the already guarded, network-denied PR validation lanes.
const thumbnailFixtureDependencies = [
  'index.html',
  'app-events.js',
  'app-event-pagination.js',
  'app-event-date-fixes.js',
  'app-event-local-sort-fixes.js',
  'data/**',
  'scripts/test-thumbnail-observation-clocks.mjs',
  'scripts/build-thumbnail-candidates.mjs',
  'scripts/check-thumbnail-candidates.mjs',
  'scripts/build-thumbnail-coverage-report.mjs',
  'scripts/export-catalog.mjs',
  'scripts/resolve-place-candidates.mjs',
  'scripts/build-recent-social-posts.mjs',
  'scripts/build-reviewed-social-posts.mjs',
  'scripts/import-thumbnail-candidates-to-sqlite.py',
  'scripts/lib/deny-source-network.mjs',
  'scripts/lib/fetch-public-source.mjs',
  'scripts/lib/media-rights-contract.mjs',
  'scripts/lib/reviewed-corrections.mjs',
  'scripts/lib/local-restaurant-policy.mjs',
  'source-integrity.js',
  'restaurant-corrections.js',
  'app-media.js',
  'app-home-rich.js',
  'app-admin.js',
  'app-restaurant-identity.js',
  'app-inspection-matching.js',
];
const feedFixtureDependencies = [
  'scripts/import-first-party-feed-signals.mjs',
  'scripts/lib/first-party-feed-safety.mjs',
  'scripts/test-first-party-feed-safety.mjs',
  'scripts/lib/robots-policy.mjs',
  'scripts/lib/fetch-public-source.mjs',
  'scripts/lib/lifecycle-language.mjs',
  'scripts/lib/deny-source-network.mjs',
  'source-integrity.js'
];
const sourceValidationPaths = [...new Set([
  'scripts/lib/link-access-policy.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-health-urls.mjs', 'scripts/lib/link-health-report.mjs',
  ...feedFixtureDependencies,
  ...thumbnailFixtureDependencies,
  'scripts/lib/robots-policy.mjs',
  'scripts/test-public-special-robots.mjs',
  'scripts/test-public-special-refresh-safety.mjs',
  ...sourceValidationCommands.filter(command => command.startsWith('node scripts/')).map(command => command.slice(5))
])];
function assertSourceExpansionBoundary(workflow) {
  const prJob = assertPreviewPrBoundary(workflow, 'source-expansion-preview.yml', '17 9 * * *');
  // Keep this PR job limited to one guarded, explicit offline command block.
  // Syntax checks must never become collector executions, even with node flags.
  assert.equal((prJob.match(/\brun:/g) || []).length, 1, 'Source Expansion PR validation must use one guarded run block');
  const run = prJob.split('        run: |\n')[1];
  assert(run, 'Source Expansion needs an explicit offline validation command block');
  assert.deepEqual(run.trim().split('\n').map(line => line.trim()), sourceValidationCommands, 'Source Expansion PR commands must stay offline and cover the source policy regressions');
  assert(prJob.includes('        env:\n          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n        run: |'), 'Source Expansion must apply the network guard to its validation commands');
  const pathFilter = workflow.split('    paths:\n')[1]?.split('\npermissions:')[0];
  for (const path of sourceValidationPaths) assert(pathFilter?.split('\n').includes('      - ' + path), 'Source Expansion must validate changes to ' + path);
}
for (const [file, cron] of [
  ['structured-place-facts-preview.yml', '29 11 * * 2'],
  ['structured-specials-preview.yml', '37 11 * * 3'],
  ['source-expansion-preview.yml', '17 9 * * *']
]) {
  const workflow = await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
  assertPreviewPrBoundary(workflow, file, cron);
  if (file === 'source-expansion-preview.yml') {
    assertSourceExpansionBoundary(workflow);
    for (const [before, after] of [
      ["    if: ${{ github.event_name != 'pull_request' }}\n", ''],
      ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: main'],
      ['NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs', 'NODE_OPTIONS:'],
      ['node --check scripts/import-official-sites.mjs', 'node scripts/import-official-sites.mjs'],
      ['node scripts/test-robots-policy.mjs', 'node --trace-warnings scripts/import-official-sites.mjs'],
      ['node scripts/test-robots-policy-adapters.mjs', 'node scripts/test-public-source-fetch.mjs'],
      ['      - scripts/lib/robots-policy.mjs\n', ''],
      ['      - scripts/test-robots-policy.mjs\n', ''],
      ['      - scripts/test-robots-policy-adapters.mjs\n', ''],
      ['      - scripts/test-public-special-robots.mjs\n', ''],
      ['      - scripts/test-public-special-refresh-safety.mjs\n', ''],
      ['      - scripts/test-thumbnail-observation-clocks.mjs\n', ''],
      ['          node scripts/test-thumbnail-observation-clocks.mjs\n', ''],
      ['  refresh:\n', '      - uses: actions/upload-artifact@v4\n\n  refresh:\n']
    ]) assert.throws(() => assertSourceExpansionBoundary(workflow.replace(before, after)), undefined, 'Source Expansion guard must reject an unsafe boundary change: ' + before);
    for (const path of sourceValidationPaths) assert.throws(() => assertSourceExpansionBoundary(workflow.replace('      - ' + path + '\n', '')), undefined, 'Source Expansion guard must require fixture dependency: ' + path);
  }
}
// Social has only two event lanes. Pin the complete executable envelope so
// duplicate keys, additional jobs/steps, permissions, env or shell wrappers
// cannot hide behind a matching guard elsewhere in the document.
const socialValidationCommands = [
  'node --check scripts/discover-first-party-sources.mjs',
  'node --check scripts/merge-first-party-history.mjs',
  'node --check scripts/sanitize-first-party-sources.mjs',
  'node --check scripts/import-first-party-feed-signals.mjs',
  'node --check scripts/import-meta-social.mjs',
  'node --check scripts/report-social-collection-health.mjs',
  'node --check scripts/build-recent-social-posts.mjs',
  'node --check scripts/build-thumbnail-candidates.mjs',
  'node --check scripts/approve-eligible-thumbnails.mjs',
  'node --check scripts/check-expanded-sources.mjs',
  'node --check scripts/check-thumbnail-candidates.mjs',
  'node --check scripts/build-thumbnail-coverage-report.mjs',
  'node scripts/test-social-platform-registry.mjs',
  'node scripts/test-social-fact-candidates.mjs',
  'node scripts/test-source-run-health.mjs',
  'node scripts/test-public-source-fetch.mjs',
  'node scripts/test-first-party-feed-safety.mjs',
  'node scripts/test-robots-policy.mjs',
  'node scripts/test-robots-policy-adapters.mjs',
  'node scripts/test-media-reference-contract.mjs',
  'node scripts/test-preview-coordinator.mjs',
  'node scripts/test-scheduled-source-guards.mjs',
  'node scripts/test-thumbnail-observation-clocks.mjs'
];
const socialValidationPaths = [
  'index.html',
  'app-events.js',
  'app-event-pagination.js',
  'app-event-date-fixes.js',
  'app-event-local-sort-fixes.js',
  'data/**',
  'scripts/export-catalog.mjs',
  'scripts/resolve-place-candidates.mjs',
  'scripts/lib/local-restaurant-policy.mjs',
  'app-restaurant-identity.js',
  'app-inspection-matching.js',
  '.github/workflows/social-source-preview.yml',
  'data/discovered-restaurants.js',
  'data/social-platform-registry.json',
  'scripts/discover-first-party-sources.mjs',
  'scripts/merge-first-party-history.mjs',
  'scripts/sanitize-first-party-sources.mjs',
  'scripts/import-first-party-feed-signals.mjs',
  'scripts/lib/first-party-feed-safety.mjs',
  'scripts/test-first-party-feed-safety.mjs',
  'scripts/import-meta-social.mjs',
  'scripts/lib/social-fact-candidates.mjs',
  'scripts/build-recent-social-posts.mjs',
  'data/thumbnail-assessments.json',
  'scripts/approve-eligible-thumbnails.mjs',
  'scripts/lib/automatic-thumbnail-approval.mjs',
  'scripts/build-thumbnail-candidates.mjs',
  'scripts/test-thumbnail-observation-clocks.mjs',
  'scripts/import-thumbnail-candidates-to-sqlite.py',
  'app-home-rich.js',
  'app-admin.js',
  'scripts/build-thumbnail-coverage-report.mjs',
  'scripts/check-thumbnail-candidates.mjs',
  'scripts/check-expanded-sources.mjs',
  'scripts/report-social-collection-health.mjs',
  'scripts/test-social-platform-registry.mjs',
  'scripts/test-social-fact-candidates.mjs',
  'scripts/test-source-run-health.mjs',
  'scripts/test-public-source-fetch.mjs',
  'scripts/test-media-reference-contract.mjs',
  'scripts/test-preview-coordinator.mjs',
  'scripts/test-scheduled-source-guards.mjs',
  'scripts/lib/link-access-policy.mjs',
  'scripts/lib/source-access-state.mjs',
  'scripts/lib/link-health-urls.mjs',
  'scripts/lib/link-health-report.mjs',
  '.github/workflows/source-expansion-preview.yml',
  '.github/workflows/structured-place-facts-preview.yml',
  '.github/workflows/structured-specials-preview.yml',
  '.github/workflows/quality-gate.yml',
  '.github/workflows/promote-preview-artifacts.yml',
  '.github/workflows/promote-source-expansion-artifact.yml',
  'scripts/lib/deny-source-network.mjs',
  'scripts/lib/fetch-public-source.mjs',
  'scripts/lib/robots-policy.mjs',
  'scripts/test-robots-policy.mjs',
  'scripts/test-robots-policy-adapters.mjs',
  'scripts/test-public-special-robots.mjs',
  'scripts/test-public-special-refresh-safety.mjs',
  'scripts/lib/public-special-refresh-safety.mjs',
  'scripts/lib/source-page-classification.mjs',
  'scripts/build-structured-specials.mjs',
  'scripts/import-public-special-source-leads.mjs',
  'scripts/import-official-sites.mjs',
  'scripts/verify-official-source-pages.mjs',
  'scripts/import-structured-events.mjs',
  'scripts/import-official-page-intelligence.mjs',
  'scripts/import-patio-directory-facts.mjs',
  'scripts/import-city-events.mjs',
  'scripts/lib/source-run-health.mjs',
  'scripts/lib/media-rights-contract.mjs',
  'scripts/lib/lifecycle-language.mjs',
  'scripts/lib/reviewed-corrections.mjs',
  'scripts/lib/preview-coordinator.mjs',
  'scripts/build-reviewed-social-posts.mjs',
  'scripts/check-source-links.mjs',
  'scripts/coordinate-preview-updates.mjs',
  'scripts/fixtures/media-preservation.json',
  'source-integrity.js',
  'restaurant-corrections.js',
  'app-media.js',
  'app-source-signals.js',
  'data/restaurant-media.js',
  'data/restaurant-media-references.js',
  'data/thumbnail-candidates.js',
  'data/audit/media-rights-reclassification.json'
];
// All local files consumed by the newly enabled composite adapter suite are
// covered by Social's PR filters (accepted fixture inputs are covered by data/**).
const adapterFixtureDependencies = [
  'scripts/test-robots-policy-adapters.mjs', 'scripts/test-public-special-robots.mjs',
  'scripts/test-public-special-refresh-safety.mjs', 'scripts/lib/public-special-refresh-safety.mjs',
  'scripts/lib/source-page-classification.mjs', 'scripts/lib/lifecycle-language.mjs',
  'scripts/build-structured-specials.mjs', 'scripts/build-recent-social-posts.mjs',
  'scripts/build-thumbnail-candidates.mjs', 'scripts/lib/media-rights-contract.mjs', 'app-media.js',
  'scripts/lib/deny-source-network.mjs',
  'scripts/lib/robots-policy.mjs', 'scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'source-integrity.js',
  'scripts/import-official-sites.mjs', 'scripts/verify-official-source-pages.mjs',
  'scripts/import-structured-events.mjs', 'scripts/import-official-page-intelligence.mjs',
  'scripts/import-patio-directory-facts.mjs', 'scripts/import-city-events.mjs',
  'scripts/import-public-special-source-leads.mjs', 'scripts/discover-first-party-sources.mjs',
  'scripts/merge-first-party-history.mjs', 'scripts/sanitize-first-party-sources.mjs'
];
for (const path of adapterFixtureDependencies) assert(socialValidationPaths.includes(path), 'Social must include adapter fixture dependency: ' + path);
for (const path of [...thumbnailFixtureDependencies, ...feedFixtureDependencies]) assert(socialValidationPaths.includes(path), 'Social must include thumbnail fixture dependency: ' + path);
const socialProducerGuard = "    if: ${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}\n";
const socialValidationPrefix = [
  'name: Social Source Preview', '', 'on:', '  workflow_dispatch:', '  schedule:',
  '    - cron: "41 8 * * *"', '  pull_request:', '    branches:', '      - main', '    paths:',
  ...socialValidationPaths.map(path => '      - ' + path),
  '', 'permissions:', '  contents: read', '', 'jobs:',
  '  validate-pr:', "    if: ${{ github.event_name == 'pull_request' }}",
  '    runs-on: ubuntu-latest', '    timeout-minutes: 10', '    steps:',
  '      - name: Checkout exact PR head', '        uses: actions/checkout@v6', '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}', '',
  '      - name: Set up Node', '        uses: actions/setup-node@v4', '        with:', '          node-version: 22', '',
  '      - name: Validate social policy and fixtures without collection',
  '        env:', '          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs',
  '        run: |', ...socialValidationCommands.map(command => '          ' + command),
  '', '  social-refresh:', ''
].join('\n') + socialProducerGuard;
function assertSocialPreviewBoundary(workflow) {
  assert.equal(workflow.slice(0, socialValidationPrefix.length), socialValidationPrefix,
    'Social must preserve its exact guarded PR commands, dependency paths, triggers, permissions and two-job envelope');
  // Frozen accepted producer body from main 477d0cb (#154), excluding only its
  // job key and the newly inserted schedule/manual allowlist above. An intentional
  // future producer change needs its own review and a new explicit baseline.
  assert.equal(createHash('sha256').update(workflow.slice(socialValidationPrefix.length)).digest('hex'),
    '7cd35ab53cab2684ca4377094118a701732f0bbbb8fb8213a53826df0eae49b3',
    'Social scheduled/manual producer steps, source limits, secrets and artifacts must remain byte-identical');
}
const socialWorkflow = await readFile(new URL('../.github/workflows/social-source-preview.yml', import.meta.url), 'utf8');
assertSocialPreviewBoundary(socialWorkflow);
let socialMutations = 0;
function rejectSocialMutation(before, after) {
  assert(socialWorkflow.includes(before), 'Social mutation target must exist: ' + before);
  assert.notEqual(before, after);
  assert.throws(() => assertSocialPreviewBoundary(socialWorkflow.replace(before, after)), undefined,
    'Social boundary must reject: ' + before);
  socialMutations++;
}
for (const [before, after] of [
  [socialProducerGuard, ''],
  [socialProducerGuard, "    if: ${{ github.event_name != 'pull_request' }}\n"],
  [socialProducerGuard, "    if: ${{ always() }}\n"],
  [socialProducerGuard, "    if: ${{ github.event_name == 'pull_request' || github.event_name == 'schedule' }}\n"],
  ["    if: ${{ github.event_name == 'pull_request' }}\n", ''],
  ["    if: ${{ github.event_name == 'pull_request' }}", "    if: ${{ always() }}"],
  ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: main'],
  ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.sha }}'],
  ['          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n', ''],
  ['NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs', 'NODE_OPTIONS:'],
  ['        run: |', '        run: |\n          unset NODE_OPTIONS'],
  ['        run: |', '        run: |\n          curl https://fixture.invalid/'],
  ['node --check scripts/import-meta-social.mjs', 'node scripts/import-meta-social.mjs'],
  ['node scripts/test-social-fact-candidates.mjs', 'node --trace-warnings scripts/import-meta-social.mjs'],
  ['node scripts/test-social-platform-registry.mjs', 'node scripts/test-social-platform-registry.mjs && node scripts/import-meta-social.mjs'],
  ['node scripts/test-social-fact-candidates.mjs', 'node scripts/test-source-run-health.mjs'],
  ['  social-refresh:\n', '      - run: node scripts/import-meta-social.mjs\n\n  social-refresh:\n'],
  ['  social-refresh:\n', '      - uses: actions/upload-artifact@v4\n\n  social-refresh:\n'],
  ['  social-refresh:\n', '  unguarded-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/import-meta-social.mjs\n\n  social-refresh:\n'],
  ['    timeout-minutes: 10\n', '    timeout-minutes: 10\n    permissions:\n      contents: write\n'],
  ['        env:\n', '        env:\n          TOKEN: ${{ secrets.META_FB_ACCESS_TOKEN }}\n'],
  ['permissions:\n  contents: read', 'permissions:\n  contents: write'],
  ['  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n'],
  ['  workflow_dispatch:\n', ''],
  ['cron: "41 8 * * *"', 'cron: "* * * * *"'],
  ['FIRST_PARTY_SOURCE_LIMIT: 9999', 'FIRST_PARTY_SOURCE_LIMIT: 1'],
  ['META_GRAPH_VERSION: v25.0', 'META_GRAPH_VERSION: v26.0'],
  ['secrets.META_IG_ACCESS_TOKEN', 'secrets.OTHER_TOKEN'],
  ['run: node scripts/import-meta-social.mjs', 'run: echo skipped'],
  ['          retention-days: 30', '          retention-days: 1'],
  ['            data/build/social-signals.json\n', '']
]) rejectSocialMutation(before, after);
for (const path of socialValidationPaths) rejectSocialMutation('      - ' + path + '\n', '');
for (const command of socialValidationCommands) rejectSocialMutation('          ' + command + '\n', '');
// Evaluate the actual job guards over every relevant event, not a parallel copy
// of the condition. In particular, push is not an implicit collection fallback.
for (const [job, allowed] of [['validate-pr', ['pull_request']], ['social-refresh', ['schedule', 'workflow_dispatch']]]) {
  const expression = socialWorkflow.split('  ' + job + ':\n')[1].match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
  assert(expression, 'Social job condition must be identifiable: ' + job);
  for (const event_name of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_dispatch', 'workflow_run', 'unknown', undefined]) {
    assert.equal(vm.runInNewContext(expression, { github: { event_name } }), allowed.includes(event_name), job + ': ' + event_name);
  }
}
// A successful offline Social PR must not wake ANY older retained queue lane.
// Inspect the unchanged global admission condition before coordinator execution;
// absence of a new PR artifact alone would not prevent retained-queue writes.
const coordinatorWorkflow = await readFile(new URL('../.github/workflows/promote-preview-artifacts.yml', import.meta.url), 'utf8');
const reconcile = coordinatorWorkflow.match(/^  reconcile:\n([\s\S]*?)(?=^  promote:)/m)?.[1];
const admissionExpression = reconcile?.match(/^    if: >-\n([\s\S]*?)(?=^    runs-on:)/m)?.[1]?.trim();
assert(admissionExpression);
const repository = 'JeremyHennessy/HalifaxSourced';
const retainedRuns = Object.fromEntries(LANES.map(lane => [lane.artifact, { runs: [{
  id: 100 + lane.priority, name: lane.workflow, path: '.github/workflows/' + lane.file,
  status: 'completed', conclusion: 'success', head_branch: 'main', head_repository: { full_name: repository },
  event: 'schedule', created_at: '2026-10-20T12:00:00Z',
  artifacts: [{ name: lane.artifact, expired: false, expires_at: '2026-11-20T12:00:00Z' }]
}] }]));
const retained = planPreviewUpdates({ repository, now: '2026-10-20T15:00:00Z', mainSha: 'fixture-main', lanes: retainedRuns, openPulls: [], attempts: [] });
assert.equal(retained.matrix.include.length, 3, 'All three lanes must be ready to prove admission protects retained work');
const socialPr = { ...retainedRuns['social-source-preview'].runs[0], event: 'pull_request', artifacts: [] };
const admittedSocialPr = expression => vm.runInNewContext(expression, { github: { event_name: 'workflow_run', repository, event: { workflow_run: socialPr } } });
assert.equal(admittedSocialPr(admissionExpression), false);
assert.equal(admittedSocialPr(admissionExpression.replace("github.event.workflow_run.event != 'pull_request'", 'true')), true,
  'Mutation control must demonstrate that the global PR rejection, not the empty trigger artifact, protects retained work');
console.log(`Social PR boundary passed: ${socialMutations} mutations rejected, exact-head guarded fixtures only, unchanged producer, retained-queue admission blocked.`);

// Restaurant has exactly three triggers and two jobs. Pin its entire executable
// envelope rather than searching for a safe-looking command next to unsafe YAML.
// scripts/** covers this suite's source scan; data/** covers accepted/fallback
// inputs; workflow readers and root runtime imports are covered explicitly.
const restaurantValidationPaths = [
  ".github/workflows/**",
  "scripts/**",
  "data/**",
  "app-media.js",
  "source-integrity.js",
  "restaurant-corrections.js",
  "app-restaurant-identity.js",
  "app-inspection-matching.js"
];
const restaurantValidationCommands = [
  "node --check scripts/import-directory-restaurants.mjs",
  "node --check scripts/import-review-directory-restaurants.mjs",
  "node --check scripts/review-directory-sources.mjs",
  "node --check scripts/refine-dartmouth-directory.mjs",
  "node --check scripts/import-opening-watch.mjs",
  "node --check scripts/lib/taste-ns-member-api.mjs",
  "node --check scripts/export-catalog.mjs",
  "node --check scripts/resolve-place-candidates.mjs",
  "node --check scripts/build-discovered-restaurants.mjs",
  "node --check scripts/check-place-source-resolution.mjs",
  "node --check scripts/check-restaurant-discovery.mjs",
  "node scripts/test-dartmouth-directory-names.mjs",
  "node scripts/test-taste-ns-member-api.mjs",
  "node scripts/test-restaurant-discovery-offline.mjs",
  "node scripts/test-scheduled-source-guards.mjs"
];
const restaurantProducerGuard = "    if: ${{ github.event_name != 'pull_request' }}\n";
const restaurantValidationPrefix = [
  'name: Restaurant Discovery Preview', '', 'on:', '  workflow_dispatch:', '  schedule:',
  '    - cron: "43 10 * * *"', '  pull_request:', '    branches:', '      - main', '    paths:',
  ...restaurantValidationPaths.map(path => '      - ' + path),
  '', 'permissions:', '  contents: read', '', 'jobs:',
  '  validate-pr:', "    if: ${{ github.event_name == 'pull_request' }}",
  '    runs-on: ubuntu-latest', '    timeout-minutes: 10', '    steps:',
  '      - name: Checkout exact PR head', '        uses: actions/checkout@v6', '        with:',
  '          ref: ${{ github.event.pull_request.head.sha }}', '',
  '      - name: Set up Node', '        uses: actions/setup-node@v4', '        with:', '          node-version: 22', '',
  '      - name: Validate restaurant discovery without collection',
  '        env:', '          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs',
  '        run: |', ...restaurantValidationCommands.map(command => '          ' + command),
  '', '  discover:', ''
].join('\n') + restaurantProducerGuard;
function assertRestaurantPreviewBoundary(workflow) {
  assertPreviewPrBoundary(workflow, 'restaurant-discovery-preview.yml', '43 10 * * *', 'discover');
  assert.equal(workflow.slice(0, restaurantValidationPrefix.length), restaurantValidationPrefix,
    'Restaurant must preserve its exact offline commands, dependency paths, checkout, env, permissions, triggers and two-job envelope');
  // Frozen producer body from merged #158 (4f3a43b), before adding only the
  // PR exclusion. This baseline is independent of the candidate workflow.
  assert.equal(createHash('sha256').update(workflow.slice(restaurantValidationPrefix.length)).digest('hex'),
    '65cd547756a3295c527ad8699f142376e9881724641265163a649c545231c1a7',
    'Restaurant scheduled/manual commands, bounds and artifact paths/retention must remain byte-identical');
}
const restaurantWorkflow = await readFile(new URL('../.github/workflows/restaurant-discovery-preview.yml', import.meta.url), 'utf8');
assertRestaurantPreviewBoundary(restaurantWorkflow);
let restaurantMutations = 0;
function rejectRestaurantMutation(before, after) {
  assert(restaurantWorkflow.includes(before), 'Restaurant mutation target must exist: ' + before);
  assert.notEqual(before, after);
  assert.throws(() => assertRestaurantPreviewBoundary(restaurantWorkflow.replace(before, after)), undefined,
    'Restaurant boundary must reject: ' + before);
  restaurantMutations++;
}
for (const [before, after] of [
  [restaurantProducerGuard, ''],
  [restaurantProducerGuard, "    if: ${{ always() }}\n"],
  [restaurantProducerGuard, "    if: ${{ github.event_name == 'pull_request' }}\n"],
  ["    if: ${{ github.event_name == 'pull_request' }}\n", ''],
  ["    if: ${{ github.event_name == 'pull_request' }}", "    if: ${{ always() }}"],
  ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: main'],
  ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.sha }}'],
  ['ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.base.sha }}'],
  ['        uses: actions/checkout@v6', '        uses: actions/checkout@v4'],
  ['          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n', ''],
  ['NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs', 'NODE_OPTIONS:'],
  ['        run: |', '        run: |\n          unset NODE_OPTIONS'],
  ['        run: |', '        shell: bash\n        run: |'],
  ['        run: |', '        run: |\n          curl https://fixture.invalid/'],
  ['node --check scripts/import-directory-restaurants.mjs', 'node scripts/import-directory-restaurants.mjs'],
  ['node --check scripts/refine-dartmouth-directory.mjs', 'node scripts/refine-dartmouth-directory.mjs'],
  ['node --check scripts/import-opening-watch.mjs', 'node --trace-warnings scripts/import-opening-watch.mjs'],
  ['node scripts/test-dartmouth-directory-names.mjs', 'node scripts/test-dartmouth-directory-names.mjs && node scripts/import-review-directory-restaurants.mjs'],
  ['node scripts/test-restaurant-discovery-offline.mjs', 'node scripts/build-discovered-restaurants.mjs'],
  ['  discover:\n', '      - run: node scripts/import-directory-restaurants.mjs\n\n  discover:\n'],
  ['  discover:\n', '      - uses: actions/upload-artifact@v4\n\n  discover:\n'],
  ['  discover:\n', '  unguarded-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/import-opening-watch.mjs\n\n  discover:\n'],
  ['  discover:\n', '  validate-pr:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/import-opening-watch.mjs\n\n  discover:\n'],
  ['    timeout-minutes: 10\n', '    timeout-minutes: 10\n    permissions:\n      contents: write\n'],
  ['        env:\n', '        env:\n          TOKEN: ${{ secrets.META_FB_ACCESS_TOKEN }}\n'],
  ['        env:\n', '        env:\n          NODE_OPTIONS: ""\n'],
  ['jobs:\n', 'env:\n  NODE_OPTIONS: ""\n\njobs:\n'],
  ['permissions:\n  contents: read', 'permissions:\n  contents: write'],
  ['permissions:\n  contents: read', 'permissions:\n  contents: read\n  actions: write'],
  ['  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n'],
  ['  workflow_dispatch:\n', '  workflow_dispatch:\n  pull_request_target:\n'],
  ['  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      collect:\n        default: true\n'],
  ['  workflow_dispatch:\n', ''],
  ['cron: "43 10 * * *"', 'cron: "* * * * *"'],
  ['NS_TOURISM_PAGE_LIMIT: 30', 'NS_TOURISM_PAGE_LIMIT: 300'],
  ['DOWNTOWN_DIRECTORY_DETAIL_LIMIT: 120', 'DOWNTOWN_DIRECTORY_DETAIL_LIMIT: 1'],
  ['OPENING_WATCH_LOOKBACK_DAYS: 180', 'OPENING_WATCH_LOOKBACK_DAYS: 365'],
  ['run: node scripts/import-directory-restaurants.mjs', 'run: echo skipped'],
  ['          retention-days: 30', '          retention-days: 1'],
  ['            data/build/directory-restaurant-leads.json\n', ''],
  ['          name: restaurant-discovery-preview', '          name: source-expansion-preview'],
  ['          if-no-files-found: error', '          if-no-files-found: warn'],
  ['          node-version: 22', '          node-version: 24']
]) rejectRestaurantMutation(before, after);
for (const path of restaurantValidationPaths) rejectRestaurantMutation('      - ' + path + '\n', '');
for (const command of restaurantValidationCommands) rejectRestaurantMutation('          ' + command + '\n', '');
assert.throws(() => assertRestaurantPreviewBoundary(restaurantWorkflow + '\n  injected:\n    runs-on: ubuntu-latest\n    steps:\n      - run: curl https://fixture.invalid/\n'));
restaurantMutations++;
// Evaluate actual job conditions together with the pinned trigger envelope. The
// producer's only new line is the PR exclusion; unsupported events never start it.
const restaurantTriggers = ['pull_request', 'schedule', 'workflow_dispatch'];
for (const [job, allowed] of [['validate-pr', ['pull_request']], ['discover', ['schedule', 'workflow_dispatch']]]) {
  const expression = restaurantWorkflow.split('  ' + job + ':\n')[1].match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
  assert(expression, 'Restaurant job condition must be identifiable: ' + job);
  for (const event_name of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_dispatch', 'workflow_run', 'unknown', undefined]) {
    assert.equal(restaurantTriggers.includes(event_name) && vm.runInNewContext(expression, { github: { event_name } }),
      allowed.includes(event_name), job + ': ' + event_name);
  }
}
// Restaurant is not a promotable lane. Also test the global PR denial with
// retained eligible artifacts, since no new upload alone cannot protect a queue.
assert(!LANES.some(lane => lane.workflow === 'Restaurant Discovery Preview' || lane.artifact === 'restaurant-discovery-preview'));
assert(!coordinatorWorkflow.split('permissions:')[0].includes('Restaurant Discovery Preview'));
assert(!coordinatorWorkflow.split('permissions:')[0].includes('restaurant-discovery-preview'));
const restaurantPr = { ...socialPr, name: 'Restaurant Discovery Preview', path: '.github/workflows/restaurant-discovery-preview.yml' };
const admittedRestaurantPr = expression => vm.runInNewContext(expression, { github: { event_name: 'workflow_run', repository, event: { workflow_run: restaurantPr } } });
assert.equal(admittedRestaurantPr(admissionExpression), false);
assert.equal(admittedRestaurantPr(admissionExpression.replace("github.event.workflow_run.event != 'pull_request'", 'true')), true,
  'Mutation control must expose retained-lane reconciliation if the global PR rejection is removed');
console.log(`Restaurant PR boundary passed: ${restaurantMutations} mutations rejected, exact-head guarded fixtures only, unchanged scheduled/manual producer, retained-queue admission blocked.`);

const qualityWorkflow = await readFile(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
for (const script of ['test-robots-policy.mjs', 'test-robots-policy-adapters.mjs', 'test-thumbnail-observation-clocks.mjs', 'test-first-party-feed-safety.mjs']) assert(qualityWorkflow.includes('          node scripts/' + script + '\n'), 'Quality Gate must run ' + script);
console.log('Preview PR boundaries passed: exact-head offline validation only, including Source Expansion; scheduled/manual collection remains separate.');
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
