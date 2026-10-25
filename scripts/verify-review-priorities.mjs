import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
import {verifyDetailAnchorNavigation} from './lib/detail-anchor-browser-checks.mjs';
let playwright;for(const path of [process.env.PLAYWRIGHT_MODULE,'playwright'].filter(Boolean)){try{playwright=await import(path);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const url=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
const evidence=[];await mkdir('artifacts/review-priorities',{recursive:true});
try{
 for(const width of [1440,1180,900,768,500,390]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const resources=await installOfflineResources(context,url);const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/#explore',{waitUntil:'load'});
  const savedLinks=page.locator('a[href="#saved"],#savedButton');let reachable=false;for(const link of await savedLinks.all())if(await link.isVisible())reachable=true;assert(reachable,'Saved reachable at '+width);
  await page.goto(url+'/#explore?neighbourhood=Bedford&sort=name');await page.waitForFunction(()=>state.neighbourhood==='Bedford');
  await page.locator('#globalSearch').fill('Bar Kismet');await page.locator('#globalSearch').press('Enter');// Hash assignment is synchronous; the hashchange renderer runs afterward.
  await page.waitForFunction(()=>location.hash==='#explore?q=Bar+Kismet' && state.query==='Bar Kismet' && state.neighbourhood==='all');
  assert.equal(await page.evaluate(()=>state.neighbourhood),'all');assert.match(await page.locator('#appView').innerText(),/Bar Kismet/);
  const beforeReload=await page.evaluate(()=>({url:location.href,query:state.query,ready:document.readyState}));
  await page.reload({waitUntil:'load'});
  const afterReload=await page.evaluate(()=>({url:location.href,query:state.query,ready:document.readyState,input:globalSearch.value,body:document.querySelector('#appView')?.innerText.slice(0,300)}));
  console.log('Discovery reload after full application load',JSON.stringify({width,beforeReload,afterReload,errors,unknownResources:resources.evidence.unknown}));
  assert.equal(afterReload.query,'Bar Kismet');
  if(width<=640) await page.locator('[data-open-filters]').click();
  await page.locator('[data-clear-filters]').first().click();await page.waitForFunction(()=>location.hash==='#explore');assert.equal(await page.locator('#globalSearch').inputValue(),'');
  await page.goBack();await page.waitForFunction(()=>state.query==='Bar Kismet');await page.goForward();await page.waitForFunction(()=>state.query==='');
  await page.evaluate(()=>navigateDiscovery({neighbourhood:'Bedford',sort:'name'},'explore',true));await page.waitForFunction(()=>location.hash.includes('neighbourhood=Bedford'));await page.reload({waitUntil:'load'});assert.equal(await page.evaluate(()=>state.neighbourhood),'Bedford');
  await page.locator('.restaurant-card a[href^="#restaurant/"]').first().click();await page.locator('.back-link').waitFor();
  assert.match(await page.locator('.back-link').getAttribute('href'),/neighbourhood=Bedford/);
  await page.locator('.back-link').click();await page.waitForFunction(()=>state.neighbourhood==='Bedford');
  await page.goto(url+'/#specials',{waitUntil:'load'});
  const offers=await page.evaluate(()=>activeRestaurants.flatMap(r=>(r.structuredSpecials||[]).filter(currentStructuredSpecial)).length);
  await page.locator('#specialsKind').selectOption('verified');await page.locator('[data-specials-filter-form] button[type=submit]').click();
  assert.equal(await page.locator('.special-card.is-verified').count(),Math.min(offers,12));
  const titles=await page.locator('.special-card.is-verified h2').allTextContents();assert.equal(new Set(titles).size,titles.length);
  await page.goto(url+'/#events',{waitUntil:'load'});assert.match(await page.title(),/^Events \|/);
  assert.equal(await page.evaluate(()=>eventDisplayTitle({title:'Meet Juno Meet Juno'})),'Meet Juno');
  const eventTitleRendering=await page.evaluate(()=>{
   // Keep the rendering regression after this accepted occurrence expires from the feed.
   const clean='An Afternoon of Creature Connections with the Evergreen Writers Group';
   // Dates are test-only current-window values, never written into accepted data.
   const start=Date.now()+60*60*1000;
   const event={id:'halifax-public-libraries-8a7fdff7c67b162a',title:`${clean} Featured Event. ${clean}`,startAt:new Date(start).toISOString(),endAt:new Date(start+90*60*1000).toISOString(),venueName:'Central Library',eventUrl:'https://halifax.bibliocommons.com/v2/events/6abe6719e06996003a8073b8',observedAt:'2026-10-24T11:11:15.996Z'};
   const before=JSON.stringify(event),originalHomeEvents=homeUpcomingCityEvents;
   let homeTitle;
   try { homeUpcomingCityEvents=()=>[event]; renderHome(); homeTitle=document.querySelector('.home-discovery-panel .lead-row strong').textContent; }
   finally { homeUpcomingCityEvents=originalHomeEvents; }
   renderCityEvents([event]);
   return {id:event.id,homeTitle,featuredTitle:document.querySelector('.featured-event h2').textContent,cardTitle:document.querySelector('.event-title-line h3').textContent,rawUnchanged:before===JSON.stringify(event)};
  });
  for(const key of ['homeTitle','featuredTitle','cardTitle']) assert.equal(eventTitleRendering[key],'An Afternoon of Creature Connections with the Evergreen Writers Group');
  assert(eventTitleRendering.rawUnchanged,'Rendering must preserve accepted title, ID and source clocks');
  await page.evaluate(()=>{document.querySelector('.calendar-card').innerHTML=simpleCalendar([])});assert.match(await page.locator('.calendar-card').innerText(),/No event dates match/);
  const detailAnchors=await verifyDetailAnchorNavigation(page,width);
  await page.goto(url+'/#home',{waitUntil:'load'});
  assert.equal(await page.locator('.lead-row a[href="#events"]').count(),0);
  await page.screenshot({path:`artifacts/review-priorities/home-${width}.png`,fullPage:false});
  assert.deepEqual(errors,[]);resources.assertClean();evidence.push({width,savedReachable:true,urlReloadBackForward:true,offerCards:Math.min(offers,12),eventTitleRendering,detailAnchors,errors});await context.close();
 }
 await writeFile('artifacts/review-priorities/results.json',JSON.stringify(evidence,null,2));
}finally{await browser.close()}
console.log('Review priority browser regressions passed at six desktop/tablet/mobile widths.');
