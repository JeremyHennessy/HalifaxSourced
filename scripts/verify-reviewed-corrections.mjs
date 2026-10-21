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
    ['osm-way-671922221-mckelvie-s','current-mckelvies'],
    ['hux-halifax','current-hux'],
    ['osm-node-4421124794-cafe-marco-polo','current-marco-polo'],
    ['evans-fresh-seafoods-dartmouth','current-evans-seafood'],
    ['chanoeys-pasta-dartmouth','current-chanoeys-pasta'],
    ['osm-node-472054712-the-wooden-monkey','current-wooden-monkey-dartmouth']
  ]) {
    await page.goto(`${base}/#restaurant/${id}`,{waitUntil:'networkidle'});
    await page.locator('.restaurant-hero').waitFor();
    const model = await page.evaluate(id=>{
      const place=restaurants.find(item=>item.id===id);
      return {active:isRestaurantActive(place),hours:place.openingHours,phone:place.phone,address:place.address,image:Boolean(permittedImageFor(place)),actions:place.menuLinks.length+place.orderingLinks.length+place.reservationLinks.length,overflow:document.documentElement.scrollWidth-innerWidth};
    },id);
    assert(model.overflow<=2,label+' horizontal overflow');
    if (label === 'current-mckelvies') {
      const official=page.locator('.hero-actions a').filter({hasText:'Official site'});
      assert.equal(await official.getAttribute('href'),'https://www.mckelvies.ca/');
      assert.equal(await page.locator('.detail-official-actions a').filter({hasText:'Website'}).getAttribute('href'),'https://www.mckelvies.ca/');
      assert.match(await page.locator('.media-attribution').first().innerText(),/April 2023/);
      assert.equal(await page.locator('.media-license').first().getAttribute('href'),'https://creativecommons.org/licenses/by-sa/4.0/');
    }
    if (label === 'current-wooden-monkey-dartmouth') {
      assert(model.active);
      assert.equal(model.phone, '902-466-3100');
      assert.equal(model.address, '40 Alderney Drive, #305, Level 2 Alderney Ferry Terminal, Dartmouth, NS B2Y 2N5');
      assert.equal(model.hours, 'Mo-Th 11:30-21:00; Fr-Sa 11:30-21:30; Su 11:30-21:00');
      const essentials = page.locator('#detailOverview .mobile-essential-facts');
      assert(await essentials.isVisible());
      const text = await essentials.innerText();
      for (const fact of [model.phone, model.address, model.hours]) assert(text.includes(fact));
      assert.equal(await page.locator('#detailMenu a[href="https://www.thewoodenmonkey.ca/main-menu"]').count(), 1);
      const separate = await page.evaluate(() => {
        const dartmouth = restaurants.find(record => record.id === 'osm-node-472054712-the-wooden-monkey');
        const halifax = restaurants.find(record => record.id === 'osm-way-96322798-wooden-monkey');
        return {differentIds:dartmouth.id!==halifax.id,halifaxPhone:halifax.phone,halifaxAddress:halifax.address,dartmouthImage:permittedImageFor(dartmouth)?.url,halifaxImage:permittedImageFor(halifax)?.url};
      });
      assert(separate.differentIds);
      assert.equal(separate.halifaxPhone, '+1-902-444-3844');
      assert.equal(separate.halifaxAddress, '1707 Grafton Street, Halifax');
      if (separate.dartmouthImage) assert.notEqual(separate.dartmouthImage, separate.halifaxImage, 'Do not share a photographed Halifax-location image with Dartmouth');
    }
    if (label === 'current-chanoeys-pasta') {
      assert(model.active);
      assert.equal(model.address, '41 Portland Street, Dartmouth, NS B2Y 1H1');
      assert.equal(model.phone, '902-405-2211');
      assert.equal(model.image, false, 'Web photos are reference-only');
      assert.equal(await page.locator('#detailMenu a[href="https://www.chanoeyspasta.com/menu"]').count(),1);
      const schedule = await page.evaluate(() => {
        const place = restaurants.find(record=>record.id === 'chanoeys-pasta-dartmouth');
        return {closure:restaurantDisplayedHours(place,new Date('2026-10-20T16:00:00Z')),normal:restaurantDisplayedHours(place,new Date('2026-10-23T16:00:00Z')),today:restaurantDisplayedHours(place)};
      });
      assert.equal(schedule.closure, 'Scheduled closure Oct 9–22, 2026');
      assert.equal(schedule.normal, model.hours);
      assert((await page.locator('#detailOverview .mobile-essential-facts').innerText()).includes(schedule.today), 'Mobile essential hours reflect dated owner exception');
    }
    if (label === 'current-evans-seafood') {
      assert(model.active);
      assert.equal(model.hours, 'Mo-Su 11:00-20:00');
      assert.equal(model.phone, '902-466-2118');
      assert.equal(model.address, '2 Ochterloney Street, Dartmouth, NS B2Y 1B2');
      const essentials = page.locator('#detailOverview .mobile-essential-facts');
      assert(await essentials.isVisible());
      const text = await essentials.innerText();
      for (const fact of [model.hours, model.phone, model.address]) assert(text.includes(fact));
      assert.equal(await page.locator('#detailMenu a[href="https://www.evansfreshseafoods.com/menu/"]').count(), 1);
      assert.equal(model.image, false, 'Owner-site photos are not a reuse grant');
    }
    if (label === 'current-marco-polo') {
      assert(model.active, 'Café Marco Polo must retain its existing active identity');
      assert.equal(model.hours, 'Mo-Fr 07:00-16:00; Sa-Su 08:00-16:00');
      assert.equal(model.phone, '902-406-0901');
      assert.equal(model.address, '15 Kings Wharf Place, Dartmouth, NS B2Y 0B4');
      const essentials = page.locator('#detailOverview .mobile-essential-facts');
      assert(await essentials.isVisible(), 'Assert the actual mobile surface, not the hidden desktop sidebar');
      const essentialsText = await essentials.innerText();
      assert(essentialsText.includes(model.phone));
      assert(essentialsText.includes(model.address));
      assert(essentialsText.includes(model.hours));
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
  await page.goto(base+'/#explore?q=Battery%20Park',{waitUntil:'networkidle'});
  await page.locator('.restaurant-card').first().waitFor();
  assert.equal(await page.locator('.restaurant-card').count(),1,'Duplicate Battery Park card');
  await page.goto(base+'/#restaurant/osm-node-14139904501-battery-park-beer-bar-and-eatery',{waitUntil:'networkidle'});
  await page.locator('.restaurant-hero').waitFor();
  assert(await page.locator('[data-save-id="battery-park"]').count()>0,'Old Battery Park detail route must resolve to canonical saved identity');
  assert.equal(await page.evaluate(()=>restaurants.find(item=>item.id==='battery-park').openingHours),null,'Do not publish ambiguous Thursday hours or imported 24-hour service');
  await page.screenshot({path:new URL('../artifacts/ui-check-iphone-battery-park-merged.png',import.meta.url).pathname,fullPage:true});
  resources.assertClean();
  console.log(`Short-iPhone lifecycle, replacement, current-location, merged-route and ${ids.length}-identity release parity checks passed.`);
  await context.close();
} finally { await browser.close(); }
