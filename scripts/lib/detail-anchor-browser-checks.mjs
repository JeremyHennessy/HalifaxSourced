import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function verifyDetailAnchorNavigation(page, width) {
  const detailHash = '#restaurant/osm-way-88879193-henry-house';
  // Keep the real detail layout, but do not introduce a new map-tile transport
  // surface into this anchor test. Map lifecycle/tiles have their own gate.
  await page.evaluate(() => { window.__detailAnchorMapInitializer = initDetailMap; initDetailMap = () => {}; });
  const checks = [], diagnostics = [];
  const diagnosticPath = `artifacts/review-priorities/detail-anchor-steps-${width}.json`;
  await mkdir('artifacts/review-priorities', { recursive: true });
  try {
    await page.evaluate(() => navigate('#explore'));
    await page.waitForFunction(() => location.hash === '#explore' && document.querySelector('.restaurant-card'));
    await page.evaluate(hash => navigate(hash), detailHash);
    await page.waitForFunction(hash => location.hash === hash && document.querySelector('.detail-tabs'), detailHash);
    const originalHistoryLength = await page.evaluate(() => history.length);
    const record = async step => {
      diagnostics.push(step);
      await writeFile(diagnosticPath, JSON.stringify({ width, steps: diagnostics }, null, 2));
      console.log('Detail anchor diagnostic', JSON.stringify({ width, ...step, result: step.result ? { ...step.result, trace: step.result.settled ? undefined : step.result.trace } : undefined }));
    };
    const snapshot = async (phase, id) => record({ phase, id, snapshot: await page.evaluate(id => {
      const target = document.getElementById(id), header = document.getElementById('siteHeader'), tabs = document.querySelector('.detail-tabs');
      return { scrollY, targetTop: target?.getBoundingClientRect().top, headerBottom: header?.getBoundingClientRect().bottom, tabsTop: tabs?.getBoundingClientRect().top, tabsBottom: tabs?.getBoundingClientRect().bottom, tabScrollLeft: tabs?.scrollLeft, viewportWidth: innerWidth, hash: location.hash, focus: document.activeElement.id };
    }, id) });
    const settle = async id => {
      const settlement = await page.evaluate(waitForDetailAnchorSettlement, { id });
      await record({ phase: 'settled', id, result: settlement });
      assert(settlement.settled, `Anchor did not settle at ${width}px: ${JSON.stringify(settlement)}`);
      // Assert the exact stable sample, not a later evaluate racing another frame.
      const result = settlement.sample;
      assert.equal(result.hash, detailHash);
      assert.equal(result.historyLength, originalHistoryLength, 'Section tabs must not add route history entries');
      assert.equal(result.focus, id);
      assert(result.headingTop >= result.coveredUntil + 2, `Heading hidden by sticky navigation at ${width}px: ${JSON.stringify(result)}`);
      assert(result.headingBottom <= result.bottomLimit, `Heading outside usable viewport at ${width}px: ${JSON.stringify(result)}`);
      checks.push(result);
      return result;
    };
    const activate = async id => { await snapshot('before-click', id); await page.locator(`.detail-tabs a[href="#${id}"]`).click(); return settle(id); };
    await activate('detailMenu');
    await page.screenshot({ path: `artifacts/review-priorities/detail-menu-${width}.png` });
    await activate('detailSources');
    await activate('detailMenu');
    const previous = checks.at(-1);
    const repeated = await activate('detailMenu');
    assert(Math.abs(repeated.scrollY - previous.scrollY) < 2, `Repeated same-tab activation must be stable: ${JSON.stringify({ width, previous, repeated })}`);
    await snapshot('before-rapid-clicks', 'detailSources');
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
  } catch (error) {
    diagnostics.push({ phase: 'failure', message: String(error.stack || error), checks });
    await writeFile(diagnosticPath, JSON.stringify({ width, steps: diagnostics }, null, 2));
    throw error;
  } finally {
    await page.evaluate(() => { if (window.__detailAnchorMapInitializer) initDetailMap = window.__detailAnchorMapInitializer; delete window.__detailAnchorMapInitializer; });
  }
}

// This function is serialized into the browser by page.evaluate. Keep it
// self-contained so its exact RAF/deadline behavior can also run in the VM test.
export function waitForDetailAnchorSettlement({ id, timeoutMs = 5000 }) {
  return new Promise(resolve => {
    const started = performance.now(), trace = [];
    let frame, timer, finished = false, previous, quietSince, stableIntervals = 0;
    const finish = (settled, reason, sample = previous) => {
      if (finished) return;
      finished = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      resolve({ settled, reason, sample, elapsedMs: performance.now() - started, stableIntervals, quietMs: quietSince === undefined ? 0 : performance.now() - quietSince, trace });
    };
    const measure = () => {
      const target = document.getElementById(id), tabs = document.querySelector('.detail-tabs'), header = document.getElementById('siteHeader');
      if (!target || !tabs || !header) throw Error('Anchor, tabs or header missing');
      const targetRect = target.getBoundingClientRect(), headerRect = header.getBoundingClientRect(), tabsRect = tabs.getBoundingClientRect();
      const heading = (target.querySelector('h2') || target).getBoundingClientRect();
      const bar = document.querySelector('.mobile-tabbar');
      const bottomLimit = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
      const stickyTop = parseFloat(getComputedStyle(tabs).top) || 0;
      const offset = Math.max(headerRect.bottom, stickyTop) + tabsRect.height + 8;
      const documentTop = scrollY + targetRect.top, scrollHeight = document.documentElement.scrollHeight;
      const destination = Math.min(Math.max(0, documentTop - offset), scrollHeight - innerHeight);
      return { id, viewportWidth: innerWidth, viewportHeight: innerHeight, hash: location.hash, historyLength: history.length, focus: document.activeElement.id, scrollY, scrollX, documentTop, targetTop: targetRect.top, headingTop: heading.top, headingBottom: heading.bottom, headerBottom: headerRect.bottom, tabsTop: tabsRect.top, tabsBottom: tabsRect.bottom, tabHeight: tabsRect.height, tabScrollLeft: tabs.scrollLeft, stickyTop, scrollHeight, offset, destination, coveredUntil: Math.max(headerRect.bottom, tabsRect.bottom), bottomLimit };
    };
    const tick = () => {
      frame = undefined;
      if (finished) return;
      try {
        const now = performance.now(), sample = measure();
        const nearTarget = Math.abs(sample.scrollY - sample.destination) < 2;
        const unchanged = previous && Object.keys(sample).every(key => sample[key] === previous[key]);
        if (!nearTarget) { quietSince = undefined; stableIntervals = 0; }
        else if (!unchanged || quietSince === undefined) { quietSince = now; stableIntervals = 0; }
        else stableIntervals++;
        previous = sample;
        trace.push({ elapsedMs: now - started, nearTarget, stableIntervals, quietMs: quietSince === undefined ? 0 : now - quietSince, ...sample });
        if (trace.length > 32) trace.shift();
        if (nearTarget && stableIntervals >= 3 && now - quietSince >= 100) finish(true, 'stable', sample);
        else frame = requestAnimationFrame(tick);
      } catch (error) { finish(false, String(error.message || error)); }
    };
    timer = setTimeout(() => finish(false, 'deadline'), timeoutMs);
    frame = requestAnimationFrame(tick);
  });
}
