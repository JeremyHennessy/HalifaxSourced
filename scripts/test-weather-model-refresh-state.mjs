import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapRefreshState,openRefreshRun,inspectRefreshState,sha256} from './lib/weather-model-refresh-state.mjs';
globalThis.fetch=()=>assert.fail('state test is offline');
const temp=await fs.mkdtemp(join(tmpdir(),'model-refresh-state-')),policySha256='a'.repeat(64),baselineSha256='b'.repeat(64),now='2026-10-28T05:00:00.000Z';let count=0;
async function store(name){const dir=join(temp,name);await bootstrapRefreshState(dir,{policySha256,baselineSha256,createdAt:now});return dir;}
const state=(n,disposition='ready')=>({version:1,runNumber:n,completedAt:now,disposition,nextAttemptNotBefore:'2026-10-28T06:00:00.000Z'});
try{
 const dir=await store('normal');assert.equal((await inspectRefreshState(dir,policySha256)).runNumber,1);await assert.rejects(()=>bootstrapRefreshState(dir,{policySha256,baselineSha256,createdAt:now}),/EEXIST/);count++;
 const run=await openRefreshRun(dir,{policySha256,now});await assert.rejects(()=>openRefreshRun(dir,{policySha256,now}));const bytes=Buffer.from('immutable'),id=await run.blob(bytes);assert.equal(id,sha256(bytes));assert.deepEqual(await run.readBlob(id),bytes);assert.equal(await run.blob(bytes),id);await run.append({event:'offline_receipt'});await run.finish(state(1));assert.equal((await inspectRefreshState(dir,policySha256)).runNumber,2);count++;
 await assert.rejects(()=>openRefreshRun(dir,{policySha256,now}),/cadence/);await assert.rejects(()=>fs.stat(join(dir,'writer.lock')),/ENOENT/);const next=await openRefreshRun(dir,{policySha256,now:'2026-10-28T06:00:00.000Z'});await next.finish(state(2,'held'));await assert.rejects(()=>openRefreshRun(dir,{policySha256,now:'2026-10-29T06:00:00.000Z'}),/held/);count++;
 await assert.rejects(()=>inspectRefreshState(dir,'c'.repeat(64)),/policy/);count++;
 const interrupted=await store('interrupted'),pending=await openRefreshRun(interrupted,{policySha256,now});await pending.journal.close();await assert.rejects(()=>openRefreshRun(interrupted,{policySha256,now}));await assert.rejects(()=>inspectRefreshState(interrupted,policySha256));count++;
 const tamper=await store('tamper'),r=await openRefreshRun(tamper,{policySha256,now});await r.finish(state(1));await fs.appendFile(join(tamper,'runs/000001/state.json'),' ');await assert.rejects(()=>inspectRefreshState(tamper,policySha256),/state changed/);count++;
 const gap=await store('gap');await fs.mkdir(join(gap,'runs/000002'));await assert.rejects(()=>inspectRefreshState(gap,policySha256),/run gap/);count++;
 const symlink=await store('symlink');await fs.symlink('/dev/null',join(symlink,'blobs','unsafe'));await assert.rejects(()=>inspectRefreshState(symlink,policySha256),/symlink/);count++;
 const badJournal=await store('journal'),j=await openRefreshRun(badJournal,{policySha256,now});await j.finish(state(1));await fs.appendFile(join(badJournal,'runs/000001/journal.jsonl'),'{}\n');await assert.rejects(()=>inspectRefreshState(badJournal,policySha256),/journal changed/);count++;
 const missing=await store('missing-ref'),mr=await openRefreshRun(missing,{policySha256,now});const bid=await mr.blob(Buffer.from('retained'));await mr.finish({...state(1),metadataCache:{test:{bodySha256:bid,bodyBytes:8}}});await fs.unlink(join(missing,'blobs',bid));await assert.rejects(()=>openRefreshRun(missing,{policySha256,now:'2026-10-28T06:00:00.000Z'}),/ENOENT/);count++;
 const candidate=await store('missing-candidate'),cr=await openRefreshRun(candidate,{policySha256,now});await fs.writeFile(join(cr.directory,'candidate.json'),'{}');await cr.finish({...state(1),candidate:{path:'runs/000001/candidate.json',sha256:sha256(Buffer.from('{}'))}});await fs.unlink(join(cr.directory,'candidate.json'));await assert.rejects(()=>inspectRefreshState(candidate,policySha256),/ENOENT/);count++;
 console.log(`${count} refresh storage groups passed: exact immutable chain, exclusive bootstrap/lock, unresolved crash, cadence, holds, symlink/hash mutation rejection; no requests.`);
}finally{await fs.rm(temp,{recursive:true,force:true});}
