// Fault-injected local filesystem and transport only: no source requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {collectEcccReview} from './lib/eccc-weather-adapter.mjs';
import {projectEccc,acceptedEnvelope} from './lib/eccc-weather.mjs';
const read=path=>fs.readFile(new URL('../'+path,import.meta.url),'utf8');
const body=await read('scripts/fixtures/weather/eccc-citypage-20261028.json');
const registry=JSON.parse(await read('data/weather-source-registry.json'));
const originalEnabled=registry.sources[0].enabled;
const enabled=structuredClone(registry);enabled.sources[0].enabled=true; // test-only, never written
const actualBytes=await read('data/build/halifax-weather.json');
const receipt=JSON.parse(await read('scripts/fixtures/weather/eccc-citypage-20261028-receipt.json'));
const previous=acceptedEnvelope(projectEccc(body,receipt),receipt);
const originalSnapshot=JSON.stringify(previous);
const journalPath='/durable/existing/new/leaf/review.jsonl',leaf='/durable/existing/new/leaf';
const originals={lstat:fs.lstat,mkdir:fs.mkdir,open:fs.open,fetch:globalThis.fetch};

function mockedIO({failAt=-1,stallAt=-1,preexisting=false,journalExists=false,symlink=null,errorCode='EIO'}={}) {
  const directories=new Set(['/', '/durable', '/durable/existing',...(preexisting?['/durable/existing/new',leaf]:[])]);
  const events=[];let requests=0,releaseBarrier,barrierReached;
  const reached=new Promise(resolve=>{barrierReached=resolve});
  async function step(name){
    const index=events.length;events.push(name);
    if(index===failAt)throw Object.assign(new Error('mock filesystem failure: '+name),{code:errorCode});
    if(index===stallAt){barrierReached();await new Promise(resolve=>{releaseBarrier=resolve});}
  }
  fs.lstat=async path=>{await step('lstat:'+path);if(!directories.has(path))throw Object.assign(new Error('missing directory'),{code:'ENOENT'});return {isDirectory:()=>path!==symlink,isSymbolicLink:()=>path===symlink};};
  fs.mkdir=async(path,options)=>{await step('mkdir:'+path);assert.equal(options.recursive,undefined);assert.equal(options.mode,0o700);assert.ok(directories.has(path.slice(0,path.lastIndexOf('/'))||'/'));directories.add(path);};
  fs.open=async(path,flags)=>{
    if(flags==='wx'){
      assert.equal(path,journalPath);await step('open-journal:wx');
      if(journalExists)throw Object.assign(new Error('existing journal'),{code:'EEXIST'});
      journalExists=true;let closed=false;
      return {
        async writeFile(value){assert.equal(closed,false);const entry=JSON.parse(value);await step('write-journal:'+entry.status);},
        async sync(){assert.equal(closed,false);await step('sync-journal');},
        async close(){closed=true;await step('close-journal');}
      };
    }
    assert.equal(typeof flags,'number');assert.ok(directories.has(path));assert.notEqual(path,symlink);
    await step('open-directory:'+path);let closed=false;
    return {
      async sync(){assert.equal(closed,false);await step('sync-directory:'+path);},
      async close(){closed=true;await step('close-directory:'+path);}
    };
  };
  globalThis.fetch=async()=>{await step('transport');requests++;return new Response(body,{headers:{'content-type':'application/json'}});};
  return {events,reached,release(){releaseBarrier();},get requests(){return requests;},restore(){fs.lstat=originals.lstat;fs.mkdir=originals.mkdir;fs.open=originals.open;globalThis.fetch=originals.fetch;}};
}
const run=()=>collectEcccReview({registry:enabled,journalPath,previous});
let prefix;
{
  const mock=mockedIO();
  try{
    const result=await run();assert.equal(result.candidate.lastAttempt.status,'success');assert.equal(mock.requests,1);
    prefix=mock.events.slice(0,mock.events.indexOf('transport'));
    assert.deepEqual(prefix.slice(-6),['open-journal:wx','write-journal:pending','sync-journal','open-directory:'+leaf,'sync-directory:'+leaf,'close-directory:'+leaf]);
    for(const directory of ['/durable/existing/new',leaf]){
      const created=prefix.indexOf('mkdir:'+directory),parent=directory.slice(0,directory.lastIndexOf('/'));
      assert.ok(created>=0);
      assert.deepEqual(prefix.slice(created,created+7),['mkdir:'+directory,'open-directory:'+directory,'sync-directory:'+directory,'close-directory:'+directory,'open-directory:'+parent,'sync-directory:'+parent,'close-directory:'+parent]);
    }
    assert.ok(prefix.indexOf('sync-directory:/')<prefix.indexOf('mkdir:/durable/existing/new'));
  }finally{mock.restore();}
}
// Any mkdir/lstat/open/write/fsync/close failure in the entire durability
// barrier rejects before transport, without unlinking or replacing the journal.
for(let failAt=0;failAt<prefix.length;failAt++){
  const mock=mockedIO({failAt});
  try{await assert.rejects(run(),/mock filesystem failure/);assert.equal(mock.requests,0,prefix[failAt]);assert.ok(!mock.events.includes('transport'));}
  finally{mock.restore();}
}
const parentSyncIndex=prefix.lastIndexOf('sync-directory:'+leaf);
for(const code of ['EINVAL','ENOTSUP','EROFS']){
  const mock=mockedIO({failAt:parentSyncIndex,errorCode:code});
  try{await assert.rejects(run(),error=>error.code===code);assert.equal(mock.requests,0);}
  finally{mock.restore();}
}
{
  const mock=mockedIO({stallAt:parentSyncIndex});
  try{const pending=run();await mock.reached;assert.equal(mock.requests,0);assert.ok(!mock.events.includes('transport'));mock.release();await pending;assert.equal(mock.requests,1);}
  finally{mock.restore();}
}
{
  const mock=mockedIO({preexisting:true});
  try{await run();assert.ok(!mock.events.some(x=>x.startsWith('mkdir:')));for(const dir of ['/','/durable','/durable/existing','/durable/existing/new',leaf])assert.ok(mock.events.includes('sync-directory:'+dir));}
  finally{mock.restore();}
}
for(const settings of [{journalExists:true},{symlink:'/durable/existing'}]){
  const mock=mockedIO(settings);
  try{await assert.rejects(run());assert.equal(mock.requests,0);}
  finally{mock.restore();}
}
assert.equal(JSON.stringify(previous),originalSnapshot);
assert.equal(await read('data/build/halifax-weather.json'),actualBytes);
assert.equal(JSON.parse(await read('data/weather-source-registry.json')).sources[0].enabled,originalEnabled);
console.log(`Weather journal durability passed: ${prefix.length} pre-transport failure points, new/existing ancestor order, pending-byte and pathname barriers, unsupported fsync, blocked async barrier, symlink/existing-journal refusal; zero external requests or snapshot changes.`);
