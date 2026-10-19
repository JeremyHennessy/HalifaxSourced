import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{playwright=await import(candidate);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const url=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');const manifest=JSON.parse(await readFile(new URL('./fixtures/offline-resource-manifest.json',import.meta.url),'utf8')),tiles=manifest.resources.filter(r=>r.category==='map-tile').map(r=>r.url),evidence=[];
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const status of [200,503]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),gate=await installOfflineResources(context,url,{failedURLs:status===503?tiles:[]});
  const page=await context.newPage();await page.clock.install({time:new Date('2026-10-06T02:00:00Z')});
  await page.goto(url+'/#map',{waitUntil:'networkidle'});await page.locator('.map-result-row').first().waitFor({state:'attached'});await page.waitForFunction(()=>window.__halifaxMapMarkerCount>0);
  if(status===200)await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].some(i=>i.complete&&i.naturalWidth===256&&i.naturalHeight===256));
  else await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].some(i=>i.complete&&i.naturalWidth===0));
  const state=await page.evaluate(()=>({markers:window.__halifaxMapMarkerCount,rows:document.querySelectorAll('.map-result-row').length,decoded:[...document.querySelectorAll('.leaflet-tile')].filter(i=>i.complete&&i.naturalWidth===256&&i.naturalHeight===256).length,overflow:document.documentElement.scrollWidth-innerWidth}));
  assert(state.markers>50);assert(state.rows>0);assert(state.overflow<=2);if(status===200)assert(state.decoded>0);else assert.equal(state.decoded,0);
  const id=await page.evaluate(()=>{const id=[...state.mapMarkers.keys()][0];state.mapMarkers.get(id).fire('click');return id;});assert.equal(await page.locator('.map-result-row.is-highlighted').getAttribute('data-map-result-id'),id);
  if(viewport.width<700){await page.locator('[data-map-mode="list"]').click();assert.equal(await page.locator('[data-map-mode="list"]').getAttribute('aria-pressed'),'true');}
  else{assert.equal(await page.locator('[data-map-mode="list"]').isVisible(),false);assert.equal(await page.locator('.map-results').isVisible(),true);}
  assert(await page.locator('.map-result-row').count()>0);
  assert.equal(await page.locator('.map-result-row.is-highlighted').isVisible(),true);
  await page.waitForLoadState('networkidle');gate.assertClean();
  const tileRequests=gate.evidence.requests.filter(r=>r.category==='map-tile');assert(tileRequests.length>0&&tileRequests.length<=39,'Tile attempts bounded to frozen manifest');assert(tileRequests.every(r=>r.status===status));
  evidence.push({viewport,status,state,tileRequests,console:gate.evidence.console,unknown:gate.evidence.unknown,afterFinalInteraction:'list interaction; strict exact-URL error check passed'});await context.close();
 }
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../artifacts/map-tile-controls.json',import.meta.url),JSON.stringify(evidence,null,2));console.log('Real tile decode and bounded degraded map/list controls passed at desktop/mobile.');
}finally{await browser.close();}
