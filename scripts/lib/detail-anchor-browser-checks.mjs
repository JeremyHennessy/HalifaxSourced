import assert from 'node:assert/strict';

export async function verifyDetailAnchorNavigation(page, width) {
  const detailHash = '#restaurant/osm-way-88879193-henry-house';
  // Keep the real detail layout, but do not introduce a new map-tile transport
  // surface into this anchor test. Map lifecycle/tiles have their own gate.
  await page.evaluate(() => { window.__detailAnchorMapInitializer = initDetailMap; initDetailMap = () => {}; });
  const checks = [];
  try {
    await page.evaluate(() => navigate('#explore'));
    await page.waitForFunction(() => location.hash === '#explore' && document.querySelector('.restaurant-card'));
    await page.evaluate(hash => navigate(hash), detailHash);
    await page.waitForFunction(hash => location.hash === hash && document.querySelector('.detail-tabs'), detailHash);
    const originalHistoryLength = await page.evaluate(() => history.length);
    const settle = async id => {
      await page.waitForFunction(id => {
        const target = document.getElementById(id), tabs = document.querySelector('.detail-tabs'), header = document.getElementById('siteHeader');
        const offset = Math.max(header.getBoundingClientRect().bottom, parseFloat(getComputedStyle(tabs).top) || 0) + tabs.getBoundingClientRect().height + 8;
        const destination = Math.min(Math.max(0, scrollY + target.getBoundingClientRect().top - offset), document.documentElement.scrollHeight - innerHeight);
        return Math.abs(scrollY - destination) < 2;
      }, id);
      const result = await page.evaluate(id => {
        const section = document.getElementById(id), heading = section.querySelector('h2') || section;
        const header = document.getElementById('siteHeader').getBoundingClientRect();
        const tabs = document.querySelector('.detail-tabs').getBoundingClientRect();
        const rect = heading.getBoundingClientRect();
        const bar = document.querySelector('.mobile-tabbar');
        const bottomLimit = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
        return { id, viewportWidth: innerWidth, hash: location.hash, historyLength: history.length, focus: document.activeElement.id, headingTop: rect.top, headingBottom: rect.bottom, coveredUntil: Math.max(header.bottom,tabs.bottom), bottomLimit, scrollY };
      }, id);
      assert.equal(result.hash, detailHash);
      assert.equal(result.historyLength, originalHistoryLength, 'Section tabs must not add route history entries');
      assert.equal(result.focus, id);
      assert(result.headingTop >= result.coveredUntil + 2, `Heading hidden by sticky navigation at ${width}px: ${JSON.stringify(result)}`);
      assert(result.headingBottom <= result.bottomLimit, `Heading outside usable viewport at ${width}px`);
      checks.push(result);
      return result;
    };
    const activate = async id => { await page.locator(`.detail-tabs a[href="#${id}"]`).click(); return settle(id); };
    await activate('detailMenu');
    await page.screenshot({ path: `artifacts/review-priorities/detail-menu-${width}.png` });
    await activate('detailSources');
    await activate('detailMenu');
    const repeated = await activate('detailMenu');
    assert(Math.abs(repeated.scrollY - checks.at(-2).scrollY) < 2, 'Repeated same-tab activation must be stable');
    await page.evaluate(() => {
      document.querySelector('.detail-tabs a[href="#detailMenu"]').click();
      document.querySelector('.detail-tabs a[href="#detailSources"]').click();
    });
    await settle('detailSources');
    if (width === 1180) {
      await page.setViewportSize({ width: 500, height: 1000 });
      await activate('detailMenu');
      await page.setViewportSize({ width, height: 1000 });
      await activate('detailSources');
    }
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#explore' && document.querySelector('.restaurant-card'));
    await page.goForward();
    await page.waitForFunction(hash => location.hash === hash && document.querySelector('.detail-tabs'), detailHash);
    await activate('detailSources');
    // A newer route must cancel an in-flight smooth anchor scroll; there is no
    // delayed callback allowed to drag Home back to a stale detail coordinate.
    await page.locator('.detail-tabs a[href="#detailMenu"]').click();
    await page.evaluate(() => navigate('#home'));
    await page.waitForFunction(() => location.hash === '#home' && document.querySelector('.home-hero') && scrollY < 2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => location.hash), '#home');
    assert((await page.evaluate(() => scrollY)) < 2);
    return { width, checks, localHashAndHistoryPreserved: true, backForward: true, interruptedScroll: true };
  } finally {
    await page.evaluate(() => { if (window.__detailAnchorMapInitializer) initDetailMap = window.__detailAnchorMapInitializer; delete window.__detailAnchorMapInitializer; });
  }
}
