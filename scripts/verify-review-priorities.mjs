import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const path of [process.env.PLAYWRIGHT_MODULE,'playwright'].filter(Boolean)){try{playwright=await import(path);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const url=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
const evidence=[];await mkdir('artifacts/review-priorities',{recursive:true});
try{
 for(const width of [1440,1180,900,768,390]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const resources=await installOfflineResources(context,url);const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/#explore',{waitUntil:'networkidle'});
  const savedLinks=page.locator('a[href="#saved"],#savedButton');let reachable=false;for(const link of await savedLinks.all())if(await link.isVisible())reachable=true;assert(reachable,'Saved reachable at '+width);
  await page.goto(url+'/#explore?neighbourhood=Bedford&sort=name');await page.waitForFunction(()=>state.neighbourhood==='Bedford');
  await page.locator('#globalSearch').fill('Bar Kismet');await page.locator('#globalSearch').press('Enter');await page.waitForFunction(()=>location.hash==='#explore?q=Bar+Kismet');
  assert.equal(await page.evaluate(()=>state.neighbourhood),'all');assert.match(await page.locator('#appView').innerText(),/Bar Kismet/);
  const beforeReload=await page.evaluate(()=>({url:location.href,query:state.query,ready:document.readyState}));
  await page.reload({waitUntil:'networkidle'});
  const afterReload=await page.evaluate(()=>({url:location.href,query:state.query,ready:document.readyState,input:globalSearch.value,body:document.querySelector('#appView')?.innerText.slice(0,300)}));
  console.log('Discovery reload diagnostic',JSON.stringify({width,beforeReload,afterReload,errors,unknownResources:resources.evidence.unknown}));
  assert.equal(afterReload.query,'Bar Kismet');
  if(width<=640) await page.locator('[data-open-filters]').click();
  await page.locator('[data-clear-filters]').first().click();await page.waitForFunction(()=>location.hash==='#explore');assert.equal(await page.locator('#globalSearch').inputValue(),'');
  await page.goBack();await page.waitForFunction(()=>state.query==='Bar Kismet');await page.goForward();await page.waitForFunction(()=>state.query==='');
  await page.evaluate(()=>navigateDiscovery({neighbourhood:'Bedford',sort:'name'},'explore',true));await page.waitForFunction(()=>location.hash.includes('neighbourhood=Bedford'));await page.reload({waitUntil:'networkidle'});assert.equal(await page.evaluate(()=>state.neighbourhood),'Bedford');
  await page.locator('.restaurant-card a[href^="#restaurant/"]').first().click();await page.locator('.back-link').waitFor();
  assert.match(await page.locator('.back-link').getAttribute('href'),/neighbourhood=Bedford/);
  await page.locator('.back-link').click();await page.waitForFunction(()=>state.neighbourhood==='Bedford');
  await page.goto(url+'/#specials',{waitUntil:'networkidle'});
  const offers=await page.evaluate(()=>activeRestaurants.flatMap(r=>(r.structuredSpecials||[]).filter(currentStructuredSpecial)).length);
  await page.locator('#specialsKind').selectOption('verified');await page.locator('[data-specials-filter-form] button[type=submit]').click();
  assert.equal(await page.locator('.special-card.is-verified').count(),Math.min(offers,12));
  const titles=await page.locator('.special-card.is-verified h2').allTextContents();assert.equal(new Set(titles).size,titles.length);
  await page.goto(url+'/#events',{waitUntil:'networkidle'});assert.match(await page.title(),/^Events \|/);
  assert.equal(await page.evaluate(()=>eventDisplayTitle({title:'Meet Juno Meet Juno'})),'Meet Juno');
  await page.evaluate(()=>{document.querySelector('.calendar-card').innerHTML=simpleCalendar([])});assert.match(await page.locator('.calendar-card').innerText(),/No event dates match/);
  await page.goto(url+'/#home',{waitUntil:'networkidle'});
  assert.equal(await page.locator('.lead-row a[href="#events"]').count(),0);
  await page.screenshot({path:`artifacts/review-priorities/home-${width}.png`,fullPage:false});
  assert.deepEqual(errors,[]);resources.assertClean();evidence.push({width,savedReachable:true,urlReloadBackForward:true,offerCards:Math.min(offers,12),errors});await context.close();
 }
 await writeFile('artifacts/review-priorities/results.json',JSON.stringify(evidence,null,2));
}finally{await browser.close()}
console.log('Review priority browser regressions passed at five desktop/tablet/mobile widths.');
