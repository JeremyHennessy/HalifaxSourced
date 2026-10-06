import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import vm from 'node:vm';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{playwright=await import(candidate);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const url=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');const now='2026-10-06T02:00:00Z';const evidence=[];
try{
 // This unchanged reviewed snapshot is test evidence; CI source builds may differ.
 const snapshot=JSON.parse(await readFile(new URL('./fixtures/reviewed-offer-snapshot.json',import.meta.url),'utf8'));
 assert.equal(snapshot.records.length,160);assert.equal(snapshot.records.filter(r=>r.status==='stale').length,55);
 const context={window:{}};vm.createContext(context);vm.runInContext(await readFile(new URL('../source-integrity.js',import.meta.url),'utf8'),context);
 assert.equal(snapshot.records.filter(r=>context.HalifaxDataIntegrity.currentOffer(r,Date.parse(now),30)).length,0);
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),resources=await installOfflineResources(context,url);
  const page=await context.newPage();await page.clock.install({time:new Date(now)});
  await page.goto(url+'/#specials',{waitUntil:'networkidle'});await page.locator('[data-specials-filter-form]').waitFor();
  const fixtures=[['valid',{}],['stale',{status:'stale'}],['oldVerification',{verifiedAt:'2026-08-29T00:00:00Z'}],['future',{verifiedAt:'2026-10-07T00:00:00Z'}],['expired',{validTo:'2026-10-05T00:00:00Z'}],['wrongEntity',{identityValidated:false}],['wrongLocation',{locationValidated:false}],['quarantined',{quarantined:true}],['unsafeSource',{sourceUrl:'https://glitterbeancafe.com/contact'}],['urlOnly',{sourceType:'verified_restaurant_owned_page'}]];
  for(const [name,changes] of fixtures){
   await page.evaluate(({name,changes,now})=>{
    const target=restaurants.find(r=>r.id==='side-hustle-snack-bar-dartmouth');
    for(const r of restaurants){r.hasSpecial=r===target;r.structuredSpecials=[];r.currentVerifiedSpecials=[];}
    const offer={id:'test-'+name,restaurantId:target.id,title:'Test offer '+name,status:'verified_current',sourceType:'reviewed_restaurant_owned_source',sourceUrl:'https://example.com/halifax/menu',verifiedAt:now,validFrom:'2026-10-01T00:00:00Z',validTo:'2026-10-10T00:00:00Z',...changes};
    target.structuredSpecials=[offer];target.currentVerifiedSpecials=[offer].filter(currentStructuredSpecial);
    Object.assign(specialsUiState,{query:'',neighbourhood:'all',kind:'all',page:1});renderSpecials();
   },{name,changes,now});
   assert.equal(await page.locator('.special-card.is-verified').count(),name==='valid'?1:0,name);
   assert.equal(await page.locator('.special-card.is-lead').count(),name==='valid'?0:1,name);
   assert.match(await page.locator('.special-card').innerText(),name==='valid'?/Verified offer/:/Source lead/);
   await page.locator('#specialsKind').selectOption('verified');await page.locator('[data-specials-filter-form] .button.primary').click();
   assert.equal(await page.locator('.special-card').count(),name==='valid'?1:0,name+' verified filter');
   if(name!=='valid')assert.match(await page.locator('.specials-results').innerText(),/No specials match/);
   await page.evaluate(()=>renderRestaurantDetail('side-hustle-snack-bar-dartmouth'));
   assert.equal(await page.locator('#detailSpecials .source-link-row',{hasText:'Test offer '+name}).count(),name==='valid'?1:0,name+' detail');
   if(name!=='valid')assert.match(await page.locator('#detailSpecials').innerText(),/Current availability is unverified/);
   evidence.push({viewport,name,currentRendered:name==='valid',passed:true});
  }
  await page.waitForLoadState('networkidle');resources.assertClean();await context.close();
 }
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../artifacts/offer-rendering-fixed-clock.json',import.meta.url),JSON.stringify({fixedTime:now,snapshot:{records:160,current:0,stale:55},evidence},null,2));console.log('Fixed-clock offer rendering passed: positive and nine negative cases at desktop/mobile; reviewed snapshot 0 current, 55 stale.');
}finally{await browser.close();}
