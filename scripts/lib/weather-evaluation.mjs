// Prospective evaluation only. No original-app pooled state, retrospective gate or auto-promotion.
import assert from 'node:assert/strict';
import {stamp} from './eccc-weather.mjs';
import {digest,stableJson,probability,mean,verifyFrozenCandidate,locationContract,aggregateModels,VARIABLES} from './weather-aggregation.mjs';
const time=x=>Date.parse(stamp(x));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function scoreIssuedCandidate(candidate,truth,{scoredAt,locations,registry}){
 verifyFrozenCandidate(candidate);
 const rebuilt=aggregateModels({rows:candidate.issuanceInputs,locations,registry,issuedAt:candidate.issuedAt,targets:[candidate.target],minFamilies:candidate.minFamilies,coverageManifest:candidate.coverageManifest}).outputs[0]?.candidate;assert.equal(rebuilt?.id,candidate.id,'candidate not reproducible from admitted registry and frozen inputs');
 const points=locationContract(locations),point=points.get(candidate.target.locationId);assert.ok(point);
 assert.equal(truth.version,1);assert.equal(truth.kind,'observation','current radar, analysis and model estimates are not interchangeable truth');
 assert.equal(truth.locationId,point.id);assert.equal(truth.latitude,point.latitude);assert.equal(truth.longitude,point.longitude,'airport truth cannot silently verify a different point');
 assert.equal(truth.support?.kind,'observation_at_exact_point');assert.equal(truth.support.locationId,point.id);assert.ok(typeof truth.support.instrumentId==='string'&&truth.support.instrumentId.length>0);
 assert.match(truth.receiptId,/^[\w.:-]{1,160}$/);assert.match(truth.sourceBodySha256,/^[a-f0-9]{64}$/);assert.equal(truth.quality,'accepted');
 assert.equal(time(truth.validStart),time(candidate.target.validStart),'exact target required');assert.equal(time(truth.validEnd),time(candidate.target.validEnd),'exact accumulation window required');
 assert.ok(time(truth.firstAvailableAt)>=time(truth.validEnd));assert.ok(time(truth.firstRetrievedAt)>=time(truth.firstAvailableAt));assert.ok(time(truth.firstRetrievedAt)<=time(scoredAt),'truth not yet available for scoring');assert.ok(time(candidate.issuedAt)<time(candidate.target.validEnd));
 if(truth.value===null)return {status:'unscored',reason:'truth_missing',candidateId:candidate.id,truthReceiptId:truth.receiptId};
 let actual,error,brier=null;
 if(candidate.target.variable==='precipitation_probability'){
  assert.equal(truth.variable,'precipitation_amount');assert.equal(truth.unit,'mm');assert.ok(finite(truth.value)&&truth.value>=0&&truth.value<=VARIABLES.precipitation_amount.max,'truth physical bounds');actual=truth.value>=candidate.target.eventDefinition.thresholdMm?1:0;error=candidate.prediction-actual;brier=error**2;
 }else{assert.equal(truth.variable,candidate.target.variable);assert.equal(truth.unit,candidate.target.unit);assert.ok(finite(truth.value)&&truth.value>=VARIABLES[truth.variable].min&&truth.value<=VARIABLES[truth.variable].max,'truth physical bounds');actual=truth.value;error=candidate.prediction-actual;}
 assert.ok([actual,error,Math.abs(error),error**2].every(finite),'non-finite score');
 const scored={version:1,kind:'prospective_weather_score',modelVersionsKnown:candidate.contributors.every(r=>r.modelVersion!=='unknown'),candidateId:candidate.id,algorithm:candidate.algorithm,registrySha256:candidate.registrySha256,locationsSha256:candidate.locationsSha256,modelVersionSignature:digest([...new Set(candidate.contributors.map(r=>r.modelId+':'+r.modelVersion))].sort()),issuedAt:candidate.issuedAt,target:candidate.target,gateAtIssue:candidate.gateAtIssue,predicted:candidate.prediction,actual,error,absoluteError:Math.abs(error),squaredError:error**2,brier,truthReceiptId:truth.receiptId,truthSourceBodySha256:truth.sourceBodySha256,truthFirstAvailableAt:truth.firstAvailableAt,truthFirstRetrievedAt:truth.firstRetrievedAt,scoredAt,accuracyClaim:null};
 return {status:'scored',...scored,id:digest(scored)};
}
export function trainingScope(candidate){verifyFrozenCandidate(candidate);assert.ok(candidate.contributors.every(r=>r.modelVersion!=='unknown'),'unknown model version cannot train calibration');return {algorithm:candidate.algorithm,registrySha256:candidate.registrySha256,locationsSha256:candidate.locationsSha256,modelVersionSignature:digest([...new Set(candidate.contributors.map(r=>r.modelId+':'+r.modelVersion))].sort())};}
export function eligibleTrainingScores(scores,{issuedAt,target,leadHours,scope}){
 const issue=time(issuedAt);assert.ok(finite(leadHours)&&leadHours>0);assert.ok(scope&&Object.keys(scope).sort().join(',')==='algorithm,locationsSha256,modelVersionSignature,registrySha256');const ids=new Set(),cases=new Set();
 return scores.filter(s=>{
  assert.equal(s.kind,'prospective_weather_score');const {status,id,...unsigned}=s;assert.equal(status,'scored');assert.equal(id,digest(unsigned),'mutated score');
  assert.ok(!ids.has(s.id)&&!cases.has(caseKey(s)),'duplicate training score/case or truth revision');ids.add(s.id);cases.add(caseKey(s));
  if(s.modelVersionsKnown!==true)return false;
  if(Object.entries(scope).some(([key,value])=>s[key]!==value))return false;
  if(s.target.locationId!==target.locationId||s.target.variable!==target.variable||s.target.unit!==target.unit||stableJson(s.target.eventDefinition)!==stableJson(target.eventDefinition))return false;
  // Target ordering alone leaks future outcomes into long-lead forecasts.
  if(time(s.truthFirstAvailableAt)>=issue||time(s.truthFirstRetrievedAt)>=issue||time(s.scoredAt)>=issue)return false;
  if(time(s.target.validEnd)>=issue||time(s.target.validStart)===time(target.validStart)||time(s.target.validEnd)===time(target.validEnd))return false;
  const lead=(time(s.target.validStart)-time(s.issuedAt))/3600000;return lead===leadHours;
 });
}
export function shrinkageBiasShadow(scores,{issuedAt,target,leadHours,priorStrength=20,minimumDays=20,maxCorrection=2,scope}){
 assert.equal(target.variable,'temperature_2m');assert.equal(target.unit,'C');assert.ok(priorStrength>0&&minimumDays>=20&&maxCorrection>0&&maxCorrection<=2);
 const eligible=eligibleTrainingScores(scores,{issuedAt,target,leadHours,scope}),byDay=new Map();for(const row of eligible){const day=row.target.validStart.slice(0,10);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(row.error);}
 const errors=[...byDay.values()].map(mean),days=errors.length;
 if(days<minimumDays)return {status:'learning',correctionC:null,days,rows:eligible.length,role:'shadow_only',automaticPromotion:false};
 const correction=-mean(errors)*days/(days+priorStrength);
 return {status:'shadow_available',correctionC:Math.max(-maxCorrection,Math.min(maxCorrection,correction)),days,rows:eligible.length,trainingScoreIds:eligible.map(x=>x.id).sort(),trainingCutoffExclusive:issuedAt,role:'shadow_only',automaticPromotion:false,accuracyClaim:null};
}
const caseKey=x=>stableJson({locationId:x.target.locationId,variable:x.target.variable,unit:x.target.unit,eventDefinition:x.target.eventDefinition,validStart:time(x.target.validStart),validEnd:time(x.target.validEnd),issuedAt:time(x.issuedAt)});
function metric(rows){return rows.length?{n:rows.length,mae:mean(rows.map(x=>x.absoluteError)),rmse:Math.sqrt(mean(rows.map(x=>x.squaredError))),bias:mean(rows.map(x=>x.error)),brier:rows.every(x=>x.brier!==null)?mean(rows.map(x=>x.brier)):null}:null;}
function quantile(xs,p){const x=xs.slice().sort((a,b)=>a-b),j=(x.length-1)*p,lo=Math.floor(j);return x[lo]+(x[Math.ceil(j)]-x[lo])*(j-lo);}
export function pairedProspectiveReport(challenger,baseline,{seed=1729,resamples=1000,blockDays=3}={}){
 assert.ok(Number.isInteger(resamples)&&resamples>=100&&resamples<=10000);assert.ok(Number.isInteger(blockDays)&&blockDays>=2&&blockDays<=14);
 const index=rows=>{const out=new Map();for(const row of rows){assert.equal(row.status,'scored');const {status,id,...unsigned}=row;assert.equal(id,digest(unsigned),'mutated score');const key=caseKey(row);assert.ok(!out.has(key),'duplicate prospective case');out.set(key,row);}return out;};
 const a=index(challenger),b=index(baseline),pairs=[];
 const semantics=new Set([...challenger,...baseline].map(s=>stableJson({variable:s.target.variable,unit:s.target.unit,eventDefinition:s.target.eventDefinition})));assert.ok(semantics.size<=1,'mixed variable/unit/event metric cohort');
 const probabilityCohort=[...challenger,...baseline][0]?.target.variable==='precipitation_probability';for(const [key,x]of a){const y=b.get(key);if(y){assert.equal(x.truthReceiptId,y.truthReceiptId,'paired score requires identical truth revision');assert.equal(x.truthSourceBodySha256,y.truthSourceBodySha256);assert.equal(x.actual,y.actual);pairs.push([x,y]);}}
 const byDay=new Map();for(const [x,y]of pairs){const day=x.target.validStart.slice(0,10);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(probabilityCohort?x.brier-y.brier:x.absoluteError-y.absoluteError);}
 const ordered=[...byDay].sort(([x],[y])=>x.localeCompare(y));const differences=ordered.map(([,v])=>mean(v));let interval=null;
 const blocks=ordered.map((_,start)=>ordered.slice(start,start+blockDays).length===blockDays&&ordered.slice(start,start+blockDays).every(([day],j)=>!j||Date.parse(day)-Date.parse(ordered[start+j-1][0])===86400000)?differences.slice(start,start+blockDays):null).filter(Boolean);
 if(differences.length>=30&&blocks.length>=10){let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};const draws=[];
  for(let r=0;r<resamples;r++){const sample=[];while(sample.length<differences.length){const block=blocks[Math.floor(random()*blocks.length)];sample.push(...block.slice(0,differences.length-sample.length));}draws.push(mean(sample));}interval={method:'deterministic_contiguous_calendar_day_block_bootstrap',blockDays,availableFullBlocks:blocks.length,resamples,seed,lower:quantile(draws,.025),upper:quantile(draws,.975),estimand:probabilityCohort?'equal_day_mean_paired_brier_difference':'equal_day_mean_paired_absolute_error_difference'};
 }
 const subgroups={};for(const [x,y]of pairs){const lead=(time(x.target.validStart)-time(x.issuedAt))/3600000;for(const key of [`point:${x.target.locationId}`,`lead_hours:${lead}`,`month:${x.target.validStart.slice(5,7)}`]){subgroups[key]??=[];subgroups[key].push([x,y]);}}
 return {version:1,status:pairs.length<100||byDay.size<30?'insufficient_independent_evidence':'independent_review_required',pairedCases:pairs.length,pairedTargetDays:byDay.size,challengerCoverage:a.size,baselineCoverage:b.size,unpairedChallenger:a.size-pairs.length,unpairedBaseline:b.size-pairs.length,challenger:metric(pairs.map(x=>x[0])),baseline:metric(pairs.map(x=>x[1])),loss:probabilityCohort?'brier':'absolute_error',pairedDayMeanLossDelta:differences.length?mean(differences):null,interval,intervalUnavailableReason:interval?null:byDay.size<30?'insufficient_target_days':'insufficient_contiguous_blocks',subgroups:Object.fromEntries(Object.entries(subgroups).map(([key,p])=>[key,{challenger:metric(p.map(x=>x[0])),baseline:metric(p.map(x=>x[1]))}])),automaticPromotion:false,accuracyImprovementEstablished:false,limitations:['Days and adjacent windows may remain correlated; block size needs predeclared sensitivity review.','No comparison to persistence, climatology or official guidance is implied unless those frozen paired forecasts are explicitly supplied.','No public claim or automatic model selection is made from this report.']};
}
