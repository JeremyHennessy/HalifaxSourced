// Fixed-root, single-writer review storage. No network, recovery/reset or automatic deletion.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {openWeatherReviewJournal} from './weather-review-journal.mjs';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const REFRESH_STORAGE_LIMIT=512*1024*1024;
const hash=value=>assert.match(value,/^[a-f0-9]{64}$/);
async function syncDir(path){const h=await fs.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function regular(path){const s=await fs.lstat(path);assert.ok(s.isFile()&&!s.isSymbolicLink(),'regular private state file required');return s;}
export async function readPrivate(path,maxBytes=32*1024*1024){const s=await regular(path);assert.ok(s.size<=maxBytes,'private file byte budget');return fs.readFile(path);}
async function exclusive(path,bytes){const h=await fs.open(path,'wx',0o600);try{await h.writeFile(bytes);await h.sync();await syncDir(resolve(path,'..'));}finally{await h.close();}}
async function usage(root){let bytes=0,entries=0;async function walk(path){const s=await fs.lstat(path);assert.ok(!s.isSymbolicLink(),'state symlink prohibited');assert.ok(++entries<=20000,'state entry budget');if(s.isDirectory()){for(const name of await fs.readdir(path))await walk(join(path,name));}else{assert.ok(s.isFile());bytes+=s.size;assert.ok(bytes<=REFRESH_STORAGE_LIMIT,'retention budget reached; reviewed archive/storage action required');}}await walk(root);return bytes;}
export async function bootstrapRefreshState(root,{policySha256,baselineSha256,createdAt}){
 root=resolve(root);hash(policySha256);hash(baselineSha256);assert.ok(Number.isFinite(Date.parse(createdAt)));
 // Exclusive genesis itself is the permanent no-reset marker; fsync includes every ancestor.
 const h=await openWeatherReviewJournal(join(root,'bootstrap.json'),{version:1,kind:'halifax_model_refresh_bootstrap',policySha256,baselineSha256,createdAt});await h.close();
 await fs.mkdir(join(root,'runs'),{mode:0o700});await fs.mkdir(join(root,'blobs'),{mode:0o700});await syncDir(root);
}
export async function inspectRefreshState(root,policySha256){
 root=resolve(root);hash(policySha256);const bytesUsed=await usage(root),genesisBytes=await readPrivate(join(root,'bootstrap.json'),4096),genesis=JSON.parse(genesisBytes);assert.equal(genesis.version,1);assert.equal(genesis.kind,'halifax_model_refresh_bootstrap');assert.equal(genesis.policySha256,policySha256,'refresh policy/code changed; reviewed migration required');hash(genesis.baselineSha256);
 const names=(await fs.readdir(join(root,'runs'))).sort();assert.ok(names.length<=9999);let prior=sha256(genesisBytes),state=null;
 for(let i=0;i<names.length;i++){
  const name=String(i+1).padStart(6,'0');assert.equal(names[i],name,'run gap or unknown state; no fallback');const directory=join(root,'runs',name),stat=await fs.lstat(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  const finalBytes=await readPrivate(join(directory,'final.json'),8192),final=JSON.parse(finalBytes);assert.equal(final.version,1);assert.equal(final.runNumber,i+1);assert.equal(final.predecessorFinalSha256,prior,'broken exact final chain');assert.equal(final.policySha256,policySha256);assert.equal(final.transportDecisionsDrained,true);
  const stateBytes=await readPrivate(join(directory,'state.json'));assert.equal(sha256(stateBytes),final.stateSha256,'state changed after final receipt');state=JSON.parse(stateBytes);assert.equal(state.version,1);assert.ok(['ready','backoff','held'].includes(state.disposition));assert.equal(state.runNumber,i+1);assert.equal(state.completedAt,final.completedAt);if(state.acceptedBaselineSha256!==undefined||state.acceptedBaselineIssuedAt!==undefined){hash(state.acceptedBaselineSha256);assert.ok(Number.isFinite(Date.parse(state.acceptedBaselineIssuedAt)),'invalid accepted baseline clock');}
  const journal=await readPrivate(join(directory,'journal.jsonl'),2*1024*1024);assert.equal(sha256(journal),final.journalSha256,'journal changed after final receipt');const events=journal.toString().trim().split('\n').map(line=>JSON.parse(line));assert.equal(events[0].event,'run_pending');assert.equal(events.at(-1).event,'run_final');assert.equal(events[0].predecessorFinalSha256,prior);assert.equal(events.at(-1).stateSha256,final.stateSha256);prior=sha256(finalBytes);
 }
 if(state){
  const verifyBlob=async id=>{hash(id);const bytes=await readPrivate(join(root,'blobs',id),8*1024*1024);assert.equal(sha256(bytes),id,'missing/mutated retained blob');return bytes;};
  const metadata=Object.values(state.metadataCache||{});assert.ok(metadata.length<=32);for(const item of metadata){const bytes=await verifyBlob(item.bodySha256);assert.equal(bytes.length,item.bodyBytes);}
  const fields=Object.values(state.fieldCache||{});assert.ok(fields.length<=10);for(const id of fields){const capture=JSON.parse(await verifyBlob(id));const bytes=await verifyBlob(capture.id);assert.equal(capture.receipt.bodySha256,capture.id);assert.equal(bytes.length,capture.receipt.bodyBytes);}
  for(const candidate of [state.candidate,state.lastKnownGood].filter(Boolean)){
   if(candidate.kind==='accepted_publication_baseline'){assert.equal(candidate.manifestSha256,genesis.baselineSha256);hash(candidate.archiveSha256);continue;}
   assert.match(candidate.path,/^runs\/\d{6}\/candidate\.json$/);assert.ok(Number(candidate.path.split('/')[1])<=state.runNumber);hash(candidate.sha256);assert.equal(sha256(await readPrivate(join(root,candidate.path))),candidate.sha256,'missing/mutated retained candidate');
  }
 }
 return {root,genesis,state,runNumber:names.length+1,predecessorFinalSha256:prior,bytesUsed};
}
export async function openRefreshRun(root,{policySha256,now}){
 const preflight=await inspectRefreshState(root,policySha256);
 assert.notEqual(preflight.state?.disposition,'held','held outcome requires reviewed recovery');
 if(preflight.state)assert.ok(Date.parse(now)>=Date.parse(preflight.state.nextAttemptNotBefore),'cadence/backoff not elapsed');
 // No stale-lock timeout: a crashed writer requires evidence review, never automatic unlock.
 const lock=await fs.open(join(root,'writer.lock'),'wx',0o600);let run;
 try{
  await lock.writeFile(jsonBytes({version:1,attemptedAt:now,pid:process.pid}));await lock.sync();await syncDir(root);
  const prior=await inspectRefreshState(root,policySha256);assert.notEqual(prior.state?.disposition,'held','held outcome requires reviewed recovery');
  if(prior.state){assert.ok(Date.parse(now)>=Date.parse(prior.state.nextAttemptNotBefore),'cadence/backoff not elapsed');}
  // Reserve the full upper-bound run budget before sending any request.
  assert.ok(prior.bytesUsed+96*1024*1024<=REFRESH_STORAGE_LIMIT,'insufficient retention budget; review storage before fetching');
  const directory=join(root,'runs',String(prior.runNumber).padStart(6,'0'));await fs.mkdir(directory,{mode:0o700});await syncDir(join(root,'runs'));
  const journal=await openWeatherReviewJournal(join(directory,'journal.jsonl'),{event:'run_pending',version:1,runNumber:prior.runNumber,attemptedAt:now,policySha256,predecessorFinalSha256:prior.predecessorFinalSha256});
  let closed=false,storedBytes=prior.bytesUsed;run={...prior,directory,journal,async append(event){assert.equal(closed,false);await journal.writeFile(JSON.stringify(event)+'\n');await journal.sync();},async blob(bytes){const digest=sha256(bytes),path=join(root,'blobs',digest);try{assert.ok(storedBytes+bytes.length+34*1024*1024<=REFRESH_STORAGE_LIMIT,'retention budget reached');await exclusive(path,bytes);storedBytes+=bytes.length;}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(sha256(await readPrivate(path,8*1024*1024)),digest,'changed content-addressed body');}return digest;},async readBlob(digest){hash(digest);const bytes=await readPrivate(join(root,'blobs',digest),8*1024*1024);assert.equal(sha256(bytes),digest);return bytes;},async finish(state){assert.equal(state.version,1);assert.equal(state.runNumber,prior.runNumber);const stateBytes=jsonBytes(state);await exclusive(join(directory,'state.json'),stateBytes);await run.append({event:'run_final',stateSha256:sha256(stateBytes),completedAt:state.completedAt});await journal.close();closed=true;const journalBytes=await readPrivate(join(directory,'journal.jsonl'),2*1024*1024);await usage(root);const final={version:1,runNumber:prior.runNumber,policySha256,predecessorFinalSha256:prior.predecessorFinalSha256,stateSha256:sha256(stateBytes),journalSha256:sha256(journalBytes),transportDecisionsDrained:true,completedAt:state.completedAt};await exclusive(join(directory,'final.json'),jsonBytes(final));await lock.close();await fs.unlink(join(root,'writer.lock'));await syncDir(root);return final;}};return run;
 }catch(error){await lock.close().catch(()=>{});if(!run){/* Even setup uncertainty leaves the durable lock: no unsafe reset. */}throw error;}
}
