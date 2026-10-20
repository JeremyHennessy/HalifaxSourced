import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installOfflineResources } from './lib/offline-browser-resources.mjs';
const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/,'');
const catalog = JSON.parse(await readFile(new URL('../data/build/catalog.json',import.meta.url)));
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext({viewport:{width:390,height:667},serviceWorkers:'block'});
  const resources = await installOfflineResources(context,base);
  const page = await context.newPage();
  for (const [id,label] of [
    ['osm-node-11001023964-lockside-canteen','archived-lockside'],
    ['osm-node-11552061304-sushi-shige','archived-shige'],
    ['osm-node-3789835257-the-juice-press','moved-juice-press'],
    ['osm-node-7185511974-clay-west-bar-and-grill','replaced-clay-west'],
    ['sushi-square-scotia-square','current-sushi-square'],
    ['hux-halifax','current-hux'],
    ['osm-node-4421124794-cafe-marco-polo','current-marco-polo']
  ]) {
    await page.goto(`${base}/#restaurant/${id}`,{waitUntil:'networkidle'});
    await page.locator('.restaurant-hero').waitFor();
    const model = await page.evaluate(id=>{
      const place=restaurants.find(item=>item.id===id);
      return {active:isRestaurantActive(place),hours:place.openingHours,image:Boolean(permittedImageFor(place)),actions:place.menuLinks.length+place.orderingLinks.length+place.reservationLinks.length,overflow:document.documentElement.scrollWidth-innerWidth};
    },id);
    assert(model.overflow<=2,label+' horizontal overflow');
    if (label === 'current-marco-polo') {
      assert(model.active, 'Café Marco Polo must retain its existing active identity');
      assert.equal(model.hours, 'Mo-Fr 07:00-16:00; Sa-Su 08:00-16:00');
      assert((await page.locator('#detailInfo').innerText()).includes('902-406-0901'));
      assert((await page.locator('#detailInfo').innerText()).includes('15 Kings Wharf Place'));
      assert.equal(await page.locator('#detailMenu a[href="https://cafemarcopolodartmouth.com/11-2/"]').count(), 1);
      assert.equal(model.image, false, 'A menu-page image is not a reuse grant');
    }
    if (!model.active) {
      assert.equal(await page.locator('.closure-notice').count(),1);
      assert.equal(await page.locator('.mobile-essential-actions').count(),0);
      assert.equal(model.image,false);
      assert.equal(model.actions,0);
      assert.equal(model.hours,null);
      const essentials = await page.locator(".mobile-essential-facts").textContent();
      assert(essentials.includes("Operating status"));
      assert(essentials.includes("Historical location"));
      assert(!essentials.includes("Check official source"));
      if (["moved-juice-press","replaced-clay-west"].includes(label)) assert.equal(await page.locator(".successor-link").count(),1);
    }
    await page.screenshot({path:new URL(`../artifacts/ui-check-iphone-${label}.png`,import.meta.url).pathname,fullPage:true});
  }
  const ids = await page.evaluate(()=>restaurants.map(item=>item.id).sort());
  assert.deepEqual(ids,catalog.restaurants.map(item=>item.id).sort());
  await page.goto(base+'/#explore?q=Caf%C3%A9%20Lunette',{waitUntil:'networkidle'});
  await page.locator('.restaurant-card').first().waitFor();
  assert.equal(await page.locator('.restaurant-card').count(),1,'Duplicate Café Lunette card');
  await page.screenshot({path:new URL('../artifacts/ui-check-iphone-cafe-lunette-merged.png',import.meta.url).pathname,fullPage:true});
  await page.goto(base+'/#restaurant/osm-node-12984675528-cafe-lunette',{waitUntil:'networkidle'});
  await page.locator('.restaurant-hero').waitFor();
  assert(await page.locator('[data-save-id="osm-node-11751643550-cafe-lunette"]').count()>0,'Old detail route must resolve to canonical identity');
  resources.assertClean();
  console.log(`Short-iPhone lifecycle, replacement, current-location, merged-route and ${ids.length}-identity release parity checks passed.`);
  await context.close();
} finally { await browser.close(); }
