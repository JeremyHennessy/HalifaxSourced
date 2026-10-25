import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installOfflineResources } from './lib/offline-browser-resources.mjs';
const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const queen = 'osm-node-5161526522-sushi-nami-royale';
const bayers = 'osm-node-11552234300-sushi-nami-royale';
const retained = '902-422-1636', generic = '+19024229020';
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const resources = await installOfflineResources(context, base);
    const page = await context.newPage();
    async function inspect(id, phone) {
      await page.waitForFunction(id => location.hash === '#restaurant/' + id && document.querySelector('.save-detail')?.dataset.saveId === id, id);
      const details = await page.evaluate(id => {
        const place = restaurants.find(record => record.id === id);
        const mobilePhone = [...document.querySelectorAll('.mobile-essential-facts > div')].find(node => node.querySelector('span')?.textContent === 'Phone')?.querySelector('strong')?.textContent;
        return {
          id, phone: place.phone, mobilePhone,
          sidebarPhone: document.querySelector('.detail-info-phone > p')?.textContent,
          structuredPhone: place.structuredFacts?.phone,
          structuredObservedAt: place.structuredFacts?.observedAt,
          acceptedObservedAt: place.reviewedPlaceResolution?.observedAt || null,
          sourceUrl: place.reviewedCorrection?.sourceUrl || null,
          observedAt: place.reviewedCorrection?.observedAt || null,
          reviewedAt: place.reviewedCorrection?.reviewedAt || null,
          hasOrdering: place.hasOrdering,
          rejectedSourceAnchors: [...document.querySelectorAll('a[href^="http"]')].filter(link => !HalifaxDataIntegrity.pointerSafe(id, 'source', link.href)).map(link => link.href),
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, id);
      assert.equal(details.phone, phone);
      assert.equal(details.mobilePhone, phone);
      assert.equal(details.sidebarPhone, phone);
      assert.equal(details.structuredPhone, generic, 'Raw generic extraction remains evidence, not rewritten');
      assert.equal(details.overflow, false);
      assert.deepEqual(details.rejectedSourceAnchors, [], 'Existing #217 navigation holds survive');
      if (id === queen) {
        assert.equal(details.structuredObservedAt, '2026-09-04T13:24:27.324Z');
        assert.equal(details.acceptedObservedAt, '2026-08-29');
        assert.equal(details.observedAt, '2026-08-29');
        assert.equal(details.sourceUrl, 'https://sushinami.ca/downtown-halifax/');
        assert.equal(details.hasOrdering, true);
      } else {
        assert.equal(details.structuredObservedAt, '2026-09-04T13:24:15.452Z');
        assert.equal(details.sourceUrl, null, 'No Queen correction may leak to Bayers');
        assert.equal(details.hasOrdering, false);
      }
      receipts.push({ width, ...details });
    }
    await page.goto(`${base}/#restaurant/${queen}`, { waitUntil: 'networkidle' });
    await inspect(queen, retained);
    await page.evaluate(id => { location.hash = '#restaurant/' + id; }, bayers);
    await inspect(bayers, generic);
    await page.goBack();
    await inspect(queen, retained);
    await page.goForward();
    await inspect(bayers, generic);
    await page.evaluate(id => { location.hash = '#restaurant/' + id; }, queen);
    await inspect(queen, retained);
    await page.reload({ waitUntil: 'networkidle' });
    await inspect(queen, retained);
    resources.assertClean();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/queen-street-contact-${width}.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/queen-street-contact-navigation.json', JSON.stringify(receipts, null, 2));
console.log(`Queen Street contact passed ${receipts.length} responsive/history/reload checks; no external source request or action click.`);
