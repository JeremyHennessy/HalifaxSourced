import assert from 'node:assert/strict';
import {meaningfulHash,sourceEntry,freshness} from './lib/update-consistency.mjs';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const sample={generatedAt:'2026-10-01',range:{start:'2026-10-01'},sanitizedAt:'2026-10-01',supplementalAt:'2026-10-01',
  manualAdditions:{appliedAt:'2026-10-01',eventCount:1},entityResolution:{appliedAt:'2026-10-01',venueResolved:1},
  events:[{id:'a',observedAt:'2026-10-01',startAt:'2026-11-01',title:'One'}]};
const hash=value=>meaningfulHash(JSON.stringify(value));
const receipts={...sample,generatedAt:'2026-10-20',range:{start:'2026-10-20'},sanitizedAt:'2026-10-20',supplementalAt:'2026-10-20',
  manualAdditions:{...sample.manualAdditions,appliedAt:'2026-10-20'},entityResolution:{...sample.entityResolution,appliedAt:'2026-10-20'},
  events:[{...sample.events[0],observedAt:'2026-10-20'}]};
assert.equal(hash(sample),hash(receipts));
assert.notEqual(hash(sample),hash({...sample,events:[{...sample.events[0],startAt:'2026-11-02'}]}));
assert.notEqual(hash(sample),hash({...sample,events:[{...sample.events[0],status:'cancelled'}]}));
assert.notEqual(hash(sample),hash({...sample,entityResolution:{...sample.entityResolution,venueResolved:0}}));
for (const key of ['verifiedAt','reviewedAt','expiresAt','validTo','appliedAt']) assert.notEqual(hash({[key]:'2026-10-01'}),hash({[key]:'2026-10-20'}));
assert.notEqual(hash({review:{appliedAt:'2026-10-01'}}),hash({review:{appliedAt:'2026-10-20'}}));
const retainedReceipt={events:[{...sample.events[0],refreshState:'retained_after_source_failure',sourceFailure:{sourceId:'one',reason:'http_403',attemptedAt:'2026-10-01',previousGeneratedAt:'2026-09-30'}}]};
const newerRetention=structuredClone(retainedReceipt);
newerRetention.events[0].sourceFailure.attemptedAt='2026-10-20';newerRetention.events[0].sourceFailure.previousGeneratedAt='2026-10-01';
assert.equal(hash(retainedReceipt),hash(newerRetention),'Repeated identical failed attempts are receipt-only changes.');
newerRetention.events[0].sourceFailure.reason='timeout';
assert.notEqual(hash(retainedReceipt),hash(newerRetention),'Changed failure reason remains meaningful.');

assert.equal(meaningfulHash('window.HALIFAX_EVENTS = '+JSON.stringify(sample)+';'),hash(sample));
assert.notEqual(meaningfulHash('not json1'),meaningfulHash('not json2'));

const base={id:'events',label:'Events',path:'fixture',targetHours:6,now:'2026-10-20T12:00:00Z',sourceCommitSha:'a'.repeat(40)};
const lane=sourceEntry({...base,sourceStats:true,payload:{generatedAt:'2026-10-20T12:00:00Z',events:sample.events,
  sourceStats:[{sourceId:'one',status:'ok',observedAt:'2026-10-01'},{sourceId:'two',status:'failed',observedAt:'2026-10-20'}]}});
assert.equal(lane.lastSuccessfulObservationAt,'2026-10-01T00:00:00.000Z');
assert.equal(lane.lastAttemptAt,'2026-10-20T00:00:00.000Z');
assert.equal(lane.reviewedAt,null);assert.equal(lane.sources.find(row=>row.id==='two').lastSuccessfulObservationAt,null);
assert.equal(lane.freshness,'stale','An outage must not downgrade stale evidence to a warning.');
assert.equal(lane.nextDueAt,'2026-10-01T06:00:00.000Z');

const mixed=sourceEntry({...base,payload:{results:[
  {restaurantId:'old',status:200,observedAt:'2026-10-01'},
  {restaurantId:'new',status:200,observedAt:'2026-10-20T11:00:00Z'},
  {restaurantId:'denied',status:403,observedAt:'2026-10-20T11:15:00Z'},
  {restaurantId:'restricted',error:'robots_disallow',observedAt:'2026-10-20T11:20:00Z'},
  {restaurantId:'timeout',error:'timeout',observedAt:'2026-10-20T11:30:00Z'}]}});
assert.equal(mixed.lastSuccessfulObservationAt,'2026-10-20T11:00:00.000Z');
assert.equal(mixed.lastAttemptAt,'2026-10-20T11:30:00.000Z');
assert.equal(mixed.oldestSuccessfulObservationAt,'2026-10-01T00:00:00.000Z');
assert.equal(mixed.nextDueAt,'2026-10-01T06:00:00.000Z','New success must not defer old evidence.');
assert.equal(mixed.failures.length,3);assert.equal(mixed.observationCount,2);
assert.equal(mixed.sources.find(row=>row.id==='restricted').lastSuccessfulObservationAt,null);
assert.equal(mixed.freshness,'stale');

const retained=sourceEntry({...base,sourceStats:true,payload:{events:[{sourceId:'one',observedAt:'2026-10-01'},{sourceId:'two',observedAt:'2026-10-02'}],
  sourceStats:[{sourceId:'one',status:'ok',observedAt:'2026-10-20T11:00:00Z'},{sourceId:'two',status:'failed',reason:'http_403',observedAt:'2026-10-20T11:30:00Z'}],
  failures:[{sourceId:'two',reason:'http_403'}]}});
assert.equal(retained.oldestSuccessfulObservationAt,'2026-10-01T00:00:00.000Z');
assert.equal(retained.freshness,'stale');assert.equal(retained.failures.length,1);
assert.equal(retained.failures[0].lastAttemptAt,'2026-10-20T11:30:00.000Z');
assert.equal(retained.sources.find(row=>row.id==='two').lastSuccessfulObservationAt,'2026-10-02T00:00:00.000Z','Failed source keeps original accepted evidence age.');

const facts=sourceEntry({...base,payload:{records:[{restaurantId:'kept',observedAt:'2026-10-01'}],
  refreshObservations:[{restaurantId:'kept',state:'failed',checkedAt:'2026-10-20T11:00:00Z',reason:'timeout',attempted:true},
    {restaurantId:'restricted',state:'blocked',checkedAt:'2026-10-20T12:00:00Z',reason:'http_403',attempted:false}],
  failures:[{restaurantId:'kept',reason:'timeout',checkedAt:'2026-10-20T11:00:00Z',attempted:true}]}});
assert.equal(facts.lastAttemptAt,'2026-10-20T11:00:00.000Z','Skipped restrictions do not claim new attempts.');
assert.equal(facts.lastSuccessfulObservationAt,'2026-10-01T00:00:00.000Z');
assert.equal(facts.failures.length,2);assert.equal(facts.sources.find(row=>row.id==='restricted').lastAttemptAt,null);
const unknownFailure=sourceEntry({...base,payload:{records:[{restaurantId:'one',observedAt:'2026-10-01'}],failures:[{restaurantId:'two',reason:'timeout'}]}});
assert.equal(unknownFailure.lastAttemptAt,null,'An undated failure cannot be reported as an old successful attempt.');
assert.equal(unknownFailure.latestRecordedAttemptAt,'2026-10-01T00:00:00.000Z');
const refreshed=sourceEntry({...base,payload:{records:[{restaurantId:'one',observedAt:'2026-10-20T11:00:00Z'}],
  refreshObservations:[{restaurantId:'one',state:'unchanged',checkedAt:'2026-10-20T11:30:00Z',attempted:true}]}});
assert.equal(refreshed.lastSuccessfulObservationAt,'2026-10-20T11:30:00.000Z');
assert.equal(refreshed.oldestSuccessfulObservationAt,'2026-10-20T11:00:00.000Z');
const social=sourceEntry({...base,payload:{generatedAt:'2026-10-20',posts:[],signals:[],failures:[{platform:'facebook',reason:'missing_credentials'}]}});
assert.equal(social.failures.length,1);assert.equal(social.lastAttemptAt,null);assert.equal(social.lastSuccessfulObservationAt,null);assert.equal(social.freshness,'unknown');
const future=sourceEntry({...base,payload:{records:[{observedAt:'2026-10-20T11:00:00Z'},{observedAt:'2026-11-20'}]}});
assert.equal(future.unknownObservationCount,1);assert.equal(future.freshness,'unknown');assert.equal(future.nextDueAt,null);
const missing=sourceEntry({...base,payload:{records:[{observedAt:'2026-10-20T11:00:00Z'},{}]}});
assert.equal(missing.freshness,'unknown');assert.equal(missing.nextDueAt,null);
const partialFailure=sourceEntry({...base,payload:{results:[{status:200,observedAt:'2026-10-20T11:00:00Z'},{status:403,observedAt:'2026-10-20T11:00:00Z'}]}});
assert.equal(partialFailure.freshness,'warn');
assert.equal(freshness(null,'2026-10-20',6),'unknown');
assert.equal(freshness('2026-10-20T11:00:00Z','2026-10-20T12:00:00Z',6),'fresh');
assert.equal(freshness('2026-10-20T01:00:00Z','2026-10-20T12:00:00Z',6),'warn');
assert.equal(freshness('2026-10-18','2026-10-20',6),'stale');
assert.equal(freshness('2026-10-18','not a date',6),'unknown');
assert.equal(freshness('2026-10-18','2026-10-20',0),'unknown');

// Exercise the real promotion entry point with a complete event artifact. A hash
// unit test alone would miss timestamp churn in a companion file or metadata.
const temporary=mkdtempSync(join(tmpdir(),'halifax-consistency-'));
try {
  const destination=join(temporary,'destination'),artifact=join(temporary,'artifact'),receipt=join(temporary,'receipt.json');
  const put=(root,path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  const bundle=(root,payload)=>{
    put(root,'data/build/city-events.json',JSON.stringify(payload));
    put(root,'data/city-events.js',`window.HALIFAX_CITY_EVENTS = ${JSON.stringify(payload)};\n`);
    put(root,'data/build/event-entity-resolution.json',JSON.stringify({generatedAt:payload.generatedAt,eventCount:1,resolutions:[{eventId:'a',venueId:'one'}]}));
  };
  bundle(destination,sample);bundle(artifact,receipts);
  put(destination,'data/build/preview-promotion-metadata.json','{"accepted":"unchanged"}\n');
  const paths=['data/build/city-events.json','data/city-events.js','data/build/event-entity-resolution.json','data/build/preview-promotion-metadata.json'];
  const before=paths.map(path=>readFileSync(join(destination,path),'utf8'));
  const promote=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./promote-preview-artifacts.mjs',import.meta.url))],{
    cwd:destination,encoding:'utf8',env:{...process.env,ARTIFACT_DIR:artifact,ARTIFACT_NAME:'city-events-preview',PROMOTION_RESULT_PATH:receipt}
  });
  let result=promote();assert.equal(result.status,0,result.stderr);
  assert.deepEqual(paths.map(path=>readFileSync(join(destination,path),'utf8')),before);
  assert.equal(JSON.parse(readFileSync(receipt)).changed,false);
  bundle(artifact,{...receipts,events:[{...receipts.events[0],title:'Changed event'}]});
  result=promote();assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(readFileSync(receipt)).changed,true);
  assert.equal(JSON.parse(readFileSync(join(destination,'data/build/preview-promotion-metadata.json'))).state,'prepared-for-review');
} finally {rmSync(temporary,{recursive:true,force:true});}

const context=vm.createContext({window:{},URL,Date,Intl,console});
vm.runInContext(readFileSync(new URL('../app-admin-status.js',import.meta.url),'utf8'),context);
const ledger={sourceCommitSha:'a',scope:'Fixture',lanes:[{...lane,label:'<script>unsafe</script>'}],queue:[],policy:{}};
const html=context.renderUpdateLedger({deployment:{sourceCommitSha:'a'},updateLedger:ledger});
assert.ok(!html.includes('<script>unsafe'));assert.match(html,/Unknown \/ not recorded/);
assert.match(context.renderUpdateLedger({deployment:{sourceCommitSha:'b'},updateLedger:ledger}),/lineage mismatch/);
const policy=JSON.parse(readFileSync(new URL('../data/update-policy.json',import.meta.url)));
assert.ok(new Set(policy.lanes.map(l=>l.targetHours)).size>1);assert.ok(policy.lanes.every(l=>l.targetHours>0));
console.log('Update consistency regressions passed: complete-bundle semantic no-op, meaningful changes, honest retained/failed/unknown clocks, conservative due dates, lineage and escaping.');

const dateOnlyHtml=context.renderUpdateLedger({deployment:{sourceCommitSha:"a"},updateLedger:{...ledger,reviewedBatches:[{id:"dated",reviewedAt:"2026-10-20",scope:"Recorded correction dates only"}]}});
assert.match(dateOnlyHtml,/2026-10-20 \(date only\)/);
assert.match(dateOnlyHtml, /<li>dated · 2026-10-20 \(date only\) · Recorded correction dates only<\/li>/);
