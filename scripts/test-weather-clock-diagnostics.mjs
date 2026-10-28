// Fixed regressions and mocked transport only; no failed-source retry or state migration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectEccc,acceptedEnvelope,hash} from './lib/eccc-weather.mjs';
import {collectEcccReview} from './lib/eccc-weather-adapter.mjs';
const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
const originalBody=await read('scripts/fixtures/weather/eccc-citypage-20261028.json'),originalReceipt=JSON.parse(await read('scripts/fixtures/weather/eccc-citypage-20261028-receipt.json'));
const raw=JSON.parse(originalBody),previous=acceptedEnvelope(projectEccc(originalBody,originalReceipt),originalReceipt),registry=JSON.parse(await read('data/weather-source-registry.json'));registry.sources[0].enabled=true;
const future=new Date(Date.parse(originalReceipt.retrievedAt)+1).toISOString();let groups=0;
const changed=mutate=>{const data=structuredClone(raw),receipt=structuredClone(originalReceipt);mutate(data,receipt);const body=JSON.stringify(data);receipt.bodyBytes=Buffer.byteLength(body);receipt.sha256=hash(body);return {body,receipt};};
const cases=[
 ['receipt.attemptedAt','acquisition_request',(j,r)=>r.attemptedAt=future],
 ['receipt.responseAt','acquisition_response',(j,r)=>r.responseAt=future],
 ['FeatureCollection.timeStamp','api_response_generated_at',j=>j.timeStamp=future],
 ...['ns-19','ns-40'].flatMap(id=>[
  ['lastUpdated','source_updated_at',p=>p.lastUpdated=future],
  ['currentConditions.timestamp.en','station_observed_at',p=>p.currentConditions.timestamp.en=future],
  ['forecastGroup.timestamp.en','regional_forecast_issued_at',p=>p.forecastGroup.timestamp.en=future],
  ['hourlyForecastGroup.timestamp.en','hourly_forecast_issued_at',p=>p.hourlyForecastGroup.timestamp.en=future]
 ].map(([field,role,mutate])=>[`features[${id}].properties.${field}`,role,j=>mutate(j.features.find(f=>f.id===id).properties)]))
];
for(const [path,role,mutate]of cases){const {body,receipt}=changed(mutate);assert.throws(()=>projectEccc(body,receipt),error=>{assert.equal(error.code,'ERR_ASSERTION');assert.match(error.message,/future source clock/);assert.deepEqual(error.weatherClock,{kind:'future_source_clock',path,role,value:future,retrievedAt:originalReceipt.retrievedAt,aheadByMilliseconds:1});return true;});}groups++;
const valid=projectEccc(originalBody,originalReceipt);assert.equal(valid.forecast.hourly.length,24);assert.ok(valid.forecast.hourly.every(h=>Date.parse(h.validAt)>Date.parse(originalReceipt.retrievedAt)));assert.equal(valid.forecast.hourly.at(-1).validAt,'2026-10-29T00:00:00Z');groups++;
const temp=await fs.mkdtemp(join(tmpdir(),'weather-clock-diagnostics-')),fetch=globalThis.fetch,open=fs.open;
try{
 let calls=0;const rejected=changed(j=>j.timeStamp='2099-01-01T00:00:00Z').body,path=join(temp,'rejected.jsonl');
 globalThis.fetch=async()=>{calls++;return new Response(rejected,{headers:{'content-type':'application/json','set-cookie':'must-not-retain-cookie'}});};
 const result=await collectEcccReview({registry,previous,journalPath:path});assert.equal(calls,1);assert.equal(result.candidate.lastAttempt.status,'failed');assert.strictEqual(result.candidate.lastKnownGood,previous.lastKnownGood);assert.equal(result.body,undefined);
 const events=(await fs.readFile(path,'utf8')).trim().split('\n').map(JSON.parse),failure=events.at(-1),evidenceText=await fs.readFile(path+'.response.json','utf8'),evidence=JSON.parse(evidenceText),bytes=Buffer.from(evidence.bodyBase64,'base64');
 assert.equal(evidence.kind,'unaccepted_eccc_complete_response_evidence');assert.equal(evidence.semanticAcceptance,false);assert.equal(bytes.toString('utf8'),rejected);assert.equal(hash(bytes),evidence.receipt.sha256);assert.equal(bytes.length,evidence.receipt.bodyBytes);assert.equal(failure.response.sha256,evidence.receipt.sha256);assert.equal(failure.response.evidenceRetained,true);assert.equal(failure.clockViolation.path,'FeatureCollection.timeStamp');assert.equal(failure.clockViolation.retrievedAt,evidence.receipt.retrievedAt);assert.doesNotMatch(evidenceText,/must-not-retain-cookie|set-cookie/);groups++;
 await assert.rejects(()=>collectEcccReview({registry,previous,journalPath:path}),/EEXIST/);assert.equal(calls,1);assert.equal(await fs.readFile(path+'.response.json','utf8'),evidenceText);groups++;
 for(const [name,bytes]of [['invalid-utf8',Buffer.from([0xff,0xfe])],['bom',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(originalBody)])]]){globalThis.fetch=async()=>new Response(bytes,{headers:{'content-type':'application/json'}});const path=join(temp,name+'.jsonl'),r=await collectEcccReview({registry,previous,journalPath:path});assert.equal(r.candidate.lastAttempt.status,'failed');const e=JSON.parse(await fs.readFile(path+'.response.json'));assert.deepEqual(Buffer.from(e.bodyBase64,'base64'),bytes);assert.equal(e.receipt.sha256,hash(bytes));}groups++;
 const partial=join(temp,'incomplete.jsonl');globalThis.fetch=async()=>new Response('short',{headers:{'content-type':'application/json','content-length':'100'}});const incomplete=await collectEcccReview({registry,previous,journalPath:partial});assert.equal(incomplete.candidate.lastAttempt.status,'failed');await assert.rejects(()=>fs.stat(partial+'.response.json'),{code:'ENOENT'});groups++;
 const encoded=join(temp,'decoded-http-encoding.jsonl');globalThis.fetch=async()=>new Response(originalBody,{headers:{'content-type':'application/json','content-encoding':'gzip','content-length':'100'}});const decodedHttp=await collectEcccReview({registry,previous,journalPath:encoded});assert.equal(decodedHttp.candidate.lastAttempt.status,'success');const encodedEvidence=JSON.parse(await fs.readFile(encoded+'.response.json'));assert.equal(encodedEvidence.bodyEncoding,'base64_fetch_body_bytes_before_utf8_decoding');assert.equal(encodedEvidence.receipt.responseHeaders['content-encoding'],'gzip');assert.deepEqual(Buffer.from(encodedEvidence.bodyBase64,'base64'),Buffer.from(originalBody));groups++;
 const broken=join(temp,'retention-failure.jsonl');fs.open=async(path,...args)=>{if(path===broken+'.response.json')throw Object.assign(Error('evidence fsync fixture failure'),{code:'EIO'});return open(path,...args);};globalThis.fetch=async()=>new Response(rejected,{headers:{'content-type':'application/json'}});const noEvidence=await collectEcccReview({registry,previous,journalPath:broken});assert.equal(noEvidence.candidate.lastAttempt.status,'failed');assert.strictEqual(noEvidence.candidate.lastKnownGood,previous.lastKnownGood);assert.equal(JSON.parse((await fs.readFile(broken,'utf8')).trim().split('\n').at(-1)).response.evidenceRetained,false);groups++;
}finally{globalThis.fetch=fetch;fs.open=open;await fs.rm(temp,{recursive:true,force:true});}
const workflow=await read('.github/workflows/weather-preview.yml');assert.match(workflow,/artifacts\/eccc-weather-review-journal\.jsonl\.response\.json/);assert.doesNotMatch(await read('scripts/lib/weather-publication.mjs'),/response\.json|bodyBase64/);groups++;
console.log(`${groups} ECCC clock/evidence groups passed: all11 future-clock sites identified with zero tolerance, future forecast validity accepted, rejected original bytes durable/nonpublishable, UTF8/BOM retained, incomplete bodies not falsely complete; no source calls.`);
