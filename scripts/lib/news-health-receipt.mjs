// Offline review-evidence projection. No publisher requests, cache writes, or
// candidate promotion. A committed manifest is an explicit reviewed trust anchor,
// not proof of a signature or live GitHub availability.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {payloadDigest, verifyFinalReceipt, cacheKey, NEWS_REPOSITORY, NEWS_WORKFLOW} from './news-run-lineage.mjs';
export const NEWS_HEALTH_MANIFEST = 'news-evidence/current.json';
const verified = new WeakSet();
const freeze = value => { if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);} return value; };
export const isVerifiedNewsHealth = value => verified.has(value);
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), expected.sort());
const stamp = value => { assert.equal(typeof value,'string'); assert.equal(new Date(value).toISOString(),value); return Date.parse(value); };
const normalized = value => value === null ? null : new Date(stamp(value)).toISOString();
const hash = value => { assert.match(value,/^[a-f0-9]{64}$/); return value; };
const names = ['news-preview-collected.json','news-preview-final.json','news-preview-lineage-plan.json','news-preview-predecessor.json','news-preview.json'];
// Read only the five bounded JSON entries of the digest-pinned GitHub ZIP in
// memory. Never extract paths or execute an archive entry. No general ZIP support.
export function newsArtifactFiles(zip) {
  assert.ok(Buffer.isBuffer(zip) && zip.length >= 22 && zip.length <= 2_000_000);
  const end = zip.length-22;
  assert.equal(zip.readUInt32LE(end),0x06054b50);
  assert.equal(zip.readUInt16LE(end+4),0); assert.equal(zip.readUInt16LE(end+6),0);
  assert.equal(zip.readUInt16LE(end+8),5); assert.equal(zip.readUInt16LE(end+10),5);
  assert.equal(zip.readUInt16LE(end+20),0);
  const start=zip.readUInt32LE(end+16); assert.equal(start+zip.readUInt32LE(end+12),end);
  let cursor=start, total=0; const result={};
  for(let n=0;n<5;n++){
    assert.equal(zip.readUInt32LE(cursor),0x02014b50);
    const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+20),length=zip.readUInt32LE(cursor+24);
    const nameSize=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32),offset=zip.readUInt32LE(cursor+42);
    const name=zip.subarray(cursor+46,cursor+46+nameSize).toString('utf8');
    assert.ok(names.includes(name) && !Object.hasOwn(result,name)); assert.equal(flags & ~0x808,0); assert.equal(method,8);
    assert.equal(zip.readUInt16LE(cursor+34),0); assert.ok(length<=500_000 && (total+=length)<=1_000_000);
    assert.ok(offset+30<start); assert.equal(zip.readUInt32LE(offset),0x04034b50);
    assert.equal(zip.readUInt16LE(offset+6),flags); assert.equal(zip.readUInt16LE(offset+8),method);
    const localNameSize=zip.readUInt16LE(offset+26),localExtra=zip.readUInt16LE(offset+28);
    assert.equal(zip.subarray(offset+30,offset+30+localNameSize).toString('utf8'),name);
    const dataOffset=offset+30+localNameSize+localExtra; assert.ok(dataOffset+size<=start);
    const bytes=inflateRawSync(zip.subarray(dataOffset,dataOffset+size),{maxOutputLength:500_000}); assert.equal(bytes.length,length);
    result[name]=bytes; cursor+=46+nameSize+extra+comment;
  }
  assert.equal(cursor,end); assert.deepEqual(Object.keys(result).sort(),names.slice().sort()); return result;
}
export function projectNewsHealth({manifest, files, registry}) {
  keys(manifest,['version','kind','runId','reviewedAt','files']);
  assert.equal(manifest.version,1); assert.equal(manifest.kind,'reviewed_news_operational_receipt');
  assert.match(manifest.runId,/^[1-9][0-9]*$/); stamp(manifest.reviewedAt);
  keys(manifest.files,['artifact.zip','run.json','artifact.json','jobs.json']); keys(files,Object.keys(manifest.files));
  for(const [name,digest] of Object.entries(manifest.files)){ assert.ok(Buffer.isBuffer(files[name]) && files[name].length<=2_000_000); assert.equal(payloadDigest(files[name]),hash(digest),`news evidence digest: ${name}`); }
  const run=JSON.parse(files['run.json']), artifact=JSON.parse(files['artifact.json']), jobs=JSON.parse(files['jobs.json']);
  assert.equal(String(run.id),manifest.runId); assert.equal(run.repository.full_name,NEWS_REPOSITORY); assert.equal(run.repository.id,1348899318);
  assert.equal(run.workflow_id,398735078); assert.equal(run.path,NEWS_WORKFLOW); assert.equal(run.head_branch,'main'); assert.match(run.head_sha,/^[a-f0-9]{40}$/);
  assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success'); assert.equal(run.run_attempt,1); assert.equal(run.event,'schedule');
  assert.ok(Number.isSafeInteger(run.run_number) && run.run_number>1);
  const started=Date.parse(run.run_started_at),completed=Date.parse(run.updated_at);
  assert.ok(Number.isFinite(started) && Number.isFinite(completed) && started<=completed && completed<=stamp(manifest.reviewedAt));
  assert.equal(artifact.name,'regional-news-review-only'); assert.equal(artifact.digest,`sha256:${manifest.files['artifact.zip']}`);
  assert.equal(artifact.workflow_run.id,run.id); assert.equal(artifact.workflow_run.repository_id,run.repository.id); assert.equal(artifact.workflow_run.head_repository_id,run.repository.id);
  assert.equal(artifact.workflow_run.head_sha,run.head_sha); assert.equal(artifact.workflow_run.head_branch,run.head_branch);
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id>0); assert.equal(artifact.size_in_bytes,files['artifact.zip'].length);
  assert.equal(jobs.total_count,1); assert.equal(jobs.jobs.length,1);
  const job=jobs.jobs[0]; assert.equal(job.run_id,run.id); assert.equal(job.head_sha,run.head_sha); assert.equal(job.run_attempt,1); assert.equal(job.name,'preview');
  assert.equal(job.status,'completed'); assert.equal(job.conclusion,'success');
  for(const name of ['Restore only the exact successful predecessor payload',"Restore only that predecessor's final receipt",'Verify receipt and digest before any news or robots request','Verify exact current payload cache exists after save','Verify exact final receipt cache exists after save','Fail closed if the final receipt was not saved']){
    const steps=job.steps.filter(s=>s.name===name); assert.equal(steps.length,1); assert.equal(steps[0].status,'completed'); assert.equal(steps[0].conclusion,'success');
  }
  const entries=newsArtifactFiles(files['artifact.zip']);
  const payload=JSON.parse(entries['news-preview.json']), receipt=JSON.parse(entries['news-preview-final.json']), plan=JSON.parse(entries['news-preview-lineage-plan.json']), collected=JSON.parse(entries['news-preview-collected.json']);
  const identity={repository:NEWS_REPOSITORY,repositoryId:String(run.repository.id),workflowPath:NEWS_WORKFLOW,workflowId:String(run.workflow_id),runId:String(run.id),runNumber:run.run_number,runAttempt:1,sha:run.head_sha,ref:'refs/heads/main'};
  keys(plan,['version','current','predecessor','cacheKey','predecessorCacheKey','events']);
  assert.equal(plan.version,3); keys(plan.events,['current','predecessor']);
  assert.deepEqual(plan.current,identity); assert.equal(plan.events.current,'schedule');
  assert.ok(['schedule','workflow_dispatch'].includes(plan.events.predecessor));
  assert.match(plan.predecessor.runId,/^[1-9][0-9]*$/); assert.notEqual(plan.predecessor.runId,identity.runId);
  assert.match(plan.predecessor.sha,/^[a-f0-9]{40}$/);
  const predecessor={...identity,runId:plan.predecessor.runId,runNumber:run.run_number-1,sha:plan.predecessor.sha};
  assert.deepEqual(plan.predecessor,predecessor);
  if(predecessor.runNumber===1) assert.equal(plan.events.predecessor,'workflow_dispatch');
  assert.equal(plan.cacheKey,cacheKey(identity)); assert.equal(plan.predecessorCacheKey,cacheKey(predecessor));
  const priorReceipt=JSON.parse(entries['news-preview-predecessor.json']);
  // The prior payload is not in this artifact: check receipt/plan consistency,
  // not an invented revalidation of unavailable predecessor payload bytes.
  assert.deepEqual(priorReceipt,{version:3,kind:'news_preview_final',identity:predecessor,cacheKey:cacheKey(predecessor),payloadSha256:hash(priorReceipt.payloadSha256),transportDecisionsDrained:true,payloadCacheVerified:true});
  verifyFinalReceipt(receipt,identity,entries['news-preview.json']);
  assert.deepEqual(collected,{version:3,kind:'news_preview_collected',identity,payloadSha256:receipt.payloadSha256,transportDecisionsDrained:true});
  assert.equal(payload.version,2); assert.equal(payload.disposition,'nonpublishable_requires_review'); assert.ok(Array.isArray(payload.candidates));
  assert.ok(Array.isArray(payload.diagnostics) && payload.diagnostics.length>0 && payload.diagnostics.length<=20);
  assert.equal(new Set(payload.diagnostics.map(d=>d.sourceId)).size,payload.diagnostics.length);
  assert.deepEqual(payload.diagnostics.map(d=>d.sourceId).sort(),registry.sources.map(s=>s.id).sort());
  const sources=payload.diagnostics.map(d=>{
    const source=registry.sources.find(s=>s.id===d.sourceId);
    const configHash=payloadDigest(JSON.stringify([source.id,source.feedUrl,source.allowedHosts,source.source_type]));
    assert.equal(d.configHash,configHash,'news health source configuration mismatch');
    assert.equal(d.sourceHost,new URL(source.feedUrl||source.homeUrl).hostname,'news health source host mismatch');
    assert.ok(['disabled','pending_review','not_modified','failed_preserved','access_held'].includes(d.status)); assert.equal(typeof d.accessHeld,'boolean');
    const lastAttemptAt=normalized(d.lastAttemptAt),lastSuccessAt=normalized(d.lastSuccessAt),retryNotBefore=normalized(d.retryNotBefore);
    for(const value of [lastAttemptAt,lastSuccessAt]) if(value!==null) assert.ok(stamp(value)<=completed,'source clock beyond completed run');
    if(lastSuccessAt!==null) assert.ok(lastAttemptAt!==null && stamp(lastSuccessAt)<=stamp(lastAttemptAt));
    if(['pending_review','not_modified'].includes(d.status)){
      assert.equal(source.enabled,true); assert.equal(d.accessHeld,false); assert.equal(retryNotBefore,null);
      assert.ok(lastAttemptAt!==null && stamp(lastAttemptAt)>=started); assert.equal(lastSuccessAt,lastAttemptAt);
    }
    if(d.status==='access_held') assert.equal(d.accessHeld,true);
    if(d.status==='disabled') assert.equal(source.enabled,false);
    return {sourceId:d.sourceId,sourceHost:d.sourceHost,configHash,enabled:source.enabled,status:d.status,lastAttemptAt,lastSuccessAt,accessHeld:d.accessHeld,retryNotBefore};
  }).sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  const projection={version:1,kind:'reviewed_news_health_snapshot',scope:'Published receipt snapshot, not live monitoring. Collection checks are not content publication, candidate approval, or proof of on-time scheduling.',run:{id:String(run.id),number:run.run_number,attempt:1,sha:run.head_sha,event:run.event,url:`https://github.com/${NEWS_REPOSITORY}/actions/runs/${run.id}`,completedAt:new Date(completed).toISOString()},reviewedAt:manifest.reviewedAt,artifactId:String(artifact.id),artifactSha256:manifest.files['artifact.zip'],payloadSha256:receipt.payloadSha256,sources};
  verified.add(projection); return freeze(projection);
}
export async function loadNewsHealth(root=new URL('../../',import.meta.url),registry){
  let manifest;
  try { manifest=JSON.parse(await readFile(new URL(NEWS_HEALTH_MANIFEST,root),'utf8')); }
  catch(error){ if(error.code==='ENOENT') return null; throw error; }
  assert.match(manifest.runId,/^[1-9][0-9]*$/);
  const files={}; for(const name of ['artifact.zip','run.json','artifact.json','jobs.json']) files[name]=await readFile(new URL(`news-evidence/runs/${manifest.runId}/${name}`,root));
  registry ||= JSON.parse(await readFile(new URL('data/news-source-registry.json',root),'utf8'));
  return projectNewsHealth({manifest,files,registry});
}
