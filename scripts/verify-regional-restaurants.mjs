import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
const playwright = process.env.PLAYWRIGHT_MODULE ? await import(process.env.PLAYWRIGHT_MODULE) : await import('playwright');
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const browser = await playwright.chromium.launch({ headless: true, executablePath });
const url = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const review = JSON.parse(await readFile(new URL('../data/reviewed-regional-restaurants.json', import.meta.url), 'utf8'));
await mkdir('artifacts', { recursive: true });
try {
 for (const viewport of [{width:390,height:844},{width:1440,height:1000}]) {
  const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(`${page.url()} ${viewport.width}: ${error.stack || error.message}`));
  await page.goto(url+'/#explore',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof restaurants!=='undefined'&&restaurants.some(item=>item.id==='watermark-indian-harbour'));
  const state=await page.evaluate(()=>({
   ant:restaurants.filter(item=>item.name==="Antoinette's Cheesecakes").map(item=>item.address),
   apt:restaurants.filter(item=>item.name==='Apartment 3 Espresso Bar').map(item=>item.address),
   areas:[...document.querySelectorAll('#neighbourhoodFilter option')].map(item=>item.value),
   overflow:document.documentElement.scrollWidth>innerWidth+1
  }));
  assert.equal(state.ant.length,3);assert.equal(new Set(state.ant).size,3);assert.equal(state.apt.length,2);assert.equal(new Set(state.apt).size,2);assert.equal(state.overflow,false);
  for(const community of new Set(review.accepted.filter(row=>row.publishedFields.operatingStatus==='active').map(row=>row.community))) assert(state.areas.includes(community),'Missing area '+community);
  if(viewport.width<700) await page.locator('[data-open-filters]').click();
  await page.locator('#neighbourhoodFilter').selectOption('Indian Harbour');
  await page.locator('[data-filter-apply]').click();
  await page.locator('.restaurant-card').filter({hasText:'Watermark Restaurant'}).waitFor();
  await page.screenshot({path:`artifacts/regional-explore-${viewport.width}.png`,fullPage:true});
  await page.goto(url+'/#map',{waitUntil:'domcontentloaded'});
  await page.locator('#mapNeighbourhood').selectOption('Hatchet Lake');
  if(viewport.width<700) await page.locator('[data-map-mode="list"]').click();
  await page.locator('.map-result-row').filter({hasText:"G's Pizza"}).waitFor();
  assert.match(await page.locator('.map-page').innerText(),/no verified map coordinates/);
  assert.match(await page.locator('.map-results').innerText(),/Martin's Kitchen/);
  await page.screenshot({path:`artifacts/regional-map-${viewport.width}.png`,fullPage:true});
  // A known coordinate-bearing community must be brought into view, not left at the core default.
  if(viewport.width<700) await page.locator('[data-map-mode="map"]').click();
  await page.locator('#mapNeighbourhood').selectOption('Downtown Dartmouth');
  await page.waitForFunction(()=>state.neighbourhood==='Downtown Dartmouth'&&state.mapMarkers?.size>0);
  assert(await page.evaluate(()=>[...state.mapMarkers.values()].every(marker=>state.map.getBounds().contains(marker.getLatLng()))));
  // Rapid filter changes must not let an old queued initialization win.
  await page.evaluate(()=>{
   state.neighbourhood='North End';destroyMap();renderMapPage();
   state.neighbourhood='Downtown Dartmouth';destroyMap();renderMapPage();
  });
  await page.waitForFunction(()=>state.mapMarkers?.size>0);
  assert(await page.evaluate(()=>[...state.mapMarkers.keys()].every(id=>restaurants.find(r=>r.id===id)?.neighborhood==='Downtown Dartmouth')));
  // Tear down after initialization but before the next Canvas draw frame.
  await page.evaluate(async()=>{
   for(let i=0;i<3;i++){
    destroyMap();renderMapPage();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    destroyMap();
   }
   renderMapPage();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  await page.goto(url+'/#restaurant/tuna-blue-hubbards',{waitUntil:'domcontentloaded'});
  await page.locator('.closure-notice').waitFor();
  assert.match(await page.locator('.closure-notice').innerText(),/Closed for the season/);
  assert.equal(await page.locator('.hero-actions').getByText('View menu').count(),0);
  await page.screenshot({path:`artifacts/regional-seasonal-${viewport.width}.png`,fullPage:true});
  await page.goto(url+'/#restaurant/osm-node-37132554-press-gang',{waitUntil:'domcontentloaded'});
  await page.locator('.restaurant-title h1').waitFor();
  assert.match(await page.locator('.restaurant-title h1').innerText(),/Press Gang/);
  await page.goto(url+'/#home',{waitUntil:'domcontentloaded'});
  await page.locator('[data-home-openings]').waitFor();
  const openings=await page.evaluate(()=>({
   actual:[...document.querySelectorAll('[data-home-openings] .lead-row>a')].map(a=>decodeURIComponent(a.hash.replace('#restaurant/',''))),
   expected:homeOpeningLeads().map(r=>r.id)
  }));
  assert(openings.actual.length>0,'Existing explicit opening leads remain visible');
  assert.deepEqual(openings.actual,openings.expected);
  for(const row of review.accepted) assert(!openings.actual.includes(row.id),'Established addition incorrectly labeled NEW: '+row.id);
  await page.screenshot({path:`artifacts/regional-home-openings-${viewport.width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Regional browser acceptance passed: desktop/mobile area filters, separate outlets, un-geocoded lists, regional map bounds, seasonal detail and legacy alias routes.');
} finally { await browser.close(); }
