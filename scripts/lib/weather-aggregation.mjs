// Pure Halifax-only multi-model baseline. No network, implicit units or learned state.
import assert from 'node:assert/strict';
import {hash,stamp} from './eccc-weather.mjs';
export const ALGORITHM='halifax-family-balanced-v1';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const stableJson=value=>JSON.stringify(canonical(value));
export const digest=value=>hash(stableJson(value));
const time=x=>Date.parse(stamp(x));
const number=(x,min=-Infinity,max=Infinity)=>{assert.ok(typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max,'invalid numeric value');return x;};
export const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
export function probability(value,unit){assert.ok(['percent','fraction'].includes(unit),'probability unit required');if(value===null)return null;number(value,0,unit==='percent'?100:1);return unit==='percent'?value/100:value;}
export const VARIABLES=Object.freeze({temperature_2m:{unit:'C',min:-100,max:70,interval:false},precipitation_probability:{unit:'fraction',min:0,max:1,interval:true},precipitation_amount:{unit:'mm',min:0,max:2000,interval:true},wind_speed_10m:{unit:'km/h',min:0,max:500,interval:false},wind_gust_10m:{unit:'km/h',min:0,max:500,interval:true},relative_humidity_2m:{unit:'percent',min:0,max:100,interval:false},cloud_cover:{unit:'percent',min:0,max:100,interval:false},pressure_msl:{unit:'kPa',min:80,max:110,interval:false}});
export function locationContract(locations){
 assert.equal(locations.version,1);assert.equal(locations.wholeMunicipalityCoverageCertified,false);assert.equal(locations.headlineEstimand,'equal_mean_of_all_three_core_points_only');
 const expected=[['halifax_peninsula',44.6488,-63.5752,'core'],['bedford',44.7318,-63.6619,'core'],['dartmouth',44.6661,-63.5676,'core'],['clayton_park',44.6718,-63.6530,'context'],['lower_sackville',44.7757,-63.6786,'context'],['eastern_passage',44.6109,-63.4820,'context']];
 assert.deepEqual(locations.points.map(p=>[p.id,p.latitude,p.longitude,p.role]),expected,'unreviewed geography');return new Map(locations.points.map(x=>[x.id,x]));
}
const MODEL_IDENTITY=Object.freeze({gem_hrdps:['eccc','gem'],gem_rdps:['eccc','gem'],gem_gdps:['eccc','gem'],gem_geps:['eccc','gem'],ecmwf_ifs:['ecmwf','ecmwf'],ecmwf_aifs:['ecmwf','ecmwf'],ecmwf_ifs_ens:['ecmwf','ecmwf'],ecmwf_aifs_ens:['ecmwf','ecmwf'],gfs:['noaa','gfs'],gefs:['noaa','gfs'],icon_global:['dwd','icon'],ukmo_global:['ukmo','ukmo'],meteofrance_arpege:['meteofrance','arpege'],jma_gsm:['jma','jma'],kma_global:['kma','kma'],bom_access_global:['bom','bom'],cma_grapes_global:['cma','cma']});
export function validateModelRegistry(registry){
 assert.equal(registry.version,1);assert.equal(registry.policyVersion,ALGORITHM);assert.equal(registry.automaticCalibrationPromotion,false);
 assert.ok(Array.isArray(registry.models)&&Array.isArray(registry.sources));assert.equal(new Set(registry.models.map(x=>x.id)).size,registry.models.length);assert.equal(new Set(registry.sources.map(x=>x.id)).size,registry.sources.length);
 for(const source of registry.sources){assert.equal(typeof source.enabled,'boolean');if(source.enabled)assert.equal(source.accessState,'admitted_review_only','held/unreviewed source cannot contribute');}
 for(const m of registry.models){assert.deepEqual([m.sourceId,m.dependencyGroup],MODEL_IDENTITY[m.id],'unreviewed model/family/provider identity');assert.ok(registry.sources.some(s=>s.id===m.sourceId));assert.match(m.id,/^[a-z0-9_]+$/);assert.match(m.dependencyGroup,/^[a-z0-9_]+$/);assert.equal(typeof m.enabled,'boolean');number(m.maxRunAgeHours,1,48);assert.ok(['deterministic','ensemble'].includes(m.projection));if(m.projection==='ensemble'&&m.memberIds!==null){assert.ok(Array.isArray(m.memberIds)&&m.memberIds.length>=2&&m.memberIds.length<=100);assert.equal(new Set(m.memberIds).size,m.memberIds.length);}else assert.equal(m.memberIds,null);if(m.enabled&&m.projection==='ensemble'){assert.equal(m.memberIdentityStatus,'verified');assert.ok(Array.isArray(m.memberIds));}}
 return new Map(registry.models.map(x=>[x.id,x]));
}
export function normalizeForecast(row,{locations,registry}){
 const points=locationContract(locations),models=validateModelRegistry(registry),point=points.get(row.locationId),model=models.get(row.modelId);
 assert.equal(row.version,1);assert.equal(row.kind,'model_forecast','observations/current estimates/official forecast are not model votes');assert.ok(point,'location outside reviewed scope');assert.ok(model,'unknown model');
 assert.equal(row.latitude,point.latitude);assert.equal(row.longitude,point.longitude);assert.equal(row.sourceId,model.sourceId);assert.equal(row.dependencyGroup,model.dependencyGroup,'family cannot be supplied ad hoc');
 assert.match(row.modelVersion,/^[\w.:-]{1,100}$/);assert.match(row.sourceBodySha256,/^[a-f0-9]{64}$/);assert.match(row.receiptId,/^[\w.:-]{1,160}$/);
 assert.equal(row.support?.kind,'model_at_reviewed_point');assert.equal(row.support.locationId,point.id);assert.ok(['nearest_grid_point','bilinear_interpolation','provider_point_projection'].includes(row.support.method));
 assert.ok(row.support.methodEvidenceId&&typeof row.support.methodEvidenceId==='string');assert.match(row.support.spatialFootprintId,/^[\w.:-]{1,160}$/,'actual grid footprint required');
 if(model.projection==='deterministic')assert.equal(row.memberId,null);else assert.ok(model.memberIds?.includes(row.memberId),'unknown ensemble member');
 const variable=VARIABLES[row.variable];assert.ok(variable,'unreviewed variable/averaging semantics');
 const start=time(row.validStart),end=time(row.validEnd);assert.ok(variable.interval?end>start:end===start,'wrong forecast interval');
 if(variable.interval)assert.ok(end-start<=24*3600000,'unbounded accumulation interval');
 const retrieved=time(row.firstRetrievedAt);if(row.sourceIssuedAt!==undefined&&row.sourceIssuedAt!==null){assert.ok(time(row.sourceIssuedAt)<=retrieved);if(row.modelReferenceTime!==null)assert.ok(time(row.sourceIssuedAt)>=time(row.modelReferenceTime));}if(row.modelReferenceTime!==null)assert.ok(time(row.modelReferenceTime)<=retrieved,'model reference after retrieval');
 if(row.firstAvailableAt!==null){assert.ok(time(row.firstAvailableAt)<=retrieved,'availability after retrieval');if(row.modelReferenceTime!==null)assert.ok(time(row.firstAvailableAt)>=time(row.modelReferenceTime));}
 let value=row.value;if(row.variable==='precipitation_probability')value=probability(value,row.unit);else {assert.equal(row.unit,variable.unit,'explicit source unit mismatch');if(value!==null)number(value,variable.min,variable.max);}
 const event=row.eventDefinition??null;
 if(row.variable==='precipitation_probability'){assert.equal(event?.kind,'precipitation_at_least');number(event.thresholdMm,0.01,100);assert.equal(event.intervalMinutes,(end-start)/60000);}else assert.equal(event,null);
 return {...row,unit:variable.unit,value,dependencyGroup:model.dependencyGroup,eventDefinition:event};
}
const targetIdentity=row=>({locationId:row.locationId,variable:row.variable,unit:row.unit,validStart:time(row.validStart),validEnd:time(row.validEnd),eventDefinition:row.eventDefinition});
const memberIdentity=row=>[row.locationId,row.modelId,row.modelVersion,row.modelReferenceTime===null?null:time(row.modelReferenceTime),time(row.validStart),time(row.validEnd),row.variable,stableJson(row.eventDefinition),row.memberId].join('|');
const productIdentity=row=>[row.modelId,row.modelVersion,time(row.modelReferenceTime)].join('|');
function weightedQuantile(rows,q){const sorted=rows.slice().sort((a,b)=>a.value-b.value);let accumulated=0;for(const row of sorted){accumulated+=row.weight;if(accumulated>=q-1e-12)return row.value;}return sorted.at(-1).value;}
export function aggregateModels({rows,locations,registry,issuedAt,targets,minFamilies=2,coverageManifest=null}){
 const issued=time(issuedAt),points=locationContract(locations),models=validateModelRegistry(registry);assert.ok(Number.isInteger(minFamilies)&&minFamilies>=2);assert.ok(Array.isArray(rows)&&rows.length<=100000);assert.ok(Array.isArray(targets)&&targets.length<=2000);
 const registrySha256=digest(registry),locationsSha256=digest(locations),normalized=rows.map(r=>normalizeForecast(r,{locations,registry}));
 const unique=new Map();for(const row of normalized){const key=memberIdentity(row),old=unique.get(key);if(old)assert.equal(stableJson(old),stableJson(row),'conflicting duplicate/member mirror');else unique.set(key,row);}
 const eligible=[],excluded=[];
 for(const row of unique.values()){
  const model=models.get(row.modelId),source=registry.sources.find(s=>s.id===model.sourceId);let reason=null;
  if(!model.enabled||!source.enabled)reason='source_or_model_not_admitted';
  else if(model.projection==='ensemble'&&model.memberIdentityStatus!=='verified')reason='ensemble_member_identity_unverified';
  else if(row.modelReferenceTime===null)reason='unknown_model_reference_time';
  else if(time(row.firstRetrievedAt)>issued||row.firstAvailableAt!==null&&time(row.firstAvailableAt)>issued)reason='not_available_at_issuance';
  else if(time(row.modelReferenceTime)>issued||issued-time(row.modelReferenceTime)>=model.maxRunAgeHours*3600000)reason='future_or_stale_run';
  else if(time(row.validEnd)<=issued||time(row.validStart)<issued)reason='expired_or_already_started_target';
  if(reason)excluded.push({receiptId:row.receiptId,modelId:row.modelId,locationId:row.locationId,reason});else eligible.push(row);
 }
 const targetKeys=new Set();
 const outputs=[];
 for(const target of targets){
  assert.deepEqual(Object.keys(target).sort(),['eventDefinition','locationId','unit','validEnd','validStart','variable']);
  const uniqueTarget=stableJson(targetIdentity(target));assert.ok(!targetKeys.has(uniqueTarget),'duplicate target');targetKeys.add(uniqueTarget);
  const start=time(target.validStart),end=time(target.validEnd),spec=VARIABLES[target.variable];assert.ok(spec);assert.ok(spec.interval?end>start:end===start,'wrong target interval');
  if(target.variable==='precipitation_probability'){assert.equal(target.eventDefinition?.kind,'precipitation_at_least');number(target.eventDefinition.thresholdMm,.01,100);assert.equal(target.eventDefinition.intervalMinutes,(end-start)/60000);}else assert.equal(target.eventDefinition,null);
  assert.ok(points.has(target.locationId));assert.ok(VARIABLES[target.variable]);assert.equal(target.unit,VARIABLES[target.variable].unit);time(target.validStart);time(target.validEnd);
  const key=stableJson(targetIdentity(target)),matching=eligible.filter(r=>stableJson(targetIdentity(r))===key),products=[];
  for(const model of models.values()){
   const runs=new Map();for(const row of matching.filter(x=>x.modelId===model.id)){const k=productIdentity(row);if(!runs.has(k))runs.set(k,[]);runs.get(k).push(row);}
   const ordered=[...runs.values()].sort((a,b)=>time(b[0].modelReferenceTime)-time(a[0].modelReferenceTime));
   if(!ordered.length)continue;
   const selected=ordered[0];assert.ok(!ordered[1]||time(ordered[1][0].modelReferenceTime)!==time(selected[0].modelReferenceTime),'ambiguous same-cycle model revision'); // Never silently fall back from a partial newest cycle.
   if(selected.some(row=>row.value===null)){excluded.push({modelId:model.id,locationId:target.locationId,reason:'newest_run_missing_value'});continue;}
   if(model.projection==='ensemble'&&(selected.length!==model.memberIds.length||!model.memberIds.every(id=>selected.some(r=>r.memberId===id)))){excluded.push({modelId:model.id,locationId:target.locationId,reason:'partial_newest_ensemble'});continue;}
   if(model.projection==='deterministic')assert.equal(selected.length,1,'multiple revisions in one issued cycle');
   products.push({modelId:model.id,dependencyGroup:model.dependencyGroup,value:mean(selected.map(r=>r.value)),rows:selected});
  }
  const families=[...new Set(products.map(x=>x.dependencyGroup))].sort(),expectedModels=registry.models.filter(m=>m.enabled&&registry.sources.some(s=>s.id===m.sourceId&&s.enabled)).map(m=>m.id),missingModels=expectedModels.filter(id=>!products.some(p=>p.modelId===id));
  if(families.length<minFamilies){outputs.push({target,status:'unavailable',reason:'insufficient_admitted_families',availableFamilies:families,missingModels,prediction:null});continue;}
  const familyValues=families.map(family=>{const p=products.filter(x=>x.dependencyGroup===family);return {family,value:mean(p.map(x=>x.value)),modelIds:p.map(x=>x.modelId).sort(),weight:1/families.length};});
  const distribution=products.flatMap(p=>p.rows.map(row=>({value:row.value,weight:1/families.length/products.filter(x=>x.dependencyGroup===p.dependencyGroup).length/p.rows.length})));
  const prediction=mean(familyValues.map(x=>x.value));
  const frozen={version:1,kind:'derived_model_aggregate',algorithm:ALGORITHM,issuedAt,target,registrySha256,locationsSha256,minFamilies,coverageManifest,issuanceInputs:[...unique.values()].sort((a,b)=>memberIdentity(a).localeCompare(memberIdentity(b))),prediction,families:familyValues,contributors:products.flatMap(x=>x.rows).sort((a,b)=>memberIdentity(a).localeCompare(memberIdentity(b))),gateAtIssue:{selected:'family_balanced_baseline',calibration:'unavailable',automaticPromotion:false},uncertainty:{kind:'uncalibrated_model_spread_not_prediction_interval',p10:weightedQuantile(distribution,.1),median:weightedQuantile(distribution,.5),p90:weightedQuantile(distribution,.9),independentSampleCount:null,coverageProbability:null},accuracyClaim:null};
  outputs.push({target,status:missingModels.length?'partial':'available',availableFamilies:families,missingModels,prediction,candidate:{...frozen,id:digest(frozen)}});
 }
 return {version:1,kind:'halifax_model_aggregation',issuedAt,algorithm:ALGORITHM,outputs,excluded,automaticPromotion:false,accuracyImprovementEstablished:false};
}
export function coreHeadline(result,locations,{variable,validStart,validEnd}){
 const points=[...locationContract(locations).values()].filter(p=>p.role==='core'),rows=points.map(point=>{const matches=result.outputs.filter(x=>x.target.locationId===point.id&&x.target.variable===variable&&x.target.validStart===validStart&&x.target.validEnd===validEnd);assert.ok(matches.length<=1,'ambiguous core target');return matches[0];});
 if(rows.some(x=>!x?.candidate))return {status:'unavailable',reason:'all_three_core_points_required',value:null};
 const semantics=rows.map(x=>stableJson({unit:x.target.unit,eventDefinition:x.target.eventDefinition??null}));if(new Set(semantics).size!==1)return {status:'unavailable',reason:'inconsistent_point_variable_or_event_semantics',value:null};
 const families=rows.map(x=>stableJson(x.availableFamilies));if(new Set(families).size!==1)return {status:'unavailable',reason:'inconsistent_point_family_coverage',value:null};
 return {status:rows.some(x=>x.status==='partial')?'partial':'available',kind:'equal_mean_of_all_three_core_points_only',locationIds:points.map(p=>p.id),value:mean(rows.map(x=>x.prediction)),unit:rows[0].target.unit,eventDefinition:rows[0].target.eventDefinition??null,validStart,validEnd,availableFamilies:rows[0].availableFamilies,wholeMunicipalityCoverageCertified:false,sharedSpatialFootprints:[...new Set(rows.flatMap(x=>x.candidate.contributors.map(r=>r.modelId+':'+r.support.spatialFootprintId)))],independentPointSampleCount:null,accuracyImprovementEstablished:false};
}
export function verifyFrozenCandidate(candidate){const {id,...frozen}=candidate;assert.equal(id,digest(frozen),'issued candidate/gate mutated');assert.equal(frozen.kind,'derived_model_aggregate');assert.equal(frozen.algorithm,ALGORITHM);assert.equal(frozen.gateAtIssue.automaticPromotion,false);return candidate;}
