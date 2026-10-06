import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{playwright=await import(candidate);break;}catch{}}
const browser=await playwright.chromium.launch({headless:true,executablePath:['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium'].find(existsSync)});
const url=process.env.APP_URL||'http://127.0.0.1:5173',evidence=[];
try{for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 const context=await browser.newContext({viewport,serviceWorkers:'block'}),gate=await installOfflineResources(context,url),page=await context.newPage(),requests=[];
 page.on('request',r=>{if(r.url().includes('unlicensed-media.example'))requests.push(r.url());});
 await page.goto(url+'/#explore',{waitUntil:'networkidle'});await page.locator('.restaurant-card').first().waitFor();
 const result=await page.evaluate(()=>{
  const target=restaurants.find(r=>r.id==='side-hustle-snack-bar-dartmouth');target.coordinates=null;
  const approved={title:'Rights control',summary:'Retained factual summary',postUrl:'https://example.test/source',sourceUrl:'https://example.test/source',mediaUrl:'https://unlicensed-media.example/reference.jpg',thumbnailUrl:'https://unlicensed-media.example/thumb.jpg',publishedAt:'2026-10-01T00:00:00Z',sourceType:'licensed',permission:'licensed',permissionConfirmed:true,reviewState:'approved',creator:'Fixture author',license:'Specific fixture grant',rightsBasis:'Owner grants reuse'};
  const states=['public_reference_not_media_licence','unverified','unknown','restricted'];const checks=[];
  for(const rightsState of states){const post={...approved,rightsState};target.officialUpdates=[post];renderRestaurantDetail(target.id);
   const detail=document.querySelector('#detailUpdates');const home=recentPostCard(post);const restaurant={...target,image:{...post,url:post.mediaUrl},images:[]};
   checks.push({rightsState,detailImages:detail.querySelectorAll('img').length,detailText:detail.innerText,detailHref:detail.querySelector('a').href,home,restaurantMarkup:mediaImageMarkup(restaurant),restaurantClass:permittedImageClass(restaurant)});
   document.body.insertAdjacentHTML('beforeend',home+mediaImageMarkup(restaurant));
  }
  const unknown={...approved};delete unknown.permissionConfirmed;checks.push({rightsState:'missing_permission',media:permittedPostMediaUrl(unknown)});
  return {checks,approvedAssets:window.HALIFAX_RESTAURANT_MEDIA.records.filter(hasMediaPermission).length,assetChecks:window.HALIFAX_RESTAURANT_MEDIA.records.filter(r=>r.reviewState==="approved").map(r=>({id:r.restaurantId,permitted:hasMediaPermission(r),source:safeUrl(r.sourceUrl),license:r.license,rightsBasis:r.rightsBasis})),positive:hasMediaPermission({...approved,rightsState:'owner_authorized'}),legacyRejected:hasMediaPermission({...approved,license:'First-party official site media'})};
 });
 for(const c of result.checks){if(c.rightsState==='missing_permission'){assert.equal(c.media,null);continue;}assert.equal(c.detailImages,0);assert.match(c.detailText,/Retained factual summary/);assert.equal(c.detailHref,'https://example.test/source');assert(!c.home.includes('<img'));assert.equal(c.restaurantMarkup,'');assert.equal(c.restaurantClass,'');}
 assert.equal(result.approvedAssets,6);assert.equal(result.positive,true);assert.equal(result.legacyRejected,false);await page.waitForLoadState('networkidle');assert.deepEqual(requests,[]);gate.assertClean();evidence.push({viewport,result,unlicensedRequests:requests});await context.close();
}await mkdir('artifacts',{recursive:true});await writeFile('artifacts/media-rights-controls.json',JSON.stringify(evidence,null,2));console.log('Media rights controls passed: denied/unknown images never requested; facts and source links retained; six consumer-eligible licensed assets preserved (Smittys excluded by existing local-restaurant policy).');}finally{await browser.close();}

