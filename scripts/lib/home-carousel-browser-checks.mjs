import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Kept independent of carousel.scrollWidth: the carousel should scroll, while
// the document must fit its usable viewport, excluding any scrollbar gutter.
export function measureDocumentBounds() {
  return {
    viewportWidth: innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
}

export function assertClassicScrollbarBounds(bounds) {
  assert.equal(bounds.viewportWidth, 500, 'Use the observed 500px desktop viewport');
  assert(bounds.clientWidth < bounds.viewportWidth, 'Classic-scrollbar acceptance requires an actual positive browser gutter; zero-gutter coverage is separate');
  assert.equal(bounds.overflow, false, 'The classic-scrollbar document must fit its clientWidth');
}

export async function verifyHomeCarouselLayout(page, { artifactPrefix = 'home-carousel' } = {}) {
  const viewport = page.viewportSize();
  const receipts = [];
  await mkdir('artifacts', { recursive: true });
  const save = () => writeFile(`artifacts/${artifactPrefix}-layout.json`, JSON.stringify(receipts, null, 2));
  try {
    for (const width of [320, 390, 500, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => document.readyState === 'complete' && location.hash === '#home' && document.querySelector('.restaurant-carousel'));
      const bounds = await page.evaluate(measureDocumentBounds);
      const carousel = await page.locator('.restaurant-carousel').evaluate(node => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const cards = [...node.querySelectorAll('.restaurant-card')].filter(card => getComputedStyle(card).display !== 'none');
        const ancestors = [];
        for (let parent = node; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent);
          ancestors.push({ tag: parent.tagName, className: parent.className, overflowX: css.overflowX, touchAction: css.touchAction });
        }
        return { left: box.left, right: box.right, width: box.width, clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth, overflowX: style.overflowX, gap: style.columnGap, ancestors,
          cards: cards.map(card => ({ width: card.getBoundingClientRect().width,
            href: card.querySelector('h3 a')?.getAttribute('href'), title: card.querySelector('h3')?.textContent.trim() })) };
      });
      const receipt = { width, bounds, carousel };
      receipts.push(receipt);
      await save();
      assert.equal(bounds.overflow, false, `Home document overflow: ${JSON.stringify(receipt)}`);
      assert(carousel.left >= -1 && carousel.right <= bounds.clientWidth + 1, 'Carousel bounds must fit the document viewport');
      assert.equal(carousel.overflowX, 'auto', 'Keep native horizontal carousel scrolling');
      assert(carousel.cards.length >= 4, 'Keep the Featured restaurant cards');
      assert(carousel.cards.every(card => card.title && card.href?.startsWith('#restaurant/')), 'Keep readable cards and detail links');
      assert(carousel.ancestors.every(node => !['hidden', 'clip'].includes(node.overflowX)), 'Do not hide document overflow on a carousel ancestor');
      assert(carousel.ancestors.every(node => node.touchAction === 'auto' || node.touchAction === 'manipulation' || node.touchAction.includes('pan-x')), 'Do not disable horizontal touch panning');
      if (width <= 640) {
        assert(Math.abs(carousel.left - 14) <= 1 && Math.abs(carousel.right - bounds.clientWidth) <= 1, 'Preserve mobile right-edge bleed and left gutter');
        assert(carousel.cards.every(card => Math.abs(card.width - 250) <= 1), 'Preserve 250px mobile cards');
        assert.equal(carousel.gap, '12px', 'Preserve mobile card spacing');
        assert(carousel.scrollWidth > carousel.clientWidth + 1, 'The mobile carousel must still have internal overflow');
      }
      if (carousel.scrollWidth > carousel.clientWidth + 1) {
        receipt.scroll = await page.locator('.restaurant-carousel').evaluate(node => {
          node.scrollTo({ left: 0, behavior: 'instant' });
          const before = node.scrollLeft;
          node.scrollTo({ left: node.scrollWidth, behavior: 'instant' });
          const end = node.scrollLeft;
          node.scrollTo({ left: 0, behavior: 'instant' });
          return { before, end, reset: node.scrollLeft, expectedEnd: node.scrollWidth - node.clientWidth };
        });
        await save();
        assert(receipt.scroll.end > 0 && Math.abs(receipt.scroll.end - receipt.scroll.expectedEnd) <= 1, 'Last card remains reachable by internal scrolling');
        assert.equal(receipt.scroll.reset, 0, 'Repeated carousel scrolling can return to the first card');
        assert.equal((await page.evaluate(measureDocumentBounds)).overflow, false, 'Internal scrolling must not enlarge the document');
      }
      const detailHash = carousel.cards.at(-1).href;
      await page.locator(`.restaurant-carousel h3 a[href="${detailHash}"]`).click();
      await page.waitForFunction(hash => location.hash === hash && document.querySelector('.restaurant-hero'), detailHash);
      await page.goBack();
      await page.waitForFunction(() => location.hash === '#home' && document.querySelector('.restaurant-carousel'));
      receipt.returnBounds = await page.evaluate(measureDocumentBounds);
      await save();
      assert.equal(receipt.returnBounds.overflow, false, 'Returning from a card must preserve Home bounds');
      await page.screenshot({ path: `artifacts/${artifactPrefix}-${width}.png`, fullPage: true });
    }
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
  return receipts;
}
