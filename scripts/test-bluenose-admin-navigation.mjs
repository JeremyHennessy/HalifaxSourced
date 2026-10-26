import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installOfflineResources } from './lib/offline-browser-resources.mjs';

const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const id = 'osm-node-267592735-bluenose-ii';
const admin = 'https://bluenoseii.ca/wp-admin/nav-menus.php?action=locations';
const login = 'https://bluenoseii.ca/wp-login.php?redirect_to=https%3A%2F%2Fbluenoseii.ca%2Fwp-admin%2Fnav-menus.php%3Faction%3Dlocations&reauth=1';
const menu = 'https://bluenoseii.ca/menu/';
const browser = await chromium.launch({ headless: true });
const receipts = [];
await mkdir('artifacts', { recursive: true });
try {
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const gate = await installOfflineResources(context, base);
    const page = await context.newPage();
    await page.goto(`${base}/#restaurant/${id}`);
    async function inspect(stage) {
      await page.waitForFunction(id => location.hash === '#restaurant/' + id && document.querySelector('.save-detail')?.dataset.saveId === id, id);
      const result = await page.evaluate(({ id, admin, login, menu }) => {
        const place = restaurants.find(record => record.id === id);
        const anchors = [...document.querySelectorAll('a[href]')].map(link => link.href);
        const raw = JSON.stringify(Object.fromEntries(Object.entries(window).filter(([key]) => key.startsWith('HALIFAX_'))));
        const model = JSON.stringify(restaurants);
        const baseline = window.__bluenoseAdminAuditBaseline ||= { raw, model };
        return {
          administrativeAnchors: anchors.filter(url => url === admin || url === login),
          validMenuAnchors: anchors.filter(url => url === menu).length,
          hasMenu: place.hasMenu,
          rawAdministrativeEvidenceRetained: place.sources.some(source => source.url === admin) && place.officialUpdates.some(update => update.postUrl === login),
          rawUnchanged: raw === baseline.raw, modelUnchanged: model === baseline.model,
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, { id, admin, login, menu });
      assert.deepEqual(result.administrativeAnchors, []);
      assert(result.validMenuAnchors > 0);
      assert.equal(result.hasMenu, true);
      assert.equal(result.rawAdministrativeEvidenceRetained, true);
      assert.equal(result.rawUnchanged, true);
      assert.equal(result.modelUnchanged, true);
      assert.equal(result.overflow, false);
      receipts.push({ width, stage, ...result });
    }
    await inspect('initial');
    await page.evaluate(() => { location.hash = '#explore'; });
    await page.waitForFunction(() => location.hash === '#explore' && document.querySelector('#sortFilter'));
    await page.goBack();
    await inspect('back');
    await page.goForward();
    await page.waitForFunction(() => location.hash === '#explore' && document.querySelector('#sortFilter'));
    await page.goBack();
    await inspect('return-after-forward');
    await page.reload();
    await inspect('reload');
    await page.screenshot({ path: `artifacts/bluenose-admin-${width}.png`, fullPage: true });
    gate.assertClean();
    await context.close();
  }
} finally { await browser.close(); }
await writeFile('artifacts/bluenose-admin-navigation.json', JSON.stringify(receipts, null, 2) + '\n');
console.log(`Bluenose administrative navigation passed ${receipts.length} checks with offline resources; no external destination clicked.`);
