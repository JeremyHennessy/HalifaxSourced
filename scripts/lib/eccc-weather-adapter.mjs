// Dormant manual review adapter. No CLI, schedule, browser requests or publication.
// A future reviewed activation must enable the registry; currently it is false.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fetchGuardedSource,withSourceDeadline} from './fetch-public-source.mjs';
import {openWeatherReviewJournal} from './weather-review-journal.mjs';
import {ENDPOINT,hash,projectEccc,acceptedEnvelope,retainOnFailure} from './eccc-weather.mjs';
const registryUrl=new URL('../../data/weather-source-registry.json',import.meta.url);
const journalDefault=fileURLToPath(new URL('../../artifacts/eccc-weather-review-journal.jsonl',import.meta.url));
const UA='HalifaxSourced-WeatherReview/1.0 (+https://github.com/JeremyHennessy/HalifaxSourced; bounded official Halifax city-page review)';
async function boundedBody(response,signal) {
  const size=response.headers.get('content-length');
  if(size!==null)assert.ok(/^\d+$/.test(size)&&Number(size)<=524288,'body limit');
  const reader=response.body?.getReader();assert.ok(reader,'missing response body');
  const chunks=[];let length=0;
  try {
    for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;assert.ok(length<=524288,'body limit');chunks.push(value);}
    signal.throwIfAborted();return Buffer.concat(chunks).toString('utf8');
  } catch(error){void reader.cancel().catch(()=>{});throw error;}
}
export async function collectEcccReview({previous=null,journalPath=journalDefault,registry=null}={}) {
  const config=registry||JSON.parse(await readFile(registryUrl,'utf8'));
  assert.equal(config.version,1);assert.equal(config.sources?.length,1);
  const source=config.sources[0];assert.equal(source.id,'eccc-halifax-citypage');assert.equal(source.endpoint,ENDPOINT);
  assert.equal(source.enabled,true,'Weather collection is disabled; recorded snapshot only.');
  assert.deepEqual(source.expectedCityIds,['ns-19','ns-40']);
  assert.deepEqual(source.expectedStationCodes,['yhz','yaw']);
  const attemptedAt=new Date().toISOString();
  const pending={status:'pending',attemptedAt,url:ENDPOINT};
  // Fail closed before any source/robots request unless the pending bytes,
  // journal pathname and complete parent directory chain are durable. Existing
  // journals still block reuse; failed barriers never delete or bypass them.
  const journal=await openWeatherReviewJournal(journalPath,pending);
  async function persist(entry){await journal.writeFile(JSON.stringify(entry)+'\n');await journal.sync();}
  try {
    let requests=0;
    const result=await withSourceDeadline(async signal=>{
      const response=await fetchGuardedSource(ENDPOINT,{signal,headers:{'User-Agent':UA,Accept:'application/geo+json, application/json;q=0.9'}},async target=>String(target)===ENDPOINT&&requests++===0);
      const responseAt=new Date().toISOString();
      assert.equal(response.status,200,'weather response not successful');
      const headers=Object.fromEntries(['date','content-type','etag','last-modified','cache-control'].map(key=>[key,response.headers.get(key)]).filter(([,value])=>value!==null));
      assert.match(headers['content-type']||'',/^application\/(?:geo\+)?json(?:;|$)/i);
      const body=await boundedBody(response,signal);
      const receipt={version:1,url:ENDPOINT,attemptedAt,responseAt,retrievedAt:new Date().toISOString(),httpStatus:200,responseHeaders:headers,bodyBytes:Buffer.byteLength(body),sha256:hash(body)};
      const data=projectEccc(body,receipt);data.fixture=false;
      return {body,receipt,candidate:acceptedEnvelope(data,receipt)};
    },20000);
    await persist({status:'success',...result.receipt});
    return {...result,reviewOnly:true}; // caller must explicitly review; no public writes
  } catch(error) {
    const attempt={status:error.code==='SOURCE_ACCESS_HOLD'?'held':'failed',attemptedAt,completedAt:new Date().toISOString(),reason:String(error.code||error.message).slice(0,240)};
    await persist(attempt);
    return {candidate:retainOnFailure(previous,attempt),reviewOnly:true,error:attempt.reason};
  } finally {await journal.close();}
}
