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
          wrongBranchAnchors: [...document.querySelectorAll('a[href]')].filter(link => link.href === wrongForBayers).length,
          rejectedPublicEvidence: [...document.querySelectorAll('a[href^="http"]')].filter(link => !HalifaxDataIntegrity.pointerSafe(id, 'source', link.href)).map(link => ({href:link.href,label:link.textContent.trim()})),
          inOrderingFilter: filteredRestaurants({ feature: 'ordering', query: '', area: 'all', cuisine: 'all' }).some(record => record.id === id),
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, { id, wrongForBayers });
      assert.equal(details.hasOrdering, expectedOrder);
      assert.equal(details.inOrderingFilter, expectedOrder);
      assert.equal(details.overflow, false, 'No new page overflow');
      assert.deepEqual(details.rejectedPublicEvidence, [], 'No existing cross-branch rejection leaks through source/update navigation');
      if (expectedOrder) {
        assert.equal(details.primary, wrongForBayers);
        assert(details.ctas.includes(wrongForBayers));
      } else {
        assert.equal(details.primary, null);
        assert.deepEqual(details.ctas, [], 'No mobile/sidebar CTA or alternate-primary promotion');
        assert.equal(details.wrongBranchActionAnchors, 0);
        assert.equal(details.wrongBranchAnchors, 0);
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
    const deerfield = 'deerfield-pub-at-glen-arbour-hammonds-plains';
    const deerfieldUrl = 'https://www.deerfieldpub.ca/contact/';
    await page.evaluate(id => { location.hash = '#restaurant/' + id; }, deerfield);
    await page.waitForFunction(id => document.querySelector('.save-detail')?.dataset.saveId === id, deerfield);
    const inquiryActions = await page.evaluate(url => {
      const textFor = selector => [...document.querySelectorAll(`${selector} a[href]`)]
        .find(link => link.href === url)?.textContent.trim() || null;
      const labels = [textFor('.mobile-essential-actions'), textFor('.detail-official-actions')].filter(Boolean);
      return { labels, liveBookingLabel: labels.some(label => /book table|book now|instant booking|live booking|^reservations/i.test(label)) };
    }, deerfieldUrl);
    assert.deepEqual(inquiryActions.labels, ['Reservation inquiry ↗', 'Reservation inquiry ↗']);
    assert.equal(inquiryActions.liveBookingLabel, false, 'The inquiry form must not be presented as a live booking action');
    const unsafeLabelActions = await page.evaluate(id => {
      const place = restaurants.find(record => record.id === id);
      const link = place.reservationLinks.find(item => item.url === 'https://www.deerfieldpub.ca/contact/');
      link.label = '<img src=x onerror=alert(1)>';
      renderRestaurantDetail(id);
      return {
        actionImages: document.querySelectorAll('.mobile-essential-actions img, .detail-official-actions img').length,
        mobile: [...document.querySelectorAll('.mobile-essential-actions a[href]')].find(item => item.href === link.url)?.textContent.trim(),
        sidebar: [...document.querySelectorAll('.detail-official-actions a[href]')].find(item => item.href === link.url)?.textContent.trim()
      };
    }, deerfield);
    assert.equal(unsafeLabelActions.actionImages, 0, 'An arbitrary review label cannot inject action markup');
    assert.equal(unsafeLabelActions.mobile, 'Book table ↗');
    assert.equal(unsafeLabelActions.sidebar, 'Reservations ↗');
    await page.evaluate(id => {
      const link = restaurants.find(record => record.id === id).reservationLinks.find(item => item.url === 'https://www.deerfieldpub.ca/contact/');
      link.label = 'Reservation inquiry';
      renderRestaurantDetail(id);
    }, deerfield);
    const mexis = 'osm-node-6910685885-mexi-s';
    await page.evaluate(id => { location.hash = '#restaurant/' + id; }, mexis);
    await page.waitForFunction(id => document.querySelector('.save-detail')?.dataset.saveId === id, mexis);
    assert.deepEqual(await page.evaluate(id => [...document.querySelectorAll('a[href^="http"]')].filter(link => !HalifaxDataIntegrity.pointerSafe(id, 'source', link.href)).map(link => link.href), mexis), [], 'Mexi’s existing cross-location source/update holds are enforced');
    assert.deepEqual(errors, []);
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/action-pointer-${width}.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/action-pointer-navigation.json', JSON.stringify(receipts, null, 2));
console.log(`Action navigation passed ${receipts.length} checks at mobile/tablet/desktop widths, including Back/Forward and reload; no external action clicked.`);
