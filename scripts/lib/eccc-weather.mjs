// Offline, strict Halifax-only admission. No HTTP imports or wall-clock synthesis.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const ENDPOINT = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&lang=en&bbox=-63.61,44.63,-63.55,44.67&limit=3';
export const REGION = 'Halifax Metro and Halifax County West';
export const EXPECTED = Object.freeze([
  {id:'ns-19', name:'Halifax', point:[-63.6,44.65], station:'yhz', stationName:"Halifax Stanfield Int'l Airport", latitude:'44.88N', longitude:'63.51W', url:'https://weather.gc.ca/en/location/index.html?coords=44.65,-63.6'},
  {id:'ns-40', name:'Halifax (Shearwater)', point:[-63.56,44.67], station:'yaw', stationName:'Shearwater Airport', latitude:'44.63N', longitude:'63.50W', url:'https://weather.gc.ca/en/location/index.html?coords=44.67,-63.56'}
]);
export const REVIEWED_POINTS = Object.freeze([
  {name:'Halifax Peninsula', latitude:44.6488, longitude:-63.5752},
  {name:'Bedford', latitude:44.7318, longitude:-63.6619},
  {name:'Dartmouth', latitude:44.6661, longitude:-63.5676},
  {name:'Clayton Park', latitude:44.6718, longitude:-63.6530},
  {name:'Lower Sackville', latitude:44.7757, longitude:-63.6786},
  {name:'Eastern Passage', latitude:44.6109, longitude:-63.4820}
]);
export const hash = value => createHash('sha256').update(value).digest('hex');
export function stamp(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
  assert.ok(Number.isFinite(Date.parse(value)), 'invalid source clock');
  // Date.parse accepts impossible month days; never silently normalize those.
  assert.equal(new Date(value).toISOString().slice(0,19), value.slice(0,19));
  return value;
}
const text = value => { assert.ok(typeof value === 'string' && value.length > 0 && value.length < 12000); return value; };
export function metric(node, unit, min = -Infinity, max = Infinity) {
  if (node === null || node === undefined) return null;
  assert.equal(node.units?.en, unit, 'unreviewed source units');
  const value = node.value?.en;
  if (value === null || value === undefined) return null;
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, 'invalid metric');
  return value; // A declared 0.75% remains 0.75%, never 75%.
}
function notFuture(value, retrievedAt, path, role) {
  stamp(value);
  if(Date.parse(value)>Date.parse(retrievedAt)){
    const error=new assert.AssertionError({message:`future source clock at ${path} (${role})`,actual:value,expected:retrievedAt,operator:'<='});
    error.weatherClock={kind:'future_source_clock',path,role,value,retrievedAt,aheadByMilliseconds:Date.parse(value)-Date.parse(retrievedAt)};
    throw error;
  }
  return value;
}
export function projectEccc(body, receipt) {
  assert.equal(typeof body, 'string'); assert.ok(Buffer.byteLength(body) <= 524288);
  assert.equal(receipt.url, ENDPOINT); assert.equal(receipt.httpStatus, 200);
  assert.match(receipt.responseHeaders?.['content-type'] || '', /^application\/(?:geo\+)?json(?:;|$)/i);
  assert.equal(receipt.sha256, hash(body), 'receipt/body mismatch');
  assert.equal(receipt.bodyBytes, Buffer.byteLength(body));
  const retrievedAt = stamp(receipt.retrievedAt);
  notFuture(receipt.attemptedAt,retrievedAt,'receipt.attemptedAt','acquisition_request'); notFuture(receipt.responseAt,retrievedAt,'receipt.responseAt','acquisition_response');
  assert.ok(Date.parse(receipt.responseAt) >= Date.parse(receipt.attemptedAt));
  const raw = JSON.parse(body);
  assert.equal(raw.type, 'FeatureCollection'); assert.equal(raw.numberMatched, 2); assert.equal(raw.numberReturned, 2);
  assert.ok(Array.isArray(raw.features)); assert.equal(raw.features.length, 2);
  assert.ok(Array.isArray(raw.links)); assert.ok(!raw.links.some(x => x.rel === 'next'), 'partial city pages');
  const apiResponseGeneratedAt = notFuture(raw.timeStamp,retrievedAt,'FeatureCollection.timeStamp','api_response_generated_at');
  assert.equal(new Set(raw.features.map(f => f.id)).size, 2);
  const features = EXPECTED.map(expected => {
    const f = raw.features.find(f => f.id === expected.id); assert.ok(f, 'unexpected city record');
    const p = f.properties;
    assert.equal(p.identifier, expected.id); assert.equal(p.name?.en, expected.name);
    assert.deepEqual(f.geometry, {type:'Point', coordinates:expected.point});
    assert.equal(p.region?.en, REGION); assert.equal(p.url?.en, expected.url);
    const station = p.currentConditions?.station;
    assert.equal(station?.code?.en, expected.station); assert.equal(station?.value?.en, expected.stationName);
    assert.equal(station?.lat?.en, expected.latitude); assert.equal(station?.lon?.en, expected.longitude);
    assert.ok(Array.isArray(p.warnings) && p.warnings.length <= 30, 'missing/unbounded warnings');
    assert.ok(p.warnings.every(w => w && typeof w === 'object' && !Array.isArray(w)), 'unreviewed warning shape');
    for(const [field,clock,role] of [['lastUpdated',p.lastUpdated,'source_updated_at'],['currentConditions.timestamp.en',p.currentConditions.timestamp?.en,'station_observed_at'],['forecastGroup.timestamp.en',p.forecastGroup?.timestamp?.en,'regional_forecast_issued_at'],['hourlyForecastGroup.timestamp.en',p.hourlyForecastGroup?.timestamp?.en,'hourly_forecast_issued_at']])notFuture(clock,retrievedAt,`features[${expected.id}].properties.${field}`,role);
    assert.ok(Date.parse(p.currentConditions.timestamp.en) <= Date.parse(p.lastUpdated));
    return f;
  });
  const p = features[0].properties, other = features[1].properties;
  assert.deepEqual(p.forecastGroup, other.forecastGroup, 'regional products diverged: review required');
  assert.deepEqual(p.hourlyForecastGroup, other.hourlyForecastGroup, 'hourly regional products diverged');
  const hourlyRaw = p.hourlyForecastGroup.hourlyForecasts;
  assert.ok(Array.isArray(hourlyRaw)); assert.equal(hourlyRaw.length,24);
  const hourly = hourlyRaw.map((x,i) => {
    const validAt=stamp(x.timestamp);
    assert.ok(Date.parse(validAt) > Date.parse(p.hourlyForecastGroup.timestamp.en));
    if(i) assert.equal(Date.parse(validAt)-Date.parse(hourlyRaw[i-1].timestamp),3600000,'hourly gap');
    return {validAt,temperatureC:metric(x.temperature,'C',-100,70),condition:x.condition?.en == null ? null : text(x.condition.en),precipitationProbabilityPercent:metric(x.lop,'%',0,100),precipitationAmountMm:null,windSpeedKmh:metric(x.wind?.speed,'km/h',0,500),windGustKmh:metric(x.wind?.gust,'km/h',0,500),windDirection:x.wind?.direction?.value?.en ?? null};
  });
  assert.ok(Array.isArray(p.forecastGroup.forecasts) && p.forecastGroup.forecasts.length > 0 && p.forecastGroup.forecasts.length <= 16);
  const periods = p.forecastGroup.forecasts.map(x => ({publisherPeriodLabel:text(x.period?.value?.en),publisherDisplayLabel:text(x.period?.textForecastName?.en),validTimePrecision:'publisher_period_label',validFrom:null,validTo:null,summary:text(x.textSummary?.en),temperatures:(x.temperatures?.temperature || []).map(t=>({kind:text(t.class?.en),valueC:metric(t,'C',-100,70)}))}));
  const observations=features.map(f=>{const p=f.properties,c=p.currentConditions; return {recordId:f.id,kind:'station_observation',stationCode:c.station.code.en,stationName:c.station.value.en,sourceStationCoordinateText:{latitude:c.station.lat.en,longitude:c.station.lon.en},locationRole:'Named supporting station; not a neighborhood or downtown reading.',observedAt:c.timestamp.en,sourceUpdatedAt:p.lastUpdated,retrievedAt,temperatureC:metric(c.temperature,'C',-100,70),relativeHumidityPercent:metric(c.relativeHumidity,'%',0,100),windSpeedKmh:metric(c.wind?.speed,'km/h',0,500),windGustKmh:metric(c.wind?.gust,'km/h',0,500),windDirection:c.wind?.direction?.value?.en ?? null,pressureKpa:metric(c.pressure,'kPa',0,150),sourceUrl:p.url.en};});
  const warnings=features.flatMap(f=>f.properties.warnings.map(original=>({sourceRecordId:f.id,original})));
  return {version:1,fixture:true,admissionState:'reviewed_eccc_recorded_snapshot_not_operationally_activated',provider:'Environment and Climate Change Canada',attribution:'Data Source: Environment and Climate Change Canada',licenceUrl:'https://eccc-msc.github.io/open-data/licence/readme_en/',usagePolicyUrl:'https://eccc-msc.github.io/open-data/usage-policy/readme_en/',sourceUrl:ENDPOINT,sourceBodySha256:receipt.sha256,retrievedAt,apiResponseGeneratedAt,uiTimezone:'America/Halifax',units:{temperature:'°C',wind:'km/h',precipitationProbability:'%',precipitationAmount:'mm'},scope:{kind:'official_regional_forecast_with_named_station_observations',publisherRegion:REGION,cityRecords:EXPECTED.map(x=>({id:x.id,name:x.name})),reviewedUiPoints:REVIEWED_POINTS.map(x=>x.name),pointForecastsGenerated:false,wholeMunicipalityCoverageCertified:false},forecast:{kind:'official_regional_forecast',issuedAt:p.forecastGroup.timestamp.en,hourlyIssuedAt:p.hourlyForecastGroup.timestamp.en,sourceUpdatedAt:p.lastUpdated,sourceUrl:p.url.en,hourlyValidFrom:hourly[0].validAt,hourlyValidThrough:hourly.at(-1).validAt,hourly,periods},observations,warnings:{state:warnings.length?'notice_requires_official_source':'none_listed_in_successful_response',complete:true,sourceRecordIds:EXPECTED.map(x=>x.id),sourceUpdatedAts:features.map(f=>f.properties.lastUpdated),checkedAt:retrievedAt,count:warnings.length,items:warnings,coverage:'Only the two checked ECCC Halifax city pages; not all HRM or all hazards.',nonemptyPolicy:'Warning details are not fixture-verified. Use the official source, without summarizing or altering warning intent.'},accuracy:{calibrated:false,skillClaim:null}};
}
export function acceptedEnvelope(data,receipt) {
  return {version:1,activation:'recorded_snapshot_no_refresh',lastAttempt:{status:'success',attemptedAt:receipt.attemptedAt,completedAt:receipt.retrievedAt},lastKnownGood:data};
}
export function retainOnFailure(previous,attempt) {
  assert.ok(['failed','pending','held','partial'].includes(attempt.status));
  return {version:1,activation:'recorded_snapshot_no_refresh',lastAttempt:attempt,lastKnownGood:previous?.lastKnownGood || null};
}
