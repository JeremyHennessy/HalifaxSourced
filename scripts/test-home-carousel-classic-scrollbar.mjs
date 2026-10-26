import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installOfflineResources } from './lib/offline-browser-resources.mjs';
import { measureDocumentBounds, assertClassicScrollbarBounds, verifyHomeCarouselLayout } from './lib/home-carousel-browser-checks.mjs';

const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
// Playwright 1.55.0 adds --hide-scrollbars in headless Chromium. Omit only that
// display flag in this separate hosted pass; keep all other defaults intact.
// No CSS injection, synthetic padding/gutters, or sandbox-argument override.
const launchOptions = { headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] };
const browser = await chromium.launch(launchOptions);
await mkdir('artifacts', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 500, height: 900 }, serviceWorkers: 'block' });
  const resources = await installOfflineResources(context, base);
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-06T02:00:00Z') });
  await page.goto(`${base}/#home`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.readyState === 'complete' && document.querySelector('.restaurant-carousel'));
  const initialBounds = await page.evaluate(measureDocumentBounds);
  await writeFile('artifacts/home-carousel-classic-scrollbar-environment.json', JSON.stringify({ launchOptions, initialBounds }, null, 2));
  // Fail rather than silently count another zero-gutter run as acceptance.
  assertClassicScrollbarBounds(initialBounds);
  const receipts = await verifyHomeCarouselLayout(page, { artifactPrefix: 'home-carousel-classic-scrollbar' });
  assertClassicScrollbarBounds(receipts.find(receipt => receipt.width === 500).bounds);
  await writeFile('artifacts/home-carousel-classic-scrollbar-resources.json', JSON.stringify(resources.evidence, null, 2));
  resources.assertClean();
  console.log(`Classic-scrollbar Home carousel passed with an actual ${initialBounds.viewportWidth - initialBounds.clientWidth}px gutter at 500px; internal scroll range, cards and navigation preserved.`);
} finally { await browser.close(); }
