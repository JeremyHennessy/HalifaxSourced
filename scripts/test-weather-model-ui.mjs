// Offline contract + rendered-markup tests. No browser/source transport is permitted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let networkCalls = 0;
const context = {window:{}, Date, Intl, URL, Map, Set, escapeHtml, fetch(){networkCalls++;throw Error('No weather source network in UI tests');}};
vm.createContext(context);
for (const file of ['../weather-model-contract.js','../app-weather.js','../app-weather-models.js']) vm.runInContext(read(file), context);
const points = JSON.parse(read('../data/weather-locations.json')).points.slice(0,3);
const models = [{id:'gfs',name:'GFS',sourceId:'noaa',family:'gfs',maxRunAgeHours:18},{id:'ecmwf_ifs',name:'ECMWF IFS',sourceId:'ecmwf',family:'ecmwf',maxRunAgeHours:24}];
const sourceStates = [
 {id:'noaa',name:'NOAA/NCEP',status:'accepted',reason:'Reviewed saved fields only.',termsUrl:'https://www.weather.gov/disclaimer',documentationUrl:'https://nomads.ncep.noaa.gov/',contributes:true},
 {id:'ecmwf',name:'ECMWF Open Data',status:'accepted',reason:'Reviewed saved fields only.',termsUrl:'https://apps.ecmwf.int/datasets/licences/general/',documentationUrl:'https://www.ecmwf.int/en/forecasts/datasets/open-data',contributes:true},
 {id:'open_meteo',name:'Open-Meteo',status:'held',reason:'Free API service eligibility not established.',termsUrl:'https://open-meteo.com/en/terms',documentationUrl:null,contributes:false},
 {id:'dwd',name:'DWD ICON',status:'held',reason:'Documentation access held.',termsUrl:null,documentationUrl:null,contributes:false},
 {id:'eccc',name:'ECCC numerical-model GeoMet',status:'held',reason:'GeoMet model route held; official guidance remains separate.',termsUrl:null,documentationUrl:null,contributes:false}
];
const fixture = {version:1,kind:'halifax_model_forecast_snapshot',issuedAt:'2026-10-28T04:40:00Z',lastAttempt:{status:'success',attemptedAt:'2026-10-28T04:19:00Z',completedAt:'2026-10-28T04:20:00Z'},refreshMode:'recorded_reviewed_snapshot_no_automatic_refresh',receiptMaxAgeHours:12,points,models,sourceStates,archiveSha256:'a'.repeat(64),accuracyImprovementEstablished:false,wholeMunicipalityCoverageCertified:false,contextPointCoverage:'not_in_this_capture',variableCoverage:['temperature_2m'],attribution:[{sourceId:'noaa',text:'NOAA data; derived by HalifaxSourced, no endorsement.',url:'https://www.weather.gov/disclaimer'},{sourceId:'ecmwf',text:'ECMWF modified information; CC BY 4.0, no endorsement.',url:'https://www.ecmwf.int/en/forecasts/datasets/open-data'}],limitations:['No prospective accuracy improvement established.'],forecasts:[]};
for (const hour of ['06','09','12','15','18']) for (const [index,point] of points.entries()) {
 const contributors = models.map(model => ({modelId:model.id,sourceId:model.sourceId,family:model.family,valueC:(model.id==='gfs'?8:12)+index,modelReferenceTime:model.id==='gfs'?'2026-10-28T00:00:00Z':'2026-10-27T18:00:00Z',sourceIssuedAt:null,firstAvailableAt:null,firstRetrievedAt:'2026-10-28T04:20:00Z',sourceUrl:model.id==='gfs'?'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?var_TMP=on':'https://data.ecmwf.int/forecasts/20261027/18z/ifs/0p25/oper/20261027180000-12h-oper-fc.grib2',sourceBodySha256:'b'.repeat(64),eligibleAtIssue:true,support:{gridLatitude:44.75,gridLongitude:-63.5,distanceKm:12}}));
 fixture.forecasts.push({locationId:point.id,validAt:`2026-10-28T${hour}:00:00Z`,predictionC:10+index,status:'available',families:['ecmwf','gfs'],spread:{kind:'uncalibrated_model_disagreement',minC:8+index,maxC:12+index},candidateId:'c'.repeat(64),contributors,omissions:[]});
}
const now = Date.parse('2026-10-28T04:50:00Z');
const evaluate = (data=fixture,clock=now) => context.window.HalifaxWeatherModelContract.evaluate(data,clock);
const render = (data=fixture,clock=now) => context.weatherModelsMarkup(data,clock);
const clone = () => structuredClone(fixture);
let tests = 0;
function test(name, action) {action();console.log(`ok ${++tests} - ${name}`);}
test('core mean is useful, exactly three points, equal families and temperature-only', () => {
 const result=evaluate();assert.equal(result.status,'fresh');assert.equal(result.currentHeadlines.length,5);assert.equal(result.currentHeadlines[0].predictionC,11);
 const html=render();for(const phrase of ['11°C','GFS + ECMWF IFS','Saved model capture · no automatic model refresh','Halifax Peninsula, Bedford and Dartmouth','No improvement in prediction accuracy','not a calibrated prediction interval','Clayton Park','Lower Sackville','Eastern Passage','Open-Meteo — held','DWD ICON — held','GeoMet — held'])assert.ok(html.includes(phrase),phrase);
 assert.match(html,/CC BY 4\.0/);assert.match(html,/NOAA data/);assert.doesNotMatch(html,/chance of rain|realtime prediction|improved accuracy/i);
});
test('missing point and partial one-family targets never silently renormalize', () => {
 const missing=clone();missing.forecasts=missing.forecasts.filter(row=>row.locationId!=='bedford');assert.equal(evaluate(missing).currentHeadlines.length,0);assert.match(render(missing),/All three core points/);
 const partial=clone();const row=partial.forecasts[0];row.contributors=row.contributors.slice(0,1);row.families=['gfs'];row.predictionC=null;row.candidateId=null;row.status='partial';row.spread.minC=row.spread.maxC=null;row.omissions=[{modelId:'ecmwf_ifs',status:'missing',reason:'No accepted field'}];
 assert.equal(evaluate(partial).currentHeadlines.length,4);assert.equal(evaluate(partial).headlines[0].predictionC,null);assert.match(render(partial),/Partial coverage/);
});
test('failed held pending unknown and partial latest attempts retain facts but never current', () => {
 for(const status of ['failed','held','pending','unknown','partial']){const data=clone();data.lastAttempt.status=status;const result=evaluate(data);assert.equal(result.currentHeadlines.length,0,status);assert.equal(result.forecasts[0].predictionC,10);assert.match(render(data),/No current three-point model forecast/);assert.match(render(data),/04:20:00Z/);}
 const held=clone();held.sourceStates[0].status='held';held.sourceStates[0].contributes=false;assert.equal(evaluate(held).currentHeadlines.length,0);
});
test('valid-time expiry, exact receipt TTL and model reference age are evaluated locally', () => {
 assert.equal(evaluate(fixture,Date.parse('2026-10-28T06:00:00Z')).headlines[0].status,'historical');
 assert.equal(evaluate(fixture,Date.parse('2026-10-28T16:20:00Z')).status,'stale');
 const late=clone();late.issuedAt='2026-10-28T17:30:00Z';late.lastAttempt={status:'success',attemptedAt:'2026-10-28T17:00:00Z',completedAt:'2026-10-28T17:01:00Z'};late.forecasts=late.forecasts.slice(0,3).map(row=>({...row,validAt:'2026-10-28T21:00:00Z',contributors:row.contributors.map(item=>({...item,firstRetrievedAt:'2026-10-28T17:01:00Z',modelReferenceTime:item.modelId==='gfs'?'2026-10-28T00:00:00Z':'2026-10-28T06:00:00Z'}))}));
 assert.equal(evaluate(late,Date.parse('2026-10-28T18:00:00Z')).status,'stale');
 const historical=render(fixture,Date.parse('2026-10-29T00:00:00Z'));assert.match(historical,/All saved valid times have passed/);assert.match(historical,/Past valid time · historical/);assert.doesNotMatch(historical,/Upcoming reviewed three-point/);
 assert.notEqual(context.weatherModelFreshnessKey(fixture,now),context.weatherModelFreshnessKey(fixture,Date.parse('2026-10-28T06:00:00Z')));
});
test('source reference is not publication; missing clocks, future receipts and impossible times fail closed', () => {
 for(const edit of [data=>data.forecasts[0].contributors[0].sourceIssuedAt=data.forecasts[0].contributors[0].modelReferenceTime,data=>data.forecasts[0].contributors[0].firstAvailableAt='2026-10-28T00:00:00Z',data=>data.forecasts[0].contributors[0].firstRetrievedAt='2026-10-28T05:00:00Z',data=>data.issuedAt='2026-02-30T00:00:00Z']){const data=clone();edit(data);assert.equal(evaluate(data).status,'unavailable');}
 assert.equal(evaluate(fixture,Date.parse('2026-10-28T04:30:00Z')).currentHeadlines.length,0);
 assert.match(render(),/Unknown — model cycle is not publication time/);assert.match(render(),/2026-10-27T18:00:00Z/);
});
test('wrong units, family aliases, invented probability and geography cannot leak to model view', () => {
 for(const edit of [data=>data.forecasts[0].predictionC=50,data=>data.forecasts[0].contributors[0].valueC='8',data=>data.forecasts[0].spread.kind='95_percent_confidence',data=>data.models[0].family='independent_gfs',data=>data.points[0].latitude=45,data=>data.forecasts[0].locationId='moncton',data=>data.forecasts.push(structuredClone(data.forecasts[0])),data=>data.variableCoverage=['precipitation_probability'],data=>data.accuracyImprovementEstablished=true]){const data=clone();edit(data);assert.equal(evaluate(data).status,'unavailable');assert.match(render(data),/No valid reviewed model capture/);}
});
test('safe escaping and source link allowlist; private source fields rejected', () => {
 const payload='<img src=x onerror="alert(1)"><script>bad</script>';const data=clone();data.points[0].name=payload;data.models[0].name=payload;data.sourceStates[2].name=payload;data.sourceStates[2].reason=payload;data.sourceStates[2].termsUrl='javascript:alert(1)';data.attribution[0].text=payload;data.attribution[0].url='https://evil.example/collect';
 const html=render(data);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img|javascript:|evil\.example/);
 const privateData=clone();privateData.forecasts[0].contributors[0].responseHeaders={authorization:'private'};assert.equal(evaluate(privateData).status,'unavailable');
 assert.equal(context.weatherModelLink('https://data.ecmwf.int@evil.example/','Source'),'');assert.equal(context.weatherModelLink('http://data.ecmwf.int/','Source'),'');
});
test('official warning remains above model section, then one original regional forecast; no API code', () => {
 const data=context.window.HalifaxWeatherModels=fixture;
 const page=context.weatherPageMarkup(null,null,now);assert.ok(page.indexOf('weatherWarningHeading')<page.indexOf('weatherModelsHeading'));assert.ok(page.indexOf('weatherModelsHeading')<page.indexOf('Regional forecast unavailable'));
 assert.match(page,/Warning status unavailable/);assert.equal((page.match(/id="weatherModelsHeading"/g)||[]).length,1);
 const index=read('../index.html');for(const file of ['weather-model-contract.js','data/weather-models.js'])assert.ok(index.indexOf(file)<index.indexOf('app-weather-models.js'));assert.ok(index.indexOf('app-weather-models.js')<index.indexOf('app-init.js'));
 for(const file of ['../weather-model-contract.js','../app-weather-models.js'])assert.doesNotMatch(read(file),/\bfetch\s*\(|XMLHttpRequest|new\s+(?:WebSocket|Image)\s*\(/);
 assert.equal(networkCalls,0);
});
test('actual packaged current snapshot passes semantic view contract without pinning future releases to a fixture clock', () => {
 vm.runInContext(read('../data/weather-models.js'),context);
 const actual=context.window.HalifaxWeatherModels;
 context.window.HalifaxWeatherModelContract.validate(actual);
 const atIssue=evaluate(actual,Date.parse(actual.issuedAt)+1);
 assert.equal(atIssue.points.length,3);if(actual.lastAttempt.status!=='success')assert.equal(atIssue.currentHeadlines.length,0);for(const headline of atIssue.currentHeadlines)assert.ok(headline.predictionC!==null&&headline.families.length===2);
 assert.ok(atIssue.forecasts.every(row=>row.contributors.every(item=>['noaa','ecmwf'].includes(item.sourceId))));
 const actualPage=render(actual,Date.parse(actual.issuedAt)+1);
 assert.match(actualPage,/This service is based on data and products of the European Centre/);
 assert.match(actualPage,/https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
 assert.ok(actualPage.indexOf('This service is based on data')<actualPage.indexOf('data-weather-model-details="halifax_peninsula"'),'required attribution must be visible before collapsed details');
 assert.doesNotMatch(actualPage,/Copernicus|authorization|set-cookie/i);
 assert.doesNotMatch(actualPage,/<a[^>]+href="https:\/\/(?:data\.ecmwf\.int|nomads\.ncep\.noaa\.gov)[^"]*(?:\.grib2|filter_gfs)/,'no full-bundle download link or browser API request');
 assert.match(actualPage,/Original field SHA-256/);
 const farFuture=evaluate(actual,Math.max(...actual.forecasts.map(row=>Date.parse(row.validAt)))+1);
 assert.equal(farFuture.currentHeadlines.length,0);assert.ok(['historical','unavailable'].includes(farFuture.status));
});
console.log(`${tests} offline multi-model UI groups passed; no network or accuracy claims.`);
