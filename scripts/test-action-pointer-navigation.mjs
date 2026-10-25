import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const blocked = ['osm-node-11552234300-sushi-nami-royale', 'osm-node-7465111619-brawta-jamaican-jerk-joint', 'osm-node-4797459277-downtown-pizza'];
const valid = 'osm-node-5161526522-sushi-nami-royale';
const wrongForBayers = 'https://sushinami.ca/downtown-halifax/take-out/';
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/#restaurant/${blocked[0]}`);
    await page.waitForSelector('.restaurant-title h1');
    async function inspect(id, expectedOrder) {
      await page.waitForFunction(id => location.hash === '#restaurant/' + id && document.querySelector('.save-detail')?.dataset.saveId === id, id);
      const details = await page.evaluate(({ id, wrongForBayers }) => {
        const place = restaurants.find(record => record.id === id);
        return {
          id, hasOrdering: place.hasOrdering,
          primary: HalifaxDataIntegrity.primaryActionUrl(id, 'ordering', place.orderingLinks),
          ctas: [...document.querySelectorAll('.mobile-essential-actions a, .detail-official-actions a')].filter(link => /Order online/.test(link.textContent)).map(link => link.href),
          wrongBranchActionAnchors: [...document.querySelectorAll('.mobile-essential-actions a[href], .detail-official-actions a[href]')].filter(link => link.href === wrongForBayers).length,
          inOrderingFilter: filteredRestaurants({ feature: 'ordering', query: '', area: 'all', cuisine: 'all' }).some(record => record.id === id),
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, { id, wrongForBayers });
      assert.equal(details.hasOrdering, expectedOrder);
      assert.equal(details.inOrderingFilter, expectedOrder);
      assert.equal(details.overflow, false, 'No new page overflow');
      if (expectedOrder) {
        assert.equal(details.primary, wrongForBayers);
        assert(details.ctas.includes(wrongForBayers));
      } else {
        assert.equal(details.primary, null);
        assert.deepEqual(details.ctas, [], 'No mobile/sidebar CTA or alternate-primary promotion');
        assert.equal(details.wrongBranchActionAnchors, 0);
      }
      receipts.push({ width, ...details });
    }
    await inspect(blocked[0], false);
    // A valid use of the exact same URL remains available at its own branch.
    await page.evaluate(id => { location.hash = '#restaurant/' + id; }, valid);
    await inspect(valid, true);
    await page.goBack();
    await inspect(blocked[0], false);
    await page.goForward();
    await inspect(valid, true);
    for (const id of blocked.slice(1)) {
      await page.evaluate(id => { location.hash = '#restaurant/' + id; }, id);
      await inspect(id, false);
      await page.reload();
      await page.waitForSelector('.restaurant-title h1');
      await inspect(id, false);
    }
    assert.deepEqual(errors, []);
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/action-pointer-${width}.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/action-pointer-navigation.json', JSON.stringify(receipts, null, 2));
console.log(`Action navigation passed ${receipts.length} checks at mobile/tablet/desktop widths, including Back/Forward and reload; no external action clicked.`);
