// Hosted exact-release browser assertions. Uses frozen local resource gate only.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {projectEccc,acceptedEnvelope} from './lib/eccc-weather.mjs';
import {loadPublicModelProjection} from './lib/weather-model-publication.mjs';
import {loadCurrentWeather} from './lib/weather-capture.mjs';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;
for(const candidate of [process.env.PLAYWRIGHT_MODULE,'playwright'].filter(Boolean)){
  try{playwright=await import(candidate);break;}catch{}
}
if(!playwright?.chromium)throw Error('Playwright required for weather browser assertions');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const base=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
const artifacts=new URL('../artifacts/',import.meta.url);
const sizes=[],checks=[];
try{
  await mkdir(artifacts,{recursive:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const resources=await installOfflineResources(context,base);
  const page=await context.newPage();
  const actual=(await loadCurrentWeather()).envelope;
  const actualModels=(await loadPublicModelProjection()).projection;
  await page.clock.install({time:new Date()});
  await page.goto(base+'/#weather',{waitUntil:'networkidle'});
  await page.locator('#weatherForecastHeading').waitFor();
  // First verify the actual packaged release semantically, at viewing time.
  assert.deepEqual(await page.evaluate(()=>window.HalifaxWeather),actual);
  assert.deepEqual(await page.evaluate(()=>window.HalifaxWeatherModels),actualModels);
  await page.locator('#weatherModelsHeading').waitFor();
  const currentView=await page.evaluate(()=>window.HalifaxWeatherContract.evaluate(window.HalifaxWeather));
  assert.equal(await page.locator('#weatherForecastHeading').count(),1);
  if(currentView.warnings.status==='unavailable')assert.match(await page.locator('#weatherWarningHeading').innerText(),/unavailable/);
  checks.push('actual packaged current capture validated separately from immutable edge fixture');
  await page.screenshot({path:new URL('weather-current-desktop.png',artifacts).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('weather-current-mobile.png',artifacts).pathname,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  // Real accepted model snapshot: semantic gates and browser edges, not fixed source values.
  await page.clock.setFixedTime(new Date(Date.parse(actualModels.issuedAt)+1));
  await page.evaluate(()=>renderWeather());
  let modelContent=await page.locator('[aria-labelledby="weatherModelsHeading"]').innerText();
  assert.match(modelContent,/GFS \+ ECMWF IFS/);assert.match(modelContent,/no automatic model refresh/);
  assert.match(modelContent,/No improvement in prediction accuracy has been established/);
  assert.match(modelContent,/Open-Meteo.*held/);assert.match(modelContent,/Deutscher Wetterdienst.*held/);
  await page.locator('[data-weather-model-details="halifax_peninsula"]').evaluate(element=>element.open=true);
  await page.locator('[data-weather-model-details^="halifax_peninsula-"]').first().evaluate(element=>element.open=true);
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    const geometry=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth}));
    assert.ok(geometry.documentWidth<=width,'Expanded model provenance overflow: '+JSON.stringify(geometry));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:new URL('weather-models-current-desktop.png',artifacts).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('weather-models-current-mobile.png',artifacts).pathname,fullPage:true});
  await page.evaluate(()=>{window.__acceptedModelSnapshot=structuredClone(window.HalifaxWeatherModels);window.HalifaxWeatherModels.lastAttempt.status='failed';renderWeather();});
  assert.match(await page.locator('[aria-labelledby="weatherModelsHeading"]').innerText(),/Latest model attempt failed.*not current/);
  assert.equal(await page.evaluate(()=>window.HalifaxWeatherModelContract.evaluate(window.HalifaxWeatherModels).currentHeadlines.length),0);
  await page.clock.setFixedTime(new Date(Math.max(...actualModels.forecasts.map(row=>Date.parse(row.validAt)))+1));
  await page.evaluate(()=>{window.HalifaxWeatherModels=structuredClone(window.__acceptedModelSnapshot);renderWeather();});
  assert.equal(await page.evaluate(()=>window.HalifaxWeatherModelContract.evaluate(window.HalifaxWeatherModels).currentHeadlines.length),0);
  assert.match(await page.locator('[aria-labelledby="weatherModelsHeading"]').innerText(),/historical|unavailable/i);
  await page.screenshot({path:new URL('weather-models-historical-mobile.png',artifacts).pathname,fullPage:true});
  await page.evaluate(()=>{for(const details of document.querySelectorAll('[data-weather-model-details]'))details.open=false;});
  await page.setViewportSize({width:1440,height:1000});
  checks.push('actual GFS/IFS projection, expanded320–1440px model view, held sources, visible attribution, failed retention and target expiry');
  // Fixed regression cases remain deterministic even after the accepted capture advances.
  const fixtureReceipt=JSON.parse(await readFile(new URL('fixtures/weather/eccc-citypage-20261028-receipt.json',import.meta.url),'utf8'));
  const fixture=acceptedEnvelope(projectEccc(await readFile(new URL('fixtures/weather/eccc-citypage-20261028.json',import.meta.url),'utf8'),fixtureReceipt),fixtureReceipt);
  await page.clock.setFixedTime(new Date('2026-10-28T00:50:00Z'));
  await page.evaluate(value=>{window.HalifaxWeather=value;renderWeather();},fixture);
  const fresh=await page.locator('#appView').innerText();
  assert.match(fresh,/No warnings listed at the recorded check/);
  assert.match(fresh,/Halifax Stanfield/);assert.match(fresh,/Shearwater Airport/);
  assert.match(fresh,/Recorded manual snapshot/);assert.match(fresh,/not an all-HRM or all-hazards all-clear/);
  assert.equal(await page.locator('#weatherForecastHeading').count(),1);
  assert.equal(await page.evaluate(()=>window.HalifaxWeather.lastKnownGood.retrievedAt),'2026-10-28T00:43:33.585Z');
  checks.push('exact recorded fixture; one regional forecast and two named station observations');
  for(const width of [1440,1180,1024,901,768,390,320]){
    await page.setViewportSize({width,height:1000});
    const geometry=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.weather-table-scroll').getBoundingClientRect().width,tableScroll:document.querySelector('.weather-table-scroll').scrollWidth}));
    sizes.push(geometry);assert.ok(geometry.documentWidth<=width,JSON.stringify(geometry));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:new URL('weather-desktop.png',artifacts).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('weather-mobile.png',artifacts).pathname,fullPage:true});
  await page.locator('#mobileMore').click();
  await page.locator('[data-mobile-more-sheet].is-open').waitFor();
  await page.locator('[data-mobile-more-sheet] a[href="#weather"]').click();
  assert.equal(await page.locator('#mobileMore').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('[data-mobile-more-sheet]').getAttribute('aria-hidden'),'true');
  await page.locator('#mobileMore').click();await page.locator('[data-mobile-more-close]').click();
  assert.equal(await page.locator('#mobileMore').getAttribute('aria-expanded'),'false');
  checks.push('320–1440px no page overflow; mobile More weather navigation and close');
  await page.evaluate(()=>{state.query='Cafe';state.page=3;state.cuisine='Seafood';state.discoveryReturnHash='#explore?q=Cafe&page=3';location.hash='#news?q=library';});
  await page.locator('.news-intro').waitFor();
  await page.evaluate(()=>location.hash='#weather?q=ignored&page=9');
  await page.locator('#weatherForecastHeading').waitFor();
  await page.goBack();await page.locator('.news-intro').waitFor();
  await page.goForward();await page.locator('#weatherForecastHeading').waitFor();
  const stateCheck=await page.evaluate(()=>({query:state.query,page:state.page,cuisine:state.cuisine,discoveryReturnHash:state.discoveryReturnHash,title:document.title}));
  assert.deepEqual(stateCheck,{query:'Cafe',page:3,cuisine:'Seafood',discoveryReturnHash:'#explore?q=Cafe&page=3',title:'Halifax weather | Halifax Sourced'});
  checks.push('weather/news Back-Forward and restaurant filters preserved');
  const dst=await page.evaluate(()=>[weatherTime('2026-11-01T04:30:00Z'),weatherTime('2026-11-01T05:30:00Z')]);
  assert.match(dst[0],/1:30:00.*ADT/);assert.match(dst[1],/1:30:00.*AST/);
  await page.evaluate(()=>{window.__weatherFixture=structuredClone(window.HalifaxWeather);window.HalifaxWeather.lastAttempt={status:'failed',attemptedAt:'2026-10-28T00:49:00Z',completedAt:'2026-10-28T00:49:10Z'};renderWeather();});
  let content=await page.locator('#appView').innerText();
  assert.match(content,/Warning status unavailable/);assert.doesNotMatch(content,/No warnings listed/);assert.match(content,/This forecast is stale/);assert.match(content,/1\.6°C/);
  await page.screenshot({path:new URL('weather-failed-mobile.png',artifacts).pathname,fullPage:true});
  checks.push('failed attempt retains original observations but invalidates no-warning/fresh badges');
  await page.evaluate(()=>{window.HalifaxWeather=structuredClone(window.__weatherFixture);window.HalifaxWeather.lastKnownGood.warnings.complete=false;renderWeather();});
  assert.match(await page.locator('#weatherWarningHeading').innerText(),/unavailable/);
  await page.evaluate(()=>{window.HalifaxWeather=structuredClone(window.__weatherFixture);window.HalifaxWeather.lastKnownGood.warnings={...window.HalifaxWeather.lastKnownGood.warnings,state:'notice_requires_official_source',count:1,items:[{original:{headline:'Unverified schema body'}}]};renderWeather();});
  content=await page.locator('#appView').innerText();assert.match(content,/Official weather notice listed/);assert.doesNotMatch(content,/No warnings listed|Unverified schema body/);
  await page.evaluate(()=>{window.HalifaxWeather=null;renderWeather();});
  content=await page.locator('#appView').innerText();assert.match(content,/Regional forecast unavailable/);assert.match(content,/Station observations are unavailable/);assert.doesNotMatch(content,/No warnings listed/);
  checks.push('partial/unavailable warning and missing snapshot states; neutral nonempty notice');
  await page.clock.setFixedTime(new Date('2026-10-28T01:13:33.585Z'));
  await page.evaluate(()=>{window.HalifaxWeather=structuredClone(window.__weatherFixture);renderWeather();});
  assert.match(await page.locator('#weatherWarningHeading').innerText(),/unavailable/);
  await page.clock.setFixedTime(new Date('2026-10-29T04:00:00Z'));
  await page.evaluate(()=>renderWeather());
  content=await page.locator('#appView').innerText();assert.match(content,/Historical hourly forecast values/);assert.match(content,/Warning status unavailable/);assert.doesNotMatch(content,/No warnings listed/);
  assert.equal(await page.locator('time[datetime="2026-10-27T19:00:00Z"]').count(),2);
  await page.screenshot({path:new URL('weather-stale-mobile.png',artifacts).pathname,fullPage:true});
  checks.push('exact warning expiry, stale retained issue clocks, repeated DST hour distinguished');
  await page.waitForLoadState('networkidle');resources.assertClean();
  assert.ok(!resources.evidence.requests.some(row=>['api.weather.gc.ca','nomads.ncep.noaa.gov','data.ecmwf.int','api.open-meteo.com','ensemble-api.open-meteo.com'].includes(new URL(row.url).hostname)),'No browser weather API calls');
  await writeFile(new URL('weather-browser-report.json',artifacts),JSON.stringify({passed:true,checks,sizes,dst,stateCheck,resources:resources.evidence},null,2));
  console.log('Weather hosted browser assertions passed: '+checks.join('; '));
  await context.close();
}finally{await browser.close();}
