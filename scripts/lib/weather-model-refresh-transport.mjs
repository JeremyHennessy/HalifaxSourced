// Bounded exact-URL transport, sharing the mandatory committed/observed access guards.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {fetchGuardedSource,withSourceDeadline} from './fetch-public-source.mjs';
import {sourceAccessState} from './source-access-state.mjs';
import {robotsPolicyAllows} from './robots-policy.mjs';
import {parseRetryAfter} from './link-access-policy.mjs';
import {sha256} from './weather-model-refresh-state.mjs';
export const REFRESH_LIMITS=Object.freeze({requests:27,bytes:40*1024*1024,deadlineMs:15000,runMs:12*60000,spacingMs:10000,metadataBytes:1024*1024,indexBytes:256*1024,robotsBytes:64*1024});
const hosts=new Set(['nomads.ncep.noaa.gov','data.ecmwf.int']);
const headersAllowed=['content-type','content-length','content-encoding','content-range','etag','last-modified','retry-after','date'];
export class RefreshStop extends Error{constructor(reason,disposition='held',details={}){super(reason);this.name='RefreshStop';this.disposition=disposition;this.details=details;}}
export function transientDisposition(receipt,body,priorCount=0){
 assert.equal(receipt.complete,true);assert.ok([502,503,504].includes(receipt.status));
 const text=body.toString('utf8');
 if(/captcha|access.denied|verify.{0,30}(?:human|browser)|challenge-platform|cf-chl|bot.detect/i.test(text))return {disposition:'held',reason:'complete_error_contains_access_challenge',nextAttemptNotBefore:null,transientCount:priorCount};
 const transientCount=priorCount+1;if(transientCount>3)return {disposition:'held',reason:'complete_transient_retry_budget_exhausted',nextAttemptNotBefore:null,transientCount};
 const completed=Date.parse(receipt.completedAt),raw=receipt.headers['retry-after'];let retry=completed+Math.min(4,2**priorCount)*3600000;
 if(raw!==undefined){const parsed=parseRetryAfter(raw,receipt.completedAt);if(!parsed)return {disposition:'held',reason:'invalid_retry_after',nextAttemptNotBefore:null,transientCount};retry=Math.max(retry,Date.parse(parsed));}
 return {disposition:'backoff',reason:`complete_http_${receipt.status}`,nextAttemptNotBefore:new Date(retry).toISOString(),transientCount};
}
export function createRefreshTransport({run,now=()=>new Date().toISOString(),monotonic=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),fetcher=fetchGuardedSource,guard=sourceAccessState(),limits=REFRESH_LIMITS}){
 let operations=0,totalBytes=0,lastCompleted=null;const started=monotonic();
 const receipts=[];
 async function request({url,kind,sourceId,range=null,expectedRange=null,maximumBytes,robots=null,cached=null}){
  const u=new URL(url);assert.ok(hosts.has(u.hostname)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash,'unreviewed source URL');assert.ok(['robots','listing','index','field'].includes(kind));assert.equal(u.hostname,sourceId==='noaa'?'nomads.ncep.noaa.gov':sourceId==='ecmwf'?'data.ecmwf.int':'unadmitted');
  assert.ok(Number.isInteger(maximumBytes)&&maximumBytes>0&&maximumBytes<=(kind==='field'?(sourceId==='noaa'?1024*1024:4*1024*1024):kind==='index'?limits.indexBytes:kind==='robots'?limits.robotsBytes:limits.metadataBytes));
  if(kind==='robots')assert.equal(u.pathname,'/robots.txt');else assert.ok(robotsPolicyAllows(robots,url),'robots policy unavailable/disallows exact request');
  const existing=guard.access.find(url);if(existing)throw new RefreshStop('source_access_hold','held',{hold:existing});
  assert.ok(operations<limits.requests&&totalBytes<limits.bytes&&monotonic()-started<limits.runMs,'run request/byte/time budget');
  if(lastCompleted!==null){const wait=limits.spacingMs-(monotonic()-lastCompleted);if(wait>0)await sleep(wait);}
  assert.ok(monotonic()-started<limits.runMs,'run deadline');
  const headers={'User-Agent':'HalifaxSourced/1.0 (+https://github.com/JeremyHennessy/HalifaxSourced; bounded Halifax GFS/IFS review)','Accept-Encoding':'identity',Accept:kind==='field'?'application/octet-stream':kind==='robots'?'text/plain':kind==='index'?'application/json, text/plain':'text/html'};
  if(kind==='field'&&sourceId==='ecmwf')assert.ok(range,'ECMWF field requires exact bounded Range');
  if(range){assert.equal(kind,'field');assert.equal(sourceId,'ecmwf');assert.match(range,/^bytes=\d+-\d+$/);headers.Range=range;assert.equal(cached,null,'no conditional range ambiguity');}
  if(cached){assert.notEqual(kind,'field');assert.equal(cached.url,url);assert.ok(cached.status===200||kind==='robots'&&[404,410].includes(cached.status));if(cached.headers?.etag)headers['If-None-Match']=cached.headers.etag;else if(cached.headers?.['last-modified'])headers['If-Modified-Since']=cached.headers['last-modified'];}
  const conditional=Boolean(headers['If-None-Match']||headers['If-Modified-Since']);
  const receipt={version:1,url,sourceId,kind,attemptedAt:now(),headersReceivedAt:null,completedAt:null,status:null,headers:{},requestedRange:range,bodySha256:null,bodyBytes:0,complete:false};receipts.push(receipt);
  await run.append({event:'request_pending',...receipt,maximumBytes,requestNumber:operations+1});
  const chunks=[];let length=0;
  try{
   const bytes=await withSourceDeadline(async signal=>{
    const response=await fetcher(url,{headers,signal,redirect:'manual'},async target=>String(target)===url&&(kind==='robots'||robotsPolicyAllows(robots,target)),{
     beforeRequest(target){assert.equal(String(target),url,'redirect/fallback prohibited');assert.ok(++operations<=limits.requests);},
     afterResponse(target,response,observed){receipt.headersReceivedAt=observed.observedAt;receipt.status=response.status;receipt.headers=Object.fromEntries(headersAllowed.filter(k=>response.headers.has(k)).map(k=>[k,response.headers.get(k)]));if(response.status>=300&&response.status<400&&response.status!==304){void response.body?.cancel().catch(()=>{});throw new RefreshStop('redirect_not_followed');}},
     afterAbortedResponse(target,response){void response.body?.cancel().catch(()=>{});}
    });
    assert.equal(receipt.status,response.status,'transport observer missing');
    const encoding=response.headers.get('content-encoding');assert.ok(!encoding||encoding==='identity','original entity encoding unavailable');
    const lengthHeader=response.headers.get('content-length');if(lengthHeader!==null)assert.ok(/^\d+$/.test(lengthHeader)&&Number(lengthHeader)<=maximumBytes,'body byte limit');
    if(response.status===304){assert.ok(conditional&&cached,'304 without matched conditional evidence');assert.ok(!response.body,'304 must not carry body');return Buffer.alloc(0);}
    assert.ok(response.body,'response body missing');const reader=response.body.getReader();try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;length+=part.value.byteLength;totalBytes+=part.value.byteLength;assert.ok(length<=maximumBytes&&totalBytes<=limits.bytes,'body/aggregate byte limit');chunks.push(Buffer.from(part.value));}signal.throwIfAborted();}catch(error){void reader.cancel().catch(()=>{});throw error;}
    if(lengthHeader!==null)assert.equal(length,Number(lengthHeader),'incomplete entity bytes');return Buffer.concat(chunks);
   },limits.deadlineMs);
   lastCompleted=monotonic();receipt.completedAt=now();receipt.complete=true;receipt.bodyBytes=bytes.length;receipt.bodySha256=await run.blob(bytes);await run.append({event:'response_complete',...receipt});await guard.drainDecisions();
   if(guard.pendingAccessHolds.length||guard.pendingTransportReviews.length)throw new RefreshStop('access_or_unknown_transport_hold');
   if(kind!=='field'&&receipt.status===200&&/captcha|access.denied|verify.{0,30}(?:human|browser)|challenge-platform|cf-chl|bot.detect/i.test(bytes.toString('utf8')))throw new RefreshStop('metadata_access_challenge');
   if([502,503,504].includes(receipt.status))throw new RefreshStop('complete_transient_http','backoff',{receipt,bodyBase64:bytes.toString('base64')});
   const allowed=kind==='robots'?[200,404,410,304]:range?[206]:cached?[200,304]:[200];if(!allowed.includes(receipt.status))throw new RefreshStop(`unexpected_complete_http_${receipt.status}`);
   if(range){assert.equal(receipt.headers['content-range'],expectedRange?expectedRange:receipt.headers['content-range']);const m=receipt.headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);assert.ok(m&&range===`bytes=${m[1]}-${m[2]}`&&Number(m[3])>Number(m[2])&&bytes.length===Number(m[2])-Number(m[1])+1,'invalid exact partial Content-Range');}
   if(receipt.status===304){const body=await run.readBlob(cached.bodySha256);assert.equal(body.length,cached.bodyBytes);await run.append({event:'conditional_revalidated_without_freshening',url,originalBodySha256:cached.bodySha256,originalCompletedAt:cached.completedAt,revalidatedAt:receipt.completedAt});return {...cached,body,revalidation:receipt};}
   return {...receipt,body:bytes};
  }catch(error){
   if(!receipt.complete){receipt.completedAt=now();receipt.bodyBytes=chunks.reduce((n,c)=>n+c.length,0);receipt.bodySha256=await run.blob(Buffer.concat(chunks));await run.append({event:'request_unresolved',...receipt,reason:error.message.slice(0,240)});}
   await guard.drainDecisions();throw error instanceof RefreshStop?error:new RefreshStop(error.message.slice(0,240),'held',{receipt});
  }
 }
 return {request,receipts,stats:()=>({operations,totalBytes}),drain:()=>guard.drainDecisions()};
}
