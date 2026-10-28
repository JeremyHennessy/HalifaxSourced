// Guarded review adapter. No browser requests or direct publication.
// Registry readiness, previous outcome and durable pending evidence gate every request.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchGuardedSource,withSourceDeadline} from './fetch-public-source.mjs';
import {consumeReviewedRecoveryCapability,beforeReviewedRecoveryRequest} from './eccc-reviewed-recovery.mjs';
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
    signal.throwIfAborted();const bytes=Buffer.concat(chunks);if(size!==null&&(!response.headers.get('content-encoding')||response.headers.get('content-encoding').trim().toLowerCase()==='identity'))assert.equal(bytes.length,Number(size),'incomplete response body');return bytes;
  } catch(error){void reader.cancel().catch(()=>{});throw error;}
}
export async function collectEcccReview({previous=null,journalPath=journalDefault,registry=null,previousCapture=null,recoveryCapability=null}={}) {
  const config=registry||JSON.parse(await fs.readFile(registryUrl,'utf8'));
  assert.equal(config.version,1);assert.equal(config.sources?.length,1);
  const source=config.sources[0];assert.equal(source.id,'eccc-halifax-citypage');assert.equal(source.endpoint,ENDPOINT);
  assert.equal(source.enabled,true,'Weather collection is disabled; recorded snapshot only.');
  assert.deepEqual(source.expectedCityIds,['ns-19','ns-40']);
  assert.deepEqual(source.expectedStationCodes,['yhz','yaw']);
  let recoveryRecord=null;
  if(recoveryCapability){assert.equal(previous?.lastAttempt?.status,'failed');recoveryRecord=consumeReviewedRecoveryCapability(recoveryCapability,previous);}
  else if(previous?.lastAttempt)assert.ok(['success','not_modified'].includes(previous.lastAttempt.status),'Previous weather outcome held; reviewed recovery required');
  const headers={'User-Agent':UA,Accept:'application/geo+json, application/json;q=0.9'};
  if(previousCapture){
    projectEccc(previousCapture.body,previousCapture.receipt);
    assert.equal(previous?.lastKnownGood?.sourceBodySha256,previousCapture.receipt.sha256);
    for(const [source,target] of [['etag','If-None-Match'],['last-modified','If-Modified-Since']]){
      const validator=previousCapture.receipt.responseHeaders?.[source];
      if(validator!==undefined){assert.ok(typeof validator==='string'&&validator.length>0&&validator.length<=512&&!/[\r\n]/.test(validator));headers[target]=validator;}
    }
  }
  const responseEvidencePath=journalPath+'.response.json';
  try{await fs.lstat(responseEvidencePath);throw Object.assign(new Error('EEXIST: Existing weather response evidence; reviewed recovery required'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const attemptedAt=new Date().toISOString();
  const pending={status:'pending',attemptedAt,url:ENDPOINT,...(recoveryRecord?{reviewedRecovery:recoveryRecord}:{})};
  // Fail closed before any source/robots request unless the pending bytes,
  // journal pathname and complete parent directory chain are durable. Existing
  // journals still block reuse; failed barriers never delete or bypass them.
  const journal=await openWeatherReviewJournal(journalPath,pending);
  async function persist(entry){await journal.writeFile(JSON.stringify(entry)+'\n');await journal.sync();}
  let responseEvidence=null;
  try {
    let requests=0;
    const result=await withSourceDeadline(async signal=>{
      const response=await fetchGuardedSource(ENDPOINT,{signal,headers},async target=>String(target)===ENDPOINT&&requests++===0,recoveryCapability?{beforeRequest:target=>beforeReviewedRecoveryRequest(recoveryCapability,target)}:{});
      const responseAt=new Date().toISOString();
      responseEvidence={url:ENDPOINT,httpStatus:response.status,responseAt};
      if(response.status===304){
        assert.ok(previousCapture&&(headers['If-None-Match']||headers['If-Modified-Since']),'unsolicited 304');
        // A validation receipt is not a newly retrieved body or warning check.
        const validationReceipt={version:1,url:ENDPOINT,attemptedAt,responseAt,completedAt:new Date().toISOString(),httpStatus:304,retainedBodySha256:previousCapture.receipt.sha256};
        return {...previousCapture,validationReceipt,candidate:{...previous,lastAttempt:{status:'not_modified',attemptedAt,completedAt:validationReceipt.completedAt}}};
      }
      assert.equal(response.status,200,'weather response not successful');
      const responseHeaders=Object.fromEntries(['date','content-type','content-encoding','content-length','etag','last-modified','cache-control'].map(key=>[key,response.headers.get(key)]).filter(([,value])=>value!==null));
      assert.match(responseHeaders['content-type']||'',/^application\/(?:geo\+)?json(?:;|$)/i);
      const bytes=await boundedBody(response,signal);
      const receipt={version:1,url:ENDPOINT,attemptedAt,responseAt,retrievedAt:new Date().toISOString(),httpStatus:200,responseHeaders,bodyBytes:bytes.length,sha256:hash(bytes)};
      // Durable fetch-body bytes precede character decoding/semantic validation. This is
      // review evidence, never an accepted capture or publication input.
      responseEvidence={...responseEvidence,retrievedAt:receipt.retrievedAt,bodyBytes:receipt.bodyBytes,sha256:receipt.sha256,evidenceFile:basename(responseEvidencePath),evidenceRetained:false};
      const evidence=await openWeatherReviewJournal(responseEvidencePath,{version:1,kind:'unaccepted_eccc_complete_response_evidence',semanticAcceptance:false,receipt,bodyEncoding:'base64_fetch_body_bytes_before_utf8_decoding',bodyBase64:bytes.toString('base64')});
      await evidence.close();responseEvidence.evidenceRetained=true;
      const body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const data=projectEccc(body,receipt);data.fixture=false;
      return {body,receipt,candidate:acceptedEnvelope(data,receipt)};
    },20000);
    await persist(result.validationReceipt?{status:'not_modified',...result.validationReceipt}:{status:'success',...result.receipt});
    return {...result,reviewOnly:true}; // caller must explicitly review; no public writes
  } catch(error) {
    const attempt={status:error.code==='SOURCE_ACCESS_HOLD'?'held':'failed',attemptedAt,completedAt:new Date().toISOString(),reason:[error.code,error.message].filter(Boolean).join(': ').slice(0,240)};
    await persist({...attempt,response:responseEvidence,...(error.weatherClock?{clockViolation:error.weatherClock}:{})});
    return {candidate:retainOnFailure(previous,attempt),reviewOnly:true,error:attempt.reason};
  } finally {await journal.close();}
}
