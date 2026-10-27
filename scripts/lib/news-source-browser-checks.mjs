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
