// Independent adversarial regressions: synthetic inputs only, never source or skill evidence.
// Registry activation is in-memory; every network entry point used by source adapters is denied.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const denyNetwork = () => assert.fail('Network forbidden in synthetic weather regressions');
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = denyNetwork;
syncBuiltinESMExports();
const {aggregateModels,coreHeadline,probability} = await import('./lib/weather-aggregation.mjs');
const {scoreIssuedCandidate,pairedProspectiveReport,eligibleTrainingScores,trainingScope,shrinkageBiasShadow} = await import('./lib/weather-evaluation.mjs');
const original = JSON.parse(readFileSync(new URL('../data/weather-model-registry.json', import.meta.url)));
const locations = JSON.parse(readFileSync(new URL('../data/weather-locations.json', import.meta.url)));
assert.equal(original.liveCollectionEnabled, false);
assert.ok(original.sources.every(source => !source.enabled));
assert.ok(original.models.every(model => !model.enabled));
const results = [];
function test(name, fn) {
  try { fn(); results.push({name, passed: true}); }
  catch (error) { results.push({name, passed: false, error: error.message}); }
}

// Aggregation adversaries, with a deliberately small synthetic ensemble.
{
const registry = structuredClone(original);
for(const id of ['gem_geps','gfs','ecmwf_ifs'])registry.models.find(x=>x.id===id).enabled=true;
for(const s of registry.sources)if(['eccc','noaa','ecmwf'].includes(s.id)){s.enabled=true;s.accessState='admitted_review_only';}
const geps=registry.models.find(x=>x.id==='gem_geps');geps.memberIdentityStatus='verified';geps.memberIds=['synthetic-control','synthetic-member'];
const point=locations.points[0],issuedAt='2026-10-28T10:00:00Z';
const base={version:1,kind:'model_forecast',locationId:point.id,latitude:point.latitude,longitude:point.longitude,modelVersion:'v1',sourceBodySha256:'a'.repeat(64),receiptId:'r1',support:{kind:'model_at_reviewed_point',locationId:point.id,method:'nearest_grid_point',methodEvidenceId:'m1',spatialFootprintId:'fixture-grid'},memberId:null,variable:'temperature_2m',unit:'C',validStart:'2026-10-28T12:00:00Z',validEnd:'2026-10-28T12:00:00Z',modelReferenceTime:'2026-10-28T06:00:00Z',firstRetrievedAt:'2026-10-28T07:00:00Z',firstAvailableAt:'2026-10-28T06:30:00Z',value:10};
const row=(id,p={})=>{const m=registry.models.find(x=>x.id===id);return {...base,modelId:id,sourceId:m.sourceId,dependencyGroup:m.dependencyGroup,...p}};
const target={locationId:point.id,variable:base.variable,unit:'C',validStart:base.validStart,validEnd:base.validEnd,eventDefinition:null};
const run=rows=>aggregateModels({rows,registry,locations,issuedAt,targets:[target]});
const newer={modelReferenceTime:'2026-10-28T09:00:00Z',firstAvailableAt:'2026-10-28T09:20:00Z',firstRetrievedAt:'2026-10-28T09:30:00Z',value:null};
test('all-null newest ensemble never silently uses older run',()=>{
 const result=run([...geps.memberIds.map(memberId=>row('gem_geps',{memberId,value:0})),...geps.memberIds.map(memberId=>row('gem_geps',{memberId,...newer})),row('gfs',{value:10})]);assert.equal(result.outputs[0].prediction,null);assert.equal(result.outputs[0].status,'unavailable');
});
test('null newest deterministic never silently uses older run',()=>{
 const result=run([row('gfs',{value:0}),row('gfs',newer),row('ecmwf_ifs',{value:10})]);assert.equal(result.outputs[0].prediction,null);
});
test('same-issued conflicting model versions reject regardless input order',()=>{
 const rows=[row('gfs',{value:0,modelVersion:'v1'}),row('gfs',{value:20,modelVersion:'v2',receiptId:'r2'}),row('ecmwf_ifs',{value:10})];assert.throws(()=>run(rows));assert.throws(()=>run(rows.slice().reverse()));
});
test('three-point headline never mixes precipitation event thresholds',()=>{
 const targets=locations.points.slice(0,3).map((p,i)=>({locationId:p.id,variable:'precipitation_probability',unit:'fraction',validStart:'2026-10-28T11:00:00Z',validEnd:'2026-10-28T12:00:00Z',eventDefinition:{kind:'precipitation_at_least',thresholdMm:i===1?1:0.1,intervalMinutes:60}}));
 const rows=targets.flatMap(t=>['gfs','ecmwf_ifs'].map(id=>{const p=locations.points.find(p=>p.id===t.locationId);return row(id,{...t,latitude:p.latitude,longitude:p.longitude,unit:'percent',value:50,support:{...base.support,locationId:p.id}})}));
 const result=aggregateModels({rows,registry,locations,issuedAt,targets});assert.equal(coreHeadline(result,locations,{variable:'precipitation_probability',validStart:targets[0].validStart,validEnd:targets[0].validEnd}).value,null);
});
test('probability unit required even for missing value',()=>assert.throws(()=>probability(null,'unknown')));
test('duplicate target identity rejected',()=>assert.throws(()=>aggregateModels({rows:[row('gfs'),row('ecmwf_ifs')],registry,locations,issuedAt,targets:[target,{...target}]})));
test('equivalent UTC spellings cannot create duplicate semantic targets', () => {
 const duplicate = {...target, validStart: '2026-10-28T12:00:00.000Z', validEnd: '2026-10-28T12:00:00.000Z'};
 assert.throws(() => aggregateModels({rows: [], registry, locations, issuedAt, targets: [target, duplicate]}));
});
test('instantaneous variable cannot have interval target',()=>assert.throws(()=>aggregateModels({rows:[],registry,locations,issuedAt,targets:[{...target,validStart:'2026-10-28T11:00:00Z'}]})));
test('known model dependency group cannot be changed in registry alone',()=>{
 const mutated=structuredClone(registry);mutated.models.find(x=>x.id==='gfs').dependencyGroup='made_up_extra_family';assert.throws(()=>aggregateModels({rows:[],registry:mutated,locations,issuedAt,targets:[target]}));
});
test('ordinary input reordering preserves issued candidate identity',()=>{const rows=[row('gfs',{value:0}),row('ecmwf_ifs',{value:10})];assert.equal(run(rows).outputs[0].candidate.id,run(rows.slice().reverse()).outputs[0].candidate.id);});
test('equivalent UTC clock spellings cannot hide conflicting same-cycle revision', () => {
 const rows = [row('gfs', {value: 0}), row('gfs', {value: 20, modelReferenceTime: '2026-10-28T06:00:00.000Z', receiptId: 'r2'}), row('ecmwf_ifs', {value: 10})];
 assert.throws(() => run(rows));
 assert.throws(() => run(rows.slice().reverse()));
});
}

// Exact-target, receipt-timed prospective evaluation adversaries.
{
const registry = structuredClone(original);
for(const m of registry.models)m.enabled=['gfs','ecmwf_ifs'].includes(m.id);for(const s of registry.sources){s.enabled=['noaa','ecmwf'].includes(s.id);if(s.enabled)s.accessState='admitted_review_only';}
const p=locations.points[0];
function bundle({day='2026-10-01',value=10,rain=false}={}){
 const issuedAt=day+'T10:00:00Z',start=day+'T12:00:00Z',end=day+(rain?'T13:00:00Z':'T12:00:00Z'),event=rain?{kind:'precipitation_at_least',thresholdMm:.1,intervalMinutes:60}:null;
 const target={locationId:p.id,variable:rain?'precipitation_probability':'temperature_2m',unit:rain?'fraction':'C',validStart:start,validEnd:end,eventDefinition:event};
 const rows=['gfs','ecmwf_ifs'].map(modelId=>{const m=registry.models.find(x=>x.id===modelId);return {version:1,kind:'model_forecast',modelId,modelVersion:'fixture-v1',sourceId:m.sourceId,dependencyGroup:m.dependencyGroup,locationId:p.id,latitude:p.latitude,longitude:p.longitude,support:{kind:'model_at_reviewed_point',locationId:p.id,method:'nearest_grid_point',methodEvidenceId:'fixture-method',spatialFootprintId:'fixture-cell'},sourceBodySha256:'a'.repeat(64),receiptId:'fixture-'+modelId+'-'+day,modelReferenceTime:day+'T06:00:00Z',firstAvailableAt:day+'T07:00:00Z',firstRetrievedAt:day+'T07:01:00Z',validStart:start,validEnd:end,memberId:null,variable:target.variable,unit:target.unit,eventDefinition:event,value};});
 const candidate=aggregateModels({rows,targets:[target],registry,locations,issuedAt}).outputs[0].candidate;
 const truth={version:1,kind:'observation',locationId:p.id,latitude:p.latitude,longitude:p.longitude,support:{kind:'observation_at_exact_point',locationId:p.id,instrumentId:'fixture-instrument'},receiptId:'truth-fixture-'+day,sourceBodySha256:'b'.repeat(64),quality:'accepted',validStart:start,validEnd:end,firstAvailableAt:day+'T13:01:00Z',firstRetrievedAt:day+'T13:02:00Z',variable:rain?'precipitation_amount':'temperature_2m',unit:rain?'mm':'C',value:rain?0:9};
 const options={registry,locations,scoredAt:day+'T13:03:00Z'};return {candidate,truth,options,score:scoreIssuedCandidate(candidate,truth,options)};
}
const fixture=bundle();
test('finite but overflowing truth rejected',()=>assert.throws(()=>scoreIssuedCandidate(fixture.candidate,{...fixture.truth,value:Number.MAX_VALUE},fixture.options)));
test('physically out-of-range temperature rejected',()=>assert.throws(()=>scoreIssuedCandidate(fixture.candidate,{...fixture.truth,value:-1000},fixture.options)));
test('training scope excludes another registry epoch',()=>{const t={...fixture.candidate.target,validStart:'2026-10-28T12:00:00Z',validEnd:'2026-10-28T12:00:00Z'},scope={...trainingScope(fixture.candidate),registrySha256:'c'.repeat(64)};assert.equal(eligibleTrainingScores([fixture.score],{issuedAt:'2026-10-28T10:00:00Z',target:t,leadHours:2,scope}).length,0);});
test('duplicate score cannot change training sample weight',()=>{const t={...fixture.candidate.target,validStart:'2026-10-28T12:00:00Z',validEnd:'2026-10-28T12:00:00Z'},scope=trainingScope(fixture.candidate);assert.throws(()=>eligibleTrainingScores([fixture.score,fixture.score],{issuedAt:'2026-10-28T10:00:00Z',target:t,leadHours:2,scope}));});
test('post-issue received truth excluded despite earlier valid time',()=>{const t={...fixture.candidate.target,validStart:'2026-10-01T15:00:00Z',validEnd:'2026-10-01T15:00:00Z'};assert.equal(eligibleTrainingScores([fixture.score],{issuedAt:'2026-10-01T13:01:30Z',target:t,leadHours:2,scope:trainingScope(fixture.candidate)}).length,0);});
test('different-variable top-level metric cohort rejected',()=>{const rain=bundle({rain:true,value:.2});assert.throws(()=>pairedProspectiveReport([fixture.score,rain.score],[fixture.score,rain.score]));});
test('probability paired delta is Brier, not absolute error',()=>{const x=bundle({rain:true,value:.2}),y=bundle({rain:true,value:.4}),r=pairedProspectiveReport([x.score],[y.score]);assert.equal(r.loss,'brier');assert.ok(Math.abs(r.pairedDayMeanLossDelta-(-.12))<1e-12);assert.equal(r.accuracyImprovementEstablished,false);});
test('weekly-only days cannot masquerade as three-day bootstrap blocks',()=>{const scores=Array.from({length:30},(_,i)=>bundle({day:new Date(Date.UTC(2025,0,1)+i*7*86400000).toISOString().slice(0,10)}).score);assert.equal(pairedProspectiveReport(scores,scores).interval,null);});
test('dense diagnostic interval remains non-promoting',()=>{const scores=Array.from({length:35},(_,i)=>bundle({day:new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10)}).score);const r=pairedProspectiveReport(scores,scores);assert.ok(r.interval);assert.equal(r.automaticPromotion,false);assert.equal(r.accuracyImprovementEstablished,false);});

// Calibration remains a bounded shadow, with pre-issue, version-scoped truth only.
const daily = Array.from({length: 20}, (_, i) => bundle({
  day: new Date(Date.UTC(2026, 9, 1) + i * 86400000).toISOString().slice(0, 10)
}).score);
const shadowOptions = {
  issuedAt: '2026-10-28T10:00:00Z',
  target: {...fixture.candidate.target, validStart: '2026-10-28T12:00:00Z', validEnd: '2026-10-28T12:00:00Z'},
  leadHours: 2,
  scope: trainingScope(fixture.candidate)
};
test('nineteen eligible days cannot activate even shadow correction', () => {
  const result = shrinkageBiasShadow(daily.slice(0, 19), shadowOptions);
  assert.equal(result.status, 'learning');
  assert.equal(result.days, 19);
  assert.equal(result.correctionC, null);
  assert.equal(result.automaticPromotion, false);
});
test('twenty-day bias is shrunk toward zero and stays non-promoting', () => {
  const result = shrinkageBiasShadow(daily, shadowOptions);
  assert.equal(result.status, 'shadow_available');
  assert.equal(result.days, 20);
  assert.equal(result.correctionC, -0.5); // error 1 C, prior strength 20 days.
  assert.equal(result.trainingScoreIds.length, 20);
  assert.equal(result.trainingCutoffExclusive, shadowOptions.issuedAt);
  assert.equal(result.role, 'shadow_only');
  assert.equal(result.automaticPromotion, false);
  assert.equal(result.accuracyClaim, null);
});
test('large twenty-day bias cannot exceed two-degree shadow correction bound', () => {
  const large = Array.from({length: 20}, (_, i) => bundle({
    day: new Date(Date.UTC(2026, 9, 1) + i * 86400000).toISOString().slice(0, 10), value: 30
  }).score);
  assert.equal(shrinkageBiasShadow(large, shadowOptions).correctionC, -2);
  assert.equal(shrinkageBiasShadow(large, {...shadowOptions, maxCorrection: 1}).correctionC, -1);
  assert.throws(() => shrinkageBiasShadow(large, {...shadowOptions, maxCorrection: 2.01}));
  assert.throws(() => shrinkageBiasShadow(large, {...shadowOptions, minimumDays: 19}));
});
test('twenty-day archive from another registry epoch supplies no shadow evidence', () => {
  const result = shrinkageBiasShadow(daily, {
    ...shadowOptions, scope: {...shadowOptions.scope, registrySha256: 'c'.repeat(64)}
  });
  assert.equal(result.days, 0);
  assert.equal(result.correctionC, null);
});
test('truth not received by shadow issuance cannot become the twentieth training day', () => {
  const result = shrinkageBiasShadow(daily, {
    ...shadowOptions,
    issuedAt: '2026-10-20T13:01:30Z',
    target: {...shadowOptions.target, validStart: '2026-10-20T15:01:30Z', validEnd: '2026-10-20T15:01:30Z'}
  });
  assert.equal(result.days, 19);
  assert.equal(result.correctionC, null);
});
test('duplicate day score cannot inflate shadow learning weight', () => {
  assert.throws(() => shrinkageBiasShadow([...daily, daily[0]], shadowOptions));
});
}
console.log(JSON.stringify({syntheticOnly: true, networkRequests: 0, results}, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
