import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = await mkdtemp(join(tmpdir(), 'halifax-link-audit-time-'));
try {
  for (const file of ['scripts/check-release-link-health.mjs','scripts/check-source-links.mjs','scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/reviewed-corrections.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/link-health-urls.mjs','scripts/lib/link-health-report.mjs','scripts/lib/validate-link-health.mjs','data/source-link-access-holds.json','restaurant-corrections.js','source-integrity.js']) {
    await mkdir(dirname(join(root,file)),{recursive:true}); await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  }
  await mkdir(join(root,'data/build'),{recursive:true});
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  const url='https://example.com/fixture-location';
  const save=(name,value)=>writeFile(join(root,'data/build',name+'.json'),JSON.stringify(value));
  await save('catalog',{restaurants:[{id:'fixture',website:url,operatingStatus:'active'}]});
  for (const name of ['first-party-sources','structured-place-facts','city-events']) await save(name,{records:[],events:[]});
  const env={...process.env,SOURCE_COMMIT_SHA:'fixture-head',GITHUB_SHA:'fixture-head',GITHUB_EVENT_NAME:'pull_request',LINK_HEALTH_SCOPE:'release',LINK_HEALTH_REUSE_RECENT:'1',LINK_HEALTH_LIMIT:'0',LINK_HEALTH_CONCURRENCY:'1'};
  const hook=join(root,'mock-fetch.mjs');
  await writeFile(hook,`import {appendFileSync} from 'node:fs';globalThis.fetch=async url=>{if(String(url)!==${JSON.stringify(url)})throw Error('Unexpected fixture target:'+url);appendFileSync(${JSON.stringify(join(root,'fetches.txt'))},'fetch\\n');return new Response('fixture',{status:200});};`);
  const runCollector=extra=>spawnSync(process.execPath,['--import',hook,join(root,'scripts/check-source-links.mjs')],{env:{...env,...extra},encoding:'utf8'});
  const runGate=()=>spawnSync(process.execPath,[join(root,'scripts/check-release-link-health.mjs')],{env,encoding:'utf8'});
  const initial=runCollector(); assert.equal(initial.status,0,initial.stderr);
  const report=JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json'),'utf8'));
  assert.equal(runGate().status,0,'Fresh exact-head response receipts pass');
  const now=Date.now(), fresh=report.results[0].observedAt;
  const invalid=[undefined,null,'','not-a-date',new Date(now+60000).toISOString(),new Date(now-86400001).toISOString()];
  for (const value of invalid) {
    await save('source-link-health-report',{...report,generatedAt:value});const bad=runGate();assert.notEqual(bad.status,0);assert.match(bad.stderr,/timestamp/);
    await save('source-link-health-report',{...report,results:[{...report.results[0],observedAt:value}]});assert.notEqual(runGate().status,0,'New assessment cannot launder bad observation');
    await save('source-link-health-report',{...report,results:[{...report.results[0],assessedAt:value}]});assert.notEqual(runGate().status,0,'Invalid assessment must fail');
  }
  const cases=[{label:'fresh same head',at:fresh,sha:'fixture-head',reuse:true},...invalid.map(at=>({label:'invalid receipt '+at,at,sha:'fixture-head',reuse:false})),{label:'older than reuse window',at:new Date(now-3600001).toISOString(),sha:'fixture-head',reuse:false},{label:'different head',at:fresh,sha:'different-head',reuse:false},{label:'unbound local run',at:fresh,sha:null,unbound:true,reuse:false}];
  for (const test of cases) {
    await writeFile(join(root,'fetches.txt'),'');await save('source-link-health-report',{...report,sourceCommitSha:test.sha,results:[{...report.results[0],observedAt:test.at}]});
    const result=runCollector(test.unbound?{SOURCE_COMMIT_SHA:'',GITHUB_SHA:''}:{});assert.equal(result.status,0,test.label+'\n'+result.stderr);
    assert.equal(Boolean(await readFile(join(root,'fetches.txt'),'utf8')),!test.reuse,test.label);
    const output=JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json'),'utf8'));
    assert.equal(Boolean(output.results[0].reusedObservation),test.reuse,test.label);
    if(test.reuse)assert.equal(output.results[0].observedAt,fresh,'Reuse preserves actual response clock');
    else assert(Number.isFinite(Date.parse(output.results[0].observedAt)),'Actual mocked response creates observation');
  }
  console.log('Link audit freshness passed: real mocked receipts, invalid/future/stale observations and assessments rejected, same-head recent success reuse only.');
} finally {await rm(root,{recursive:true,force:true});}
