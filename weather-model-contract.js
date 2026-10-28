/* Offline view-time policy for reviewed Halifax model snapshots; not a source collector. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HalifaxWeatherModelContract=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const POINTS=[['halifax_peninsula',44.6488,-63.5752,'core'],['bedford',44.7318,-63.6619,'core'],['dartmouth',44.6661,-63.5676,'core'],['clayton_park',44.6718,-63.6530,'context'],['lower_sackville',44.7757,-63.6786,'context'],['eastern_passage',44.6109,-63.482,'context']];
  const MODELS={gfs:{sourceId:'noaa',family:'gfs',maxRunAgeHours:18},ecmwf_ifs:{sourceId:'ecmwf',family:'ecmwf',maxRunAgeHours:24}};
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const stamp=value=>{if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))return NaN;const ms=Date.parse(value);return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===value.slice(0,19)?ms:NaN;};
  const keys=(object,allowed)=>check(object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).every(key=>allowed.includes(key)),'unexpected model snapshot fields');
  const text=(value,max=240)=>check(typeof value==='string'&&value.length>0&&value.length<=max,'invalid text');
  const hash=value=>check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'invalid hash');
  const number=(value,min,max)=>check(finite(value)&&value>=min&&value<=max,'invalid model value');
  const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  function validate(snapshot){
    keys(snapshot,['version','kind','issuedAt','lastAttempt','refreshMode','receiptMaxAgeHours','points','models','sourceStates','forecasts','archiveSha256','accuracyImprovementEstablished','attribution','limitations','wholeMunicipalityCoverageCertified','contextPointCoverage','variableCoverage']);
    check(snapshot.version===1&&snapshot.kind==='halifax_model_forecast_snapshot','unknown snapshot');
    check(snapshot.refreshMode==='recorded_reviewed_snapshot_no_automatic_refresh'&&snapshot.receiptMaxAgeHours===12&&snapshot.accuracyImprovementEstablished===false,'unreviewed policy');
    check(snapshot.wholeMunicipalityCoverageCertified===false&&snapshot.contextPointCoverage==='not_in_this_capture'&&JSON.stringify(snapshot.variableCoverage)===JSON.stringify(['temperature_2m']),'unreviewed scope');
    check(Array.isArray(snapshot.attribution)&&snapshot.attribution.length<=10&&Array.isArray(snapshot.limitations)&&snapshot.limitations.length<=20,'attribution/limits required');
    for(const item of snapshot.attribution){keys(item,['sourceId','text','url','termsUrl','licenceUrl']);text(item.sourceId,60);text(item.text,1200);text(item.url,2048);if(item.termsUrl!==undefined)text(item.termsUrl,2048);if(item.licenceUrl!==undefined)text(item.licenceUrl,2048);}for(const item of snapshot.limitations)text(item,1200);
    const issue=stamp(snapshot.issuedAt);check(Number.isFinite(issue),'invalid issuance');hash(snapshot.archiveSha256);
    const attempt=snapshot.lastAttempt;keys(attempt,['status','attemptedAt','completedAt']);
    check(['success','partial','failed','held','pending','unknown'].includes(attempt.status),'unknown attempt state');
    check(Number.isFinite(stamp(attempt.attemptedAt)),'invalid attempt clock');
    check(attempt.completedAt===null||Number.isFinite(stamp(attempt.completedAt))&&stamp(attempt.completedAt)>=stamp(attempt.attemptedAt),'invalid completion clock');
    check(attempt.status!=='success'||stamp(attempt.completedAt)<=issue,'success after issuance');
    check(Array.isArray(snapshot.points)&&[3,6].includes(snapshot.points.length),'reviewed core-point scope required');
    const pointMap=new Map();for(let i=0;i<snapshot.points.length;i++){
      const point=snapshot.points[i];keys(point,['id','name','latitude','longitude','role']);text(point.name,100);
      check(JSON.stringify([point.id,point.latitude,point.longitude,point.role])===JSON.stringify(POINTS[i]),'unreviewed geography');pointMap.set(point.id,point);
    }
    check(Array.isArray(snapshot.models)&&snapshot.models.length===2,'reviewed model set required');const modelMap=new Map();
    for(const model of snapshot.models){keys(model,['id','name','sourceId','family','maxRunAgeHours']);const known=MODELS[model.id];check(known&&!modelMap.has(model.id),'unknown or duplicate model');text(model.name,100);check(model.sourceId===known.sourceId&&model.family===known.family&&model.maxRunAgeHours===known.maxRunAgeHours,'unreviewed model family/age');modelMap.set(model.id,model);}
    check(Array.isArray(snapshot.sourceStates)&&snapshot.sourceStates.length>=2&&snapshot.sourceStates.length<=30,'source states required');const sourceMap=new Map();
    for(const source of snapshot.sourceStates){keys(source,['id','name','status','reason','termsUrl','documentationUrl','contributes','accessState']);check(typeof source.id==='string'&&/^[a-z0-9_]{1,60}$/.test(source.id)&&!sourceMap.has(source.id),'invalid source identity');text(source.name,100);text(source.reason,1200);if(source.accessState!==undefined)text(source.accessState,240);check(['accepted','held','failed','unknown','unavailable'].includes(source.status)&&typeof source.contributes==='boolean','invalid source status');check(!source.contributes||source.status==='accepted','held source cannot contribute currently');for(const key of ['termsUrl','documentationUrl'])check(source[key]===null||source[key]===undefined||typeof source[key]==='string'&&source[key].length<=2048,'invalid source link');sourceMap.set(source.id,source);}
    check(sourceMap.has('noaa')&&sourceMap.has('ecmwf'),'contributor source state missing');
    check(Array.isArray(snapshot.forecasts)&&snapshot.forecasts.length<=180,'bounded forecasts required');const seen=new Set();
    for(const forecast of snapshot.forecasts){
      keys(forecast,['locationId','validAt','predictionC','status','families','spread','candidateId','contributors','omissions']);
      check(pointMap.has(forecast.locationId)&&Number.isFinite(stamp(forecast.validAt))&&stamp(forecast.validAt)>issue,'invalid forecast target');
      const identity=forecast.locationId+'|'+stamp(forecast.validAt);check(!seen.has(identity),'duplicate target');seen.add(identity);
      check(['available','partial','unavailable'].includes(forecast.status),'invalid forecast status');
      check(Array.isArray(forecast.contributors)&&forecast.contributors.length<=2&&Array.isArray(forecast.families),'invalid contribution coverage');const ids=new Set();
      for(const row of forecast.contributors){
        keys(row,['modelId','sourceId','family','valueC','modelReferenceTime','sourceIssuedAt','firstAvailableAt','firstRetrievedAt','sourceUrl','sourceBodySha256','support','eligibleAtIssue']);
        const model=modelMap.get(row.modelId);check(model&&!ids.has(row.modelId)&&row.sourceId===model.sourceId&&row.family===model.family,'invalid contributor identity');ids.add(row.modelId);check(typeof row.eligibleAtIssue==='boolean','eligibility required');number(row.valueC,-100,70);hash(row.sourceBodySha256);
        check(Number.isFinite(stamp(row.modelReferenceTime))&&Number.isFinite(stamp(row.firstRetrievedAt))&&stamp(row.modelReferenceTime)<=stamp(row.firstRetrievedAt)&&stamp(row.firstRetrievedAt)<=issue,'invalid contributor clocks');
        check(row.sourceIssuedAt===null&&row.firstAvailableAt===null,'unknown publication/availability must remain unknown');text(row.sourceUrl,2048);
        keys(row.support,['gridLatitude','gridLongitude','distanceKm']);number(row.support.gridLatitude,44.25,45);number(row.support.gridLongitude,-64,-63.25);number(row.support.distanceKm,0,30);
      }
      const eligible=forecast.contributors.filter(row=>row.eligibleAtIssue);const families=[...new Set(eligible.map(row=>row.family))].sort();check(JSON.stringify(forecast.families)===JSON.stringify(families),'false family coverage');
      keys(forecast.spread,['kind','minC','maxC']);check(forecast.spread.kind==='uncalibrated_model_disagreement','spread is not calibrated confidence');
      check(Array.isArray(forecast.omissions)&&forecast.omissions.length<=2,'omissions required');for(const omission of forecast.omissions){keys(omission,['modelId','status','reason']);check(modelMap.has(omission.modelId),'unknown omitted model');text(omission.status,60);text(omission.reason,1200);}
      const values=forecast.predictionC===null?[]:eligible.map(row=>row.valueC);check(forecast.spread.minC===(values.length?Math.min(...values):null)&&forecast.spread.maxC===(values.length?Math.max(...values):null),'incorrect raw spread');
      if(forecast.predictionC===null){check(['partial','unavailable'].includes(forecast.status)&&forecast.candidateId===null,'unavailable aggregate must stay absent');}
      else{check(['available','partial'].includes(forecast.status),'unavailable aggregate cannot carry a prediction');check(families.length===2,'two families required');number(forecast.predictionC,-100,70);check(Math.abs(forecast.predictionC-mean(values))<1e-8,'incorrect family-balanced temperature');hash(forecast.candidateId);}
    }
    return {pointMap,modelMap,sourceMap};
  }
  function evaluate(snapshot,now=Date.now()){
    const empty={status:'unavailable',reason:'No valid reviewed multi-model snapshot is available.',points:[],models:[],sourceStates:[],forecasts:[],headlines:[],currentHeadlines:[],contextPoints:[],lastAttempt:null};
    try{
      check(Number.isFinite(now),'invalid viewing clock');const {modelMap,sourceMap}=validate(snapshot);
      const latestOk=snapshot.lastAttempt.status==='success'&&stamp(snapshot.issuedAt)<=now&&stamp(snapshot.lastAttempt.completedAt)<=now;
      const forecasts=snapshot.forecasts.map(row=>{
        let viewState='fresh';
        if(stamp(row.validAt)<=now)viewState='historical';
        else if(!latestOk||row.contributors.some(item=>sourceMap.get(item.sourceId)?.status!=='accepted'||!sourceMap.get(item.sourceId)?.contributes))viewState='retained';
        else if(row.contributors.some(item=>now<stamp(item.firstRetrievedAt)||now-stamp(item.firstRetrievedAt)>=12*3600000||now<stamp(item.modelReferenceTime)||now-stamp(item.modelReferenceTime)>=modelMap.get(item.modelId).maxRunAgeHours*3600000))viewState='stale';
        else if(row.status==='unavailable')viewState='unavailable';
        else if(row.status==='partial')viewState='partial';
        return {...row,viewState,current:row.predictionC!==null&&['fresh','partial'].includes(viewState)};
      });
      const core=snapshot.points.filter(point=>point.role==='core');
      const headlines=[...new Map(forecasts.map(row=>[stamp(row.validAt),row.validAt])).values()].sort((a,b)=>stamp(a)-stamp(b)).map(validAt=>{
        const rows=core.map(point=>forecasts.find(row=>row.locationId===point.id&&stamp(row.validAt)===stamp(validAt)));
        const complete=rows.every(row=>row&&row.predictionC!==null)&&new Set(rows.map(row=>JSON.stringify(row?.families))).size===1;
        if(!complete)return {validAt,status:'unavailable',predictionC:null,current:false,reason:'All three core points and matching model families are required.'};
        const current=rows.every(row=>row.current);const status=rows.some(row=>row.viewState==='historical')?'historical':rows.some(row=>row.viewState==='retained')?'retained':rows.some(row=>row.viewState==='stale')?'stale':rows.some(row=>row.viewState==='partial')?'partial':'fresh';
        return {validAt,status,predictionC:mean(rows.map(row=>row.predictionC)),current,families:rows[0].families};
      });
      const currentHeadlines=headlines.filter(row=>row.current);const status=currentHeadlines.length?(currentHeadlines.some(row=>row.status==='partial')||headlines.some(row=>stamp(row.validAt)>now&&!row.current)?'partial':'fresh'):headlines.length&&headlines.every(row=>row.status==='historical')?'historical':!latestOk?'retained':headlines.some(row=>row.status==='stale')?'stale':'unavailable';
      return {status,reason:null,issuedAt:snapshot.issuedAt,lastAttempt:snapshot.lastAttempt,points:snapshot.points,models:snapshot.models,sourceStates:snapshot.sourceStates,forecasts,headlines,currentHeadlines,attribution:snapshot.attribution,limitations:snapshot.limitations,contextPoints:POINTS.filter(point=>point[3]==='context').map(point=>({id:point[0],name:({clayton_park:'Clayton Park',lower_sackville:'Lower Sackville',eastern_passage:'Eastern Passage'})[point[0]]}))};
    }catch{return empty;}
  }
  return Object.freeze({evaluate,validate});
});
