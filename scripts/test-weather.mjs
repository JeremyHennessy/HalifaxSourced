import assert from 'node:assert/strict';
import {readFile,stat,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {projectEccc,acceptedEnvelope,retainOnFailure,metric,stamp,hash,ENDPOINT,REVIEWED_POINTS} from './lib/eccc-weather.mjs';
import {collectEcccReview} from './lib/eccc-weather-adapter.mjs';
import {sourceAccessState} from './lib/source-access-state.mjs';
import {buildWeather} from './build-weather.mjs';
import {buildCatalog} from './build-source-catalog.mjs';
import contract from '../weather-contract.js';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const body=await read('scripts/fixtures/weather/eccc-citypage-20261028.json');
const receipt=JSON.parse(await read('scripts/fixtures/weather/eccc-citypage-20261028-receipt.json'));
const raw=JSON.parse(body),config=JSON.parse(await read('data/weather-source-registry.json'));
const projected=projectEccc(body,receipt),envelope=acceptedEnvelope(projected,receipt),at=Date.parse(receipt.retrievedAt);
let checks=0;async function test(name,fn){await fn();console.log(`ok ${++checks} - ${name}`);}
function changed(change){const j=structuredClone(raw);change(j);const b=JSON.stringify(j);return [b,{...receipt,bodyBytes:Buffer.byteLength(b),sha256:hash(b)}];}
await test('true source clocks/hash, one regional forecast, two named station observations',()=>{
  assert.equal(receipt.sha256,'448b6c163d4a8083f17adecb6620c82ba5b6fa52c61844c999ea349abb374ccb');
  assert.equal(projected.retrievedAt,'2026-10-28T00:43:33.585Z');assert.equal(projected.forecast.issuedAt,'2026-10-27T19:00:00Z');
  assert.deepEqual(projected.observations.map(x=>[x.stationCode,x.temperatureC,x.observedAt]),[['yhz',1.6,'2026-10-28T00:00:00Z'],['yaw',4.1,'2026-10-28T00:00:00Z']]);
  assert.equal(projected.forecast.hourly.length,24);assert.equal(projected.forecast.hourly[0].validAt,'2026-10-28T01:00:00Z');assert.equal(projected.forecast.hourly.at(-1).validAt,'2026-10-29T00:00:00Z');
  assert.deepEqual(projected.scope.reviewedUiPoints,REVIEWED_POINTS.map(x=>x.name));assert.equal(projected.scope.pointForecastsGenerated,false);assert.equal(projected.scope.wholeMunicipalityCoverageCertified,false);
});
await test('strict geographic whitelist, identity, completeness, source URLs and units fail closed',()=>{
  for(const mutate of [j=>j.features[0].id='truro',j=>j.features[0].properties.name.en='Moncton',j=>j.features[0].geometry.coordinates=[-64,46],j=>j.features[0].properties.currentConditions.station.code.en='abc',j=>j.features[0].properties.currentConditions.station.value.en='Downtown Halifax',j=>j.features[0].properties.url.en='https://evil.example/',j=>j.numberMatched=3,j=>j.features.pop(),j=>j.features[1]=j.features[0],j=>j.links.push({rel:'next',href:ENDPOINT}),j=>delete j.features[0].properties.warnings,j=>j.features[0].properties.currentConditions.temperature.units.en='F',j=>j.features[0].properties.hourlyForecastGroup.hourlyForecasts.pop(),j=>j.features[0].properties.forecastGroup.forecasts[0].textSummary.en='different'])assert.throws(()=>projectEccc(...changed(mutate)));
  assert.throws(()=>projectEccc(body,{...receipt,sha256:'a'.repeat(64)}));assert.throws(()=>projectEccc(body,{...receipt,httpStatus:403}));assert.throws(()=>projectEccc(body,{...receipt,responseHeaders:{'content-type':'text/html'}}));
});
await test('declared percent is never auto-scaled; null is not zero; amount is unknown',()=>{
  assert.equal(metric({units:{en:'%'},value:{en:0.75}},'%',0,100),.75);
  assert.equal(metric({units:{en:'C'},value:{en:null}},'C'),null);assert.equal(metric(null,'C'),null);
  assert.throws(()=>metric({units:{en:'%'},value:{en:'0'}},'%'));assert.throws(()=>metric({units:{en:'%'},value:{en:101}},'%',0,100));
  assert.ok(projected.forecast.hourly.every(x=>x.precipitationAmountMm===null));
});
await test('impossible/future clocks and invalid hourly spacing rejected; relative daily labels are not redated',()=>{
  assert.throws(()=>stamp('2026-02-30T00:00:00Z'));
  assert.throws(()=>projectEccc(...changed(j=>j.features[0].properties.currentConditions.timestamp.en='2099-01-01T00:00:00Z')));
  const changedHourly=changed(j=>{for(const f of j.features)f.properties.hourlyForecastGroup.hourlyForecasts[1].timestamp='2026-10-28T01:30:00Z';});assert.throws(()=>projectEccc(...changedHourly));
  assert.equal(projected.forecast.periods[0].publisherPeriodLabel,'Tuesday night');assert.ok(projected.forecast.periods.every(x=>x.validFrom===null&&x.validTo===null));
});
await test('fresh-at-receipt is scoped; alerts expire exactly at threshold',()=>{
  const fresh=contract.evaluate(envelope,at);assert.equal(fresh.forecast.status,'fresh');assert.ok(fresh.observations.every(x=>x.status==='fresh'));assert.equal(fresh.warnings.status,'none_reported');
  assert.equal(contract.evaluate(envelope,at+30*60000-1).warnings.status,'none_reported');assert.equal(contract.evaluate(envelope,at+30*60000).warnings.status,'unavailable');
  assert.equal(contract.evaluate(envelope,Date.parse('2026-10-28T02:00:00Z')).observations[0].status,'stale');
  assert.equal(contract.evaluate(envelope,at+2*3600000).forecast.status,'stale');
  assert.equal(contract.evaluate(envelope,Date.parse('2026-10-29T00:00:00Z')).forecast.status,'stale');
  assert.equal(contract.evaluate(envelope,at-1).warnings.status,'unavailable');
});
await test('failed, held, partial or pending attempts retain old facts but never stale all-clear',()=>{
  for(const status of ['failed','pending','held','partial']){const copy=retainOnFailure(envelope,{status,attemptedAt:receipt.retrievedAt});assert.strictEqual(copy.lastKnownGood,envelope.lastKnownGood);const view=contract.evaluate(copy,at+1);assert.equal(view.warnings.status,'unavailable');assert.equal(view.forecast.status,'stale');assert.equal(view.observations[0].temperatureC,1.6);}
  for(const mutate of [e=>delete e.lastKnownGood.warnings.complete,e=>e.lastKnownGood.warnings.items=[{}],e=>e.lastKnownGood.warnings.sourceUpdatedAts=['2020-01-01T00:00:00Z',receipt.retrievedAt],e=>e.lastAttempt.completedAt='2099-01-01T00:00:00Z']){const copy=structuredClone(envelope);mutate(copy);assert.equal(contract.evaluate(copy,at).warnings.status,'unavailable');}
  assert.equal(contract.evaluate(null,at).forecast.status,'unavailable');
});
await test('nonempty warning objects preserve originals, neutral notice only, never no-warning state',()=>{
  const original={headline:'Warning text <must remain>',severity:'unknown-schema'};
  const data=projectEccc(...changed(j=>j.features[0].properties.warnings=[original]));assert.deepEqual(data.warnings.items[0].original,original);
  assert.equal(contract.evaluate(acceptedEnvelope(data,receipt),at).warnings.status,'notice');
  assert.equal(contract.evaluate(acceptedEnvelope(data,receipt),at+30*60000).warnings.status,'unavailable');
});
await test('recorded build is byte/mtime deterministic and cannot freshen fixture',async()=>{
  const first=await buildWeather(),path=new URL('../data/weather.js',import.meta.url),before=await readFile(path,'utf8'),mtime=(await stat(path)).mtimeMs;
  assert.deepEqual(first,envelope);await buildWeather();assert.equal(await readFile(path,'utf8'),before);assert.equal((await stat(path)).mtimeMs,mtime);
  const browser={window:{}};vm.runInNewContext(before,browser);assert.equal(JSON.stringify(browser.window.HalifaxWeather),JSON.stringify(envelope));
});
await test('disabled registry makes zero requests and no journal',async()=>{
  const fetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('network forbidden')};
  try{await assert.rejects(collectEcccReview(),/disabled/);assert.equal(requests,0);}finally{globalThis.fetch=fetch;}
});
const temp=await mkdtemp(join(tmpdir(),'halifax-weather-test-'));
try{
  const enabled=structuredClone(config);enabled.sources[0].enabled=true; // test-only mock registry, never persisted
  await test('mocked single endpoint uses real guard, durable pending receipt, no cachebust and no retries',async()=>{
    const fetch=globalThis.fetch;let requests=0;const journalPath=join(temp,'success.jsonl');
    globalThis.fetch=async(url,options)=>{requests++;assert.equal(url,ENDPOINT);assert.match(options.headers['User-Agent'],/HalifaxSourced-WeatherReview/);assert.equal(options.headers['Cache-Control'],undefined);assert.equal(options.redirect,'manual');assert.match(await readFile(journalPath,'utf8'),/"status":"pending"/);return new Response(body,{headers:{'content-type':'application/json'}});};
    try{const result=await collectEcccReview({registry:enabled,journalPath,previous:envelope});assert.equal(result.candidate.lastAttempt.status,'success');assert.equal(result.reviewOnly,true);assert.equal(requests,1);await assert.rejects(collectEcccReview({registry:enabled,journalPath}),/EEXIST/);assert.equal(requests,1);assert.equal((await readFile(journalPath,'utf8')).trim().split('\n').length,2);}finally{globalThis.fetch=fetch;}
  });
  await test('redirect/partial/oversize/invalid units preserve old state; every journal prohibits retry',async()=>{
    const fetch=globalThis.fetch;
    try{for(const [name,response] of [['redirect',()=>new Response('',{status:302,headers:{location:ENDPOINT}})],['partial',()=>new Response('{"features":[]}',{headers:{'content-type':'application/json'}})],['oversize',()=>new Response('x'.repeat(524289),{headers:{'content-type':'application/json'}})],['units',()=>new Response(changed(j=>j.features[0].properties.currentConditions.temperature.units.en='F')[0],{headers:{'content-type':'application/json'}})]]){
      let requests=0;globalThis.fetch=async()=>{requests++;return response()};const journalPath=join(temp,name+'.jsonl');const result=await collectEcccReview({registry:enabled,journalPath,previous:envelope});assert.equal(result.candidate.lastAttempt.status,'failed');assert.deepEqual(result.candidate.lastKnownGood,envelope.lastKnownGood);assert.equal(contract.evaluate(result.candidate,Date.now()).warnings.status,'unavailable');assert.equal(requests,1);await assert.rejects(collectEcccReview({registry:enabled,journalPath}),/EEXIST/);
    }}finally{globalThis.fetch=fetch;}
  });
  await test('existing access hold prevents first transport without fallback or retry',async()=>{
    const access=sourceAccessState().access,oldLength=access.holds.length,fetch=globalThis.fetch;let requests=0;
    access.observe({url:ENDPOINT,finalUrl:ENDPOINT,status:403,observedAt:new Date().toISOString()},{kind:'fixture'});globalThis.fetch=async()=>{requests++;throw Error('should not request')};
    try{const result=await collectEcccReview({registry:enabled,journalPath:join(temp,'held.jsonl'),previous:envelope});assert.equal(result.candidate.lastAttempt.status,'held');assert.equal(requests,0);}finally{access.holds.splice(oldLength);globalThis.fetch=fetch;}
  });
}finally{await rm(temp,{recursive:true,force:true});}
await test('source catalogue keeps disabled schedule and separate issue/observation/retrieval clocks',async()=>{
  const rows=buildCatalog({'data/weather-source-registry.json':config,'data/build/halifax-weather.json':envelope}).sources;assert.equal(rows.length,1);const row=rows[0];assert.equal(row.family,'weather');assert.equal(row.enabled,false);assert.equal(row.state,'held');assert.equal(row.workflowUrl,null);assert.equal(row.targetHours,null);assert.equal(row.lastAttemptAt,'2026-10-28T00:43:26.981Z');assert.equal(row.lastSuccessAt,receipt.retrievedAt);assert.equal(row.contentAt,'2026-10-27T19:00:00.000Z');assert.equal(row.weather.observationTimes[0].observedAt,'2026-10-28T00:00:00.000Z');
  const context={window:{location:{href:'https://example.test/'}},URL,Date,console};vm.createContext(context);vm.runInContext(await read('app-admin-status.js'),context);const html=context.renderCatalogRow(row);assert.match(html,/recorded manual snapshot/);assert.match(html,/No mapped workflow/);assert.match(html,/not establish current weather or an all-clear/);
});
await test('no weather collector is activated by any workflow',async()=>{
  for(const path of await readdir(new URL('../.github/workflows/',import.meta.url))){const yaml=await read('.github/workflows/'+path);assert.ok(!yaml.includes('collectEcccReview'));assert.ok(!yaml.includes('eccc-weather-adapter'));}
});
console.log(`${checks} weather foundation checks passed; all transport mocked, zero external requests.`);
