// Offline, review-only issuance boundary. Hashes bind reviewed bytes, not authorship.
// A trusted source-admission review must precede enabling any provider in the registry.
import assert from 'node:assert/strict';
import {hash,stamp} from './eccc-weather.mjs';
import {normalizeEcmwfDecoded,ECMWF_DECODER_ID,ECMWF_FIELD_BYTE_LIMIT} from './weather-ecmwf-adapter.mjs';
import {aggregateModels,digest,stableJson,locationContract,validateModelRegistry,normalizeForecast} from './weather-aggregation.mjs';
const time=x=>Date.parse(stamp(x));
const exact=(object,fields)=>assert.deepEqual(Object.keys(object).sort(),fields.slice().sort(),'unexpected archive fields');
const targetKey=t=>stableJson({...t,validStart:time(t.validStart),validEnd:time(t.validEnd)});
export function aggregateIssuedArchive(archive,{registry,locations}){
 exact(archive,['version','kind','issuedAt','registrySha256','locationsSha256','targets','captures','outcomes','minFamilies']);
 assert.ok(Buffer.byteLength(JSON.stringify(archive))<=32*1024*1024,'archive byte budget');
 assert.equal(archive.version,1);assert.equal(archive.kind,'review_only_halifax_model_archive');
 assert.equal(archive.registrySha256,digest(registry));assert.equal(archive.locationsSha256,digest(locations));
 assert.equal(registry.automaticCalibrationPromotion,false);const issue=time(archive.issuedAt),models=validateModelRegistry(registry);locationContract(locations);
 assert.ok(Array.isArray(archive.targets)&&archive.targets.length>0&&archive.targets.length<=2000);
 assert.ok(Array.isArray(archive.captures)&&archive.captures.length<=1000);assert.ok(Array.isArray(archive.outcomes)&&archive.outcomes.length<=34000);
 const captures=new Map();
 for(const capture of archive.captures){
  exact(capture,['id','sourceId','bodyBase64','receipt','decoded']);assert.ok(!captures.has(capture.id),'duplicate capture');assert.match(capture.id,/^[a-f0-9]{64}$/);
  assert.ok(typeof capture.bodyBase64==='string'&&capture.bodyBase64.length<=6*1024*1024);const bytes=Buffer.from(capture.bodyBase64,'base64');assert.ok(bytes.length>0&&bytes.length<=(capture.sourceId==='ecmwf'?ECMWF_FIELD_BYTE_LIMIT:1024*1024),'raw body byte budget');assert.equal(bytes.subarray(0,4).toString(),'GRIB');assert.equal(bytes.subarray(-4).toString(),'7777');assert.equal(bytes.toString('base64'),capture.bodyBase64,'noncanonical body encoding');assert.equal(hash(bytes),capture.id,'raw body hash mismatch');
  const r=capture.receipt;exact(r,['version','kind','sourceId','url','attemptedAt','headersReceivedAt','completedAt','status','bodySha256','bodyBytes','admissionReviewId','decoderId','decoderResultSha256',...(capture.sourceId==='ecmwf'?['rangeEvidence']:[])]);
  assert.equal(r.version,1);assert.equal(r.kind,'reviewed_model_source_capture');assert.equal(r.sourceId,capture.sourceId);assert.equal(r.bodySha256,capture.id);assert.equal(r.bodyBytes,bytes.length);assert.equal(r.status,capture.sourceId==='ecmwf'?206:200);
  assert.ok(time(r.attemptedAt)<=time(r.headersReceivedAt)&&time(r.headersReceivedAt)<=time(r.completedAt)&&time(r.completedAt)<=issue,'receipt ordering/issuance leakage');
  assert.match(r.admissionReviewId,/^[\w.:-]{1,160}$/);assert.match(r.decoderId,/^[\w.:-]{1,160}$/);assert.match(r.decoderResultSha256,/^[a-f0-9]{64}$/);
  const source=registry.sources.find(s=>s.id===capture.sourceId);assert.ok(source);assert.equal(new URL(r.url).protocol,'https:');assert.equal(new URL(r.url).username,'');assert.equal(new URL(r.url).password,'');
  // Do not confuse an archive with an authenticated acquisition journal.
  assert.ok(source.acceptedAdmissionReviewIds?.includes(r.admissionReviewId),'unreviewed admission receipt');assert.ok(source.acceptedDecoderIds?.includes(r.decoderId),'unreviewed source decoder');
  assert.equal(digest(capture.decoded),r.decoderResultSha256);
  assert.ok(['gfs-temperature-eccodes-v1',ECMWF_DECODER_ID].includes(r.decoderId),'decoder not implemented/admitted');
  const decodedRows=r.decoderId===ECMWF_DECODER_ID?normalizeEcmwfDecoded(capture.decoded,r,{locations}):normalizeGfsDecoded(capture.decoded,r,{locations});
  captures.set(capture.id,{...capture,decodedRows});
 }
 const active=[...models.values()].filter(m=>m.enabled&&registry.sources.some(s=>s.id===m.sourceId&&s.enabled));
 const expected=new Set(active.flatMap(m=>archive.targets.map(t=>m.id+'|'+targetKey(t)))),seen=new Set(),rows=[],coverage=[],usedCaptures=new Set();
 for(const outcome of archive.outcomes){
  exact(outcome,['modelId','target','status','latestKnownModelReferenceTime','knownAt','captureIds','rows','reason']);
  const key=outcome.modelId+'|'+targetKey(outcome.target);assert.ok(expected.has(key),'unexpected model/target outcome');assert.ok(!seen.has(key),'duplicate model/target outcome');seen.add(key);
  assert.ok(time(outcome.knownAt)<=issue,'outcome learned after issuance');assert.ok(['complete','missing','partial','failed','held','unknown'].includes(outcome.status));assert.ok(typeof outcome.reason==='string'&&outcome.reason.length<=240);
  assert.ok(Array.isArray(outcome.captureIds)&&Array.isArray(outcome.rows));const model=models.get(outcome.modelId);
  if(outcome.latestKnownModelReferenceTime!==null)assert.ok(time(outcome.latestKnownModelReferenceTime)<=time(outcome.knownAt));
  if(outcome.status!=='complete'){assert.equal(outcome.rows.length,0,'failed/partial outcome cannot substitute older retained rows');assert.equal(outcome.captureIds.length,0);}
  else {
   assert.notEqual(outcome.latestKnownModelReferenceTime,null,'unknown cycle cannot be complete');assert.ok(outcome.rows.length>0);
   const ids=new Set();
   for(const row of outcome.rows){
    const normalized=normalizeForecast(row,{registry,locations});assert.equal(row.modelId,model.id);assert.equal(time(row.modelReferenceTime),time(outcome.latestKnownModelReferenceTime),'older run cannot replace latest known cycle');assert.equal(targetKey({locationId:normalized.locationId,variable:normalized.variable,unit:normalized.unit,validStart:normalized.validStart,validEnd:normalized.validEnd,eventDefinition:normalized.eventDefinition}),targetKey(outcome.target));assert.notEqual(row.value,null,'complete outcome cannot contain null');
    const capture=captures.get(row.sourceBodySha256);assert.ok(capture&&outcome.captureIds.includes(capture.id),'row lacks raw capture');assert.equal(capture.sourceId,row.sourceId);assert.ok(capture.decodedRows.some(r=>stableJson(r)===stableJson(row)),'row differs from reviewed decoder output');assert.equal(row.receiptId,capture.id);assert.equal(row.firstRetrievedAt,capture.receipt.completedAt);assert.ok(time(row.firstRetrievedAt)<=time(outcome.knownAt));ids.add(capture.id);usedCaptures.add(capture.id);
   }
   assert.deepEqual([...ids].sort(),[...new Set(outcome.captureIds)].sort());
   const members=outcome.rows.map(r=>r.memberId);assert.equal(new Set(members).size,members.length,'duplicate member');assert.deepEqual(members.slice().sort(),model.projection==='ensemble'?model.memberIds.slice().sort():[null],'complete expected member set required');rows.push(...outcome.rows);
  }
  coverage.push({...outcome,rowsSha256:digest(outcome.rows),rows:undefined});
 }
 assert.deepEqual([...seen].sort(),[...expected].sort(),'every admitted model/target needs explicit newest-cycle outcome');assert.deepEqual([...usedCaptures].sort(),[...captures.keys()].sort(),'orphan capture');
 const result=aggregateModels({rows,locations,registry,issuedAt:archive.issuedAt,targets:archive.targets,minFamilies:archive.minFamilies,coverageManifest:coverage});
 return {...result,kind:'review_only_halifax_model_issuance',archiveSha256:digest(archive),coverageManifest:coverage,publicationAuthorized:false,sourceCompleteness:'declared_reviewed_scope_only_not_all_weather_sources',provenanceBoundary:'raw hashes and reviewed decoder receipts; not cryptographic proof of source authorship'};
}
export function normalizeGfsDecoded(decoded,receipt,{locations}){
 exact(decoded,['version','kind','sourceBodySha256','bodyBytes','modelReferenceTime','validAt','leadHours','centre','generatingProcessIdentifier','gridType','numberOfDataPoints','variable','sourceUnit','unit','projection','points']);
 assert.ok(Number.isInteger(decoded.leadHours)&&decoded.leadHours>0&&decoded.leadHours<=384);assert.equal(decoded.gridType,'regular_ll');assert.ok(Number.isInteger(decoded.numberOfDataPoints)&&decoded.numberOfDataPoints>0&&decoded.numberOfDataPoints<=10000);assert.ok(Number.isInteger(decoded.generatingProcessIdentifier)&&decoded.generatingProcessIdentifier>=0&&decoded.generatingProcessIdentifier<=255);assert.ok(Array.isArray(decoded.points)&&decoded.points.length>0&&decoded.points.length<=6);
 assert.equal(decoded.version,1);assert.equal(decoded.kind,'decoded_gfs_temperature_points');assert.equal(decoded.sourceBodySha256,receipt.bodySha256);assert.equal(decoded.bodyBytes,receipt.bodyBytes);assert.equal(digest(decoded),receipt.decoderResultSha256);assert.equal(receipt.decoderId,'gfs-temperature-eccodes-v1');assert.equal(receipt.sourceId,'noaa');assert.equal(decoded.centre,7);assert.equal(decoded.variable,'temperature_2m');assert.equal(decoded.unit,'C');assert.equal(decoded.sourceUnit,'K');assert.equal(decoded.projection,'nearest_grid_point');
 const url=new URL(receipt.url);assert.equal(url.origin,'https://nomads.ncep.noaa.gov');assert.equal(url.hash,'');assert.equal(url.pathname,'/cgi-bin/filter_gfs_0p25.pl');assert.equal(url.searchParams.get('var_TMP'),'on');assert.equal(url.searchParams.get('lev_2_m_above_ground'),'on');assert.equal(url.searchParams.get('subregion'),'');for(const [key,value]of Object.entries({leftlon:'-63.75',rightlon:'-63.50',toplat:'44.75',bottomlat:'44.50'}))assert.equal(Number(url.searchParams.get(key)),Number(value),'unreviewed GFS extent');assert.equal([...url.searchParams.keys()].length,new Set(url.searchParams.keys()).size,'duplicate request parameter');
 assert.ok([...url.searchParams.keys()].every(k=>['file','dir','var_TMP','lev_2_m_above_ground','subregion','leftlon','rightlon','toplat','bottomlat'].includes(k)),'unreviewed GFS request fields');
 const match=url.searchParams.get('dir')?.match(/^\/gfs\.(\d{8})\/(00|06|12|18)\/atmos$/),file=url.searchParams.get('file')?.match(/^gfs\.t(00|06|12|18)z\.pgrb2\.0p25\.f(\d{3})$/);assert.ok(match&&file&&match[2]===file[1]);
 const issued=`${match[1].slice(0,4)}-${match[1].slice(4,6)}-${match[1].slice(6,8)}T${match[2]}:00:00Z`;assert.equal(time(decoded.modelReferenceTime),time(issued));assert.equal(decoded.leadHours,Number(file[2]));assert.equal(time(decoded.validAt)-time(decoded.modelReferenceTime),decoded.leadHours*3600000);assert.ok(time(decoded.modelReferenceTime)<=time(receipt.completedAt));
 const points=locationContract(locations),ids=new Set();
 return decoded.points.map(point=>{exact(point,['locationId','latitude','longitude','valueC','gridLatitude','gridLongitude','distanceKm','gridIndex']);assert.ok(Number.isInteger(point.gridIndex)&&point.gridIndex>=0&&point.gridIndex<decoded.numberOfDataPoints);assert.ok(Number.isFinite(point.gridLatitude)&&point.gridLatitude>=44.50&&point.gridLatitude<=44.75);assert.ok(Number.isFinite(point.gridLongitude)&&point.gridLongitude>=-63.75&&point.gridLongitude<=-63.50);const expected=points.get(point.locationId);assert.ok(expected);assert.ok(!ids.has(point.locationId));ids.add(point.locationId);assert.equal(point.latitude,expected.latitude);assert.equal(point.longitude,expected.longitude);assert.ok(Number.isFinite(point.distanceKm)&&point.distanceKm>=0&&point.distanceKm<=30);assert.ok(Number.isFinite(point.valueC)&&point.valueC>=-100&&point.valueC<=70);
 return {version:1,kind:'model_forecast',modelId:'gfs',modelVersion:'unknown',modelVersionStatus:'unverified',sourceId:'noaa',dependencyGroup:'gfs',locationId:expected.id,latitude:expected.latitude,longitude:expected.longitude,support:{kind:'model_at_reviewed_point',locationId:expected.id,method:'nearest_grid_point',methodEvidenceId:'gfs-temperature-eccodes-v1',spatialFootprintId:`gfs-0p25-${point.gridLatitude}-${point.gridLongitude}`,gridLatitude:point.gridLatitude,gridLongitude:point.gridLongitude,distanceKm:point.distanceKm},sourceBodySha256:receipt.bodySha256,receiptId:receipt.bodySha256,modelReferenceTime:decoded.modelReferenceTime,sourceIssuedAt:null,firstAvailableAt:null,firstRetrievedAt:receipt.completedAt,validStart:decoded.validAt,validEnd:decoded.validAt,memberId:null,variable:'temperature_2m',unit:'C',eventDefinition:null,value:point.valueC};});
}
