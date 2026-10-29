import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const scratch=await mkdtemp(join(tmpdir(),'halifax-semantic-'));
const paths=['data/city-events.js','data/build/city-events.json','data/build/event-entity-resolution.json'];
const reviewOnlyPath='artifacts/city-event-quarantine-report.json';
const put=async(path,text)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,text);};
try {
 const repo=join(scratch,'repo'), artifact=join(scratch,'artifact'),receipt=join(scratch,'receipt.json');
 const snapshot=stamp=>({generatedAt:stamp,observedAt:stamp,events:[{id:'a',title:'Verified event',startAt:'2026-11-01T00:00:00Z',observedAt:stamp}]});
 for(const path of paths) {
  const serialize=value=>path.endsWith('.js')?'window.HALIFAX_CITY_EVENTS = '+JSON.stringify(value)+';\n':JSON.stringify(value)+'\n';
  await put(join(repo,path),serialize(snapshot('2026-10-01T00:00:00Z')));
  await put(join(artifact,path),serialize(snapshot('2026-10-20T00:00:00Z')));
 }
 await put(join(artifact,reviewOnlyPath),'{}\n');
 const metadata=join(repo,'data/build/preview-promotion-metadata.json');
 await put(metadata,'{"accepted":"unchanged"}\n');
 const old=new Map(await Promise.all([...paths,'data/build/preview-promotion-metadata.json'].map(async p=>[p,await readFile(join(repo,p),'utf8')])));
 const run=()=>spawnSync(process.execPath,[new URL('./promote-preview-artifacts.mjs',import.meta.url).pathname],{cwd:repo,env:{...process.env,ARTIFACT_NAME:'city-events-preview',ARTIFACT_DIR:artifact,PROMOTION_RESULT_PATH:receipt},encoding:'utf8'});
 let result=run();assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(await readFile(receipt)).changed,false);
 await assert.rejects(readFile(join(repo,reviewOnlyPath)),error=>error.code==='ENOENT');
 for(const [p,content] of old) assert.equal(await readFile(join(repo,p),'utf8'),content,p);
 const next=snapshot('2026-10-20T00:00:00Z');next.events[0].startAt='2026-11-02T00:00:00Z';
 for(const path of paths) await put(join(artifact,path),path.endsWith('.js')?'window.HALIFAX_CITY_EVENTS = '+JSON.stringify(next)+';\n':JSON.stringify(next)+'\n');
 result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(await readFile(receipt)).changed,true);
 await assert.rejects(readFile(join(repo,reviewOnlyPath)),error=>error.code==='ENOENT');
 assert.equal(JSON.parse(await readFile(metadata)).state,'prepared-for-review');
 assert.equal(JSON.parse(await readFile(metadata)).reviewedAt,null);
 console.log('Promotion semantic integration passed: receipt-only no-op preserves accepted bytes, meaningful change promotes coherent bundle.');
} finally {await rm(scratch,{recursive:true,force:true});}
