import assert from 'node:assert/strict';
export async function verifyNewsAndSources(page, base) {
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/#news');
    await page.getByRole('heading',{name:'Local news & notices',exact:true}).waitFor();
    const approved=await page.evaluate(()=>window.HALIFAX_NEWS.items.length);
    assert.equal(await page.locator('.news-card').count(),Math.min(12,approved));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth<=2),'News must not overflow');
    await page.locator('[name="newsType"]').selectOption('newsroom');
    await page.locator('[data-news-filters] button[type="submit"]').click();
    assert.ok(page.url().includes('type=newsroom'));
    await page.getByRole('link',{name:'Clear filters',exact:true}).click();
    await page.goto(base+'/#admin/status');
    await page.locator('[data-source-catalog]').waitFor();
    await page.locator('[data-catalog-family]').selectOption('news');
    await page.locator('[data-catalog-query]').fill('CBC');
    await page.locator('[data-catalog-results] .source-catalog-row').first().waitFor();
    assert.equal(await page.locator('[data-catalog-results] .source-catalog-row').count(),1);
    assert.ok((await page.locator('[data-catalog-results]').innerText()).includes('CBC'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth<=2),'Source catalogue must not overflow');
  }
  await page.goto(base+'/#news');
  const original=await page.evaluate(()=>window.HALIFAX_NEWS);
  try {
    await page.evaluate(()=>{
      const seed=window.HALIFAX_NEWS.items[0];
      window.HALIFAX_NEWS={version:1,items:Array.from({length:15},(_,i)=>({...seed,id:'fixture-'+i,title:'Fixture item '+i,source_type:i%2?'newsroom':'official_public_notice'}))};
      renderRoute();
    });
    assert.equal(await page.locator('.news-card').count(),12);
    await page.getByRole('link',{name:'Next',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.news-card').length===3);
    assert.equal(await page.locator('.news-card').count(),3);
    await page.goBack();
    await page.waitForFunction(()=>document.querySelectorAll('.news-card').length===12);
    assert.equal(await page.locator('.news-card').count(),12);
    await page.goForward();
    await page.waitForFunction(()=>document.querySelectorAll('.news-card').length===3);
    assert.equal(await page.locator('.news-card').count(),3);
  } finally { await page.evaluate(value=>{window.HALIFAX_NEWS=value;location.hash='#news';renderRoute();},original); }
}

export async function verifyHomeDiscovery(page, base) {
  const destinations = ['#events?when=today', '#events?when=weekend', '#events?category=Music', '#events?category=Markets', '#events?category=Festivals', '#explore', '#specials', '#news'];
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(base + '/#home');
    await page.locator('.home-browse-links').waitFor();
    assert.deepEqual(await page.locator('.home-browse-links a').evaluateAll(links => links.map(link => link.getAttribute('href'))), destinations);
    const expected = await page.evaluate(() => acceptedNewsItems().slice(0, 3).map(item => item.canonicalUrl));
    assert.deepEqual(await page.locator('.home-news .news-card h3 a').evaluateAll(links => links.map(link => link.href)), expected);
    assert.equal(await page.locator('.home-news').count(), 1);
    assert.equal(await page.locator('[data-home-openings]').count(), 1);
    assert.ok(await page.evaluate(() => {
      const eventPanel = document.querySelector('.home-discovery-panel');
      const featured = document.querySelector('.restaurant-carousel');
      return Boolean(eventPanel.compareDocumentPosition(featured) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'Upcoming events precede featured restaurants');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), 'Home gateway/news must not overflow');
    assert.ok(await page.locator('.home-browse-links a').evaluateAll(links => links.every(link => {
      const box = link.getBoundingClientRect();
      return box.width > 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth + 1 && link.scrollWidth <= link.clientWidth + 1;
    })), 'All eight gateway links remain readable, without clipped content');
  }

  // Use the existing route state; Back/Forward and repeated clicks must not leave filters behind.
  for (const hash of destinations.slice(0, 5)) {
    await page.locator('.home-browse-links a[href="' + hash + '"]').click();
    await page.waitForFunction(hash => location.hash === hash && document.querySelector('[data-event-result-count]'), hash);
    const expected = new URLSearchParams(hash.split('?')[1]);
    const filters = await page.evaluate(() => window.__halifaxEventFilterState);
    assert.equal(filters.windowDays, expected.get('when') || 'all');
    assert.equal(filters.category, expected.get('category') || 'All');
    await page.goBack();
    await page.locator('.home-browse-links').waitFor();
    await page.goForward();
    await page.waitForFunction(hash => location.hash === hash && document.querySelector('[data-event-result-count]'), hash);
    await page.goBack();
    await page.locator('.home-browse-links').waitFor();
    assert.equal(await page.locator('.home-news').count(), 1);
  }
  await page.locator('.home-browse-links a[href="#news"]').click();
  await page.getByRole('heading', {name: 'Local news & notices', exact: true}).waitFor();
  await page.goBack();
  await page.locator('.home-news').waitFor();
  await page.goForward();
  await page.getByRole('heading', {name: 'Local news & notices', exact: true}).waitFor();
  await page.goBack();
  await page.locator('.home-news').waitFor();

  const original = await page.evaluate(() => window.HALIFAX_NEWS);
  try {
    await page.evaluate(() => {window.HALIFAX_NEWS = undefined; renderHome(); renderHome();});
    assert.equal(await page.locator('.home-news').count(), 1);
    assert.equal(await page.locator('.home-news .news-card').count(), 0);
    assert.ok((await page.locator('.home-news').innerText()).includes('News data is unavailable'));
    await page.evaluate(() => {window.HALIFAX_NEWS = {version: 1, items: []}; renderHome();});
    assert.ok((await page.locator('.home-news').innerText()).includes('No reviewed news items are available yet'));
  } finally {
    await page.evaluate(value => {window.HALIFAX_NEWS = value; renderHome();}, original);
  }
}
