import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{playwright=await import(candidate);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const url=(process.env.APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');const fixtureUrl='https://example.test/feed-image.jpg';const evidence=[];
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}])for(const status of [200,503]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),resources=await installOfflineResources(context,url,{failedURLs:status===503?[fixtureUrl]:[]});
  const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(url+'/#explore',{waitUntil:'networkidle'});await page.locator('.restaurant-card').first().waitFor();
  const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.evaluate((fixtureUrl)=>{const target=restaurants.find(r=>r.id==='side-hustle-snack-bar-dartmouth');target.coordinates=null;target.officialUpdates=[{title:'Controlled update',summary:'Retained source-backed text',postUrl:'https://example.test/source',mediaUrl:fixtureUrl,publishedAt:'2026-10-01T00:00:00Z',platform:'website_feed',rightsState:'permission_verified',sourceType:'licensed',permission:'licensed',permissionConfirmed:true,reviewState:'approved',restaurantId:'side-hustle-snack-bar-dartmouth',alt:'Controlled licensed fixture illustration',attribution:'Test fixture author',creator:'Test fixture author',license:'Test fixture licence',rightsBasis:'Explicit deterministic test grant',sourceUrl:'https://example.test/source'}];renderRestaurantDetail(target.id);},fixtureUrl);
  const card=page.locator('#detailUpdates .official-update-card');await card.scrollIntoViewIfNeeded();
  if(status===200)await page.waitForFunction(()=>{const i=document.querySelector('#detailUpdates img');return i?.complete&&i.naturalWidth>0;});
  else await page.waitForFunction(()=>!document.querySelector('#detailUpdates img'));
  const state=await card.evaluate(el=>({hasMedia:el.classList.contains('has-media'),paddingTop:getComputedStyle(el).paddingTop,href:el.href,text:el.innerText,images:el.querySelectorAll('img').length,overflow:document.documentElement.scrollWidth-innerWidth}));
  const requests=resources.evidence.requests.filter(r=>r.url===fixtureUrl).map(r=>({url:r.url,status:r.status}));evidence.push({viewport,status,requests,state});console.log(JSON.stringify(evidence.at(-1)));
  assert.deepEqual(requests,[{url:fixtureUrl,status}]);assert.equal(state.href,'https://example.test/source');assert.match(state.text,/Retained source-backed text/);assert(state.overflow<=2);assert.deepEqual(pageErrors,[]);
  if(status===200)assert.deepEqual(consoleErrors,[]);else{assert.equal(consoleErrors.length,1);assert.match(consoleErrors[0],/503/);}
  if(status===200){assert.equal(state.images,1);assert.equal(state.hasMedia,true);assert.equal(state.paddingTop,'0px');}
  else{assert.equal(state.images,0);assert.equal(state.hasMedia,false,'Failed image must restore non-media card layout');assert.equal(state.paddingTop,'17px');}
  await page.locator('.detail-tabs a[href="#detailMenu"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'detailMenu');
  await page.waitForLoadState('networkidle');resources.assertClean();
  await context.close();
 }
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../artifacts/feed-image-controls.json',import.meta.url),JSON.stringify(evidence,null,2));console.log('Exact-URL image success/failure controls passed at desktop/mobile.');
}finally{await browser.close();}
