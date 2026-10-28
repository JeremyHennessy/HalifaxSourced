/* Browser/Node view-time policy. TTLs are application limits, not ECCC guarantees. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HalifaxWeatherContract=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const LIMITS=Object.freeze({observationMs:2*3600000,receiptMs:2*3600000,forecastIssueMs:18*3600000,warningReceiptMs:30*60000,warningSourceMs:90*60000});
  const time=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)?Date.parse(value):NaN;
  const recent=(value,now,limit)=>Number.isFinite(now)&&Number.isFinite(time(value))&&now>=time(value)&&now-time(value)<limit;
  function evaluate(envelope,now=Date.now()) {
    const unavailable={forecast:{status:'unavailable',data:null,hourly:[]},observations:[],warnings:{status:'unavailable',checkedAt:null,sourceUpdatedAts:[]},retrievedAt:null};
    const data=envelope?.version===1?envelope.lastKnownGood:null;
    if(!data||data.version!==1||!Array.isArray(data.forecast?.hourly)||!Array.isArray(data.observations)) return unavailable;
    const retrievedAt=data.retrievedAt;
    const latestOk=envelope.lastAttempt?.status==='success'&&envelope.lastAttempt.completedAt===retrievedAt;
    const receiptFresh=latestOk&&recent(retrievedAt,now,LIMITS.receiptMs);
    const futureHour=data.forecast.hourly.some(x=>time(x.validAt)>now);
    const forecastFresh=receiptFresh&&recent(data.forecast.issuedAt,now,LIMITS.forecastIssueMs)&&recent(data.forecast.hourlyIssuedAt,now,LIMITS.forecastIssueMs)&&futureHour;
    const observations=data.observations.map(x=>({...x,status:receiptFresh&&recent(x.observedAt,now,LIMITS.observationMs)?'fresh':'stale'}));
    const warnings=data.warnings;
    const warningFresh=latestOk&&warnings?.complete===true&&warnings.checkedAt===retrievedAt&&recent(warnings.checkedAt,now,LIMITS.warningReceiptMs)&&Array.isArray(warnings.sourceUpdatedAts)&&warnings.sourceUpdatedAts.length===2&&warnings.sourceUpdatedAts.every(t=>recent(t,now,LIMITS.warningSourceMs))&&JSON.stringify(warnings.sourceRecordIds)===JSON.stringify(['ns-19','ns-40']);
    let warningStatus='unavailable';
    if(warningFresh&&warnings.state==='none_listed_in_successful_response'&&warnings.count===0&&Array.isArray(warnings.items)&&warnings.items.length===0)warningStatus='none_reported';
    else if(warningFresh&&warnings.state==='notice_requires_official_source'&&warnings.count>0&&warnings.items?.length===warnings.count)warningStatus='notice';
    return {forecast:{status:forecastFresh?'fresh':'stale',data:data.forecast,hourly:data.forecast.hourly},observations,warnings:{...warnings,status:warningStatus},retrievedAt};
  }
  return Object.freeze({LIMITS,evaluate});
});
