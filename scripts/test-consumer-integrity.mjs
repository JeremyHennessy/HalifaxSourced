import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import('file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const evidence=[];
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:5173/#explore',{waitUntil:'networkidle'});
    const baseline=await page.evaluate(async()=>{
      const catalog=await (await fetch('./data/build/catalog.json')).json();
      const catalogIds=new Set(catalog.restaurants.map(r=>r.id)),uiIds=new Set(restaurants.map(r=>r.id));
      return {catalogExport:catalog.restaurants.length,loaded:restaurants.length,active:activeRestaurants.length,discovery:window.__halifaxDiscoveredRestaurantCount,currentOffers:restaurants.reduce((n,r)=>n+(r.currentVerifiedSpecials||[]).length,0),uiOnly:restaurants.filter(r=>!catalogIds.has(r.id)).map(r=>({id:r.id,name:r.name,layer:r.sourceLayer})),catalogOnly:catalog.restaurants.filter(r=>!uiIds.has(r.id)).map(r=>({id:r.id,name:r.name}))};
    });
    assert.equal(baseline.currentOffers,0);
    assert.equal(await page.evaluate(()=>safeUrl('https://www.glitterbeancafe.com/contact')),null);
    assert.equal(await page.evaluate(()=>recentOfficialPosts.filter(p=>p.isRecent && !p.publishedAt).length),0);
    const id=await page.evaluate(()=>restaurants.find(r=>r.name==='Sea Smoke').id);
    await page.evaluate(id=>location.hash='#restaurant/'+encodeURIComponent(id),id);
    await page.locator('.detail-tabs').waitFor();
    const hash=await page.evaluate(()=>location.hash);
    for(const link of await page.locator('.detail-tabs a').all()) {
      const target=(await link.getAttribute('href')).slice(1);await link.click();
      assert.equal(await page.evaluate(()=>location.hash),hash);
      assert.equal(await page.evaluate(()=>document.activeElement.id),target === 'detailOverview' && viewport.width > 800 ? 'detailInfo' : target);
    }
    await page.locator('.skip-link').focus();
    await page.locator('.skip-link').press('Enter');
    assert.equal(await page.evaluate(()=>location.hash),hash);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'mainContent');
    await page.goBack();assert.equal(await page.evaluate(()=>location.hash),'#explore');
    await page.goForward();assert.equal(await page.evaluate(()=>location.hash),hash);
    await page.evaluate(()=>location.hash='#home');await page.locator('.home-hero').waitFor();
    assert.equal(await page.getByText('Current verified offers',{exact:true}).count(),0);
    const button=page.locator('[data-save-id]').first();const saveId=await button.getAttribute('data-save-id');
    const before=await page.evaluate(id=>state.saved.has(id),saveId);await button.click();
    assert.equal(await page.evaluate(id=>state.saved.has(id),saveId),!before);
    assert.deepEqual(errors,[]);evidence.push({viewport,...baseline,detailSections:'passed',skipFocus:'passed',history:'passed',singleSaveToggle:'passed',errors});
    await page.close();
  }
  await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
  await writeFile(new URL('../artifacts/consumer-integrity-test.json',import.meta.url),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
} finally {await browser.close();}
