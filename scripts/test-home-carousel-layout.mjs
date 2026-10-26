import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { measureDocumentBounds, assertClassicScrollbarBounds } from './lib/home-carousel-browser-checks.mjs';

const css = await readFile(new URL('../styles-responsive.css', import.meta.url), 'utf8');
const mobileRules = css.match(/@media \(max-width:640px\)\{([\s\S]*?)\n\}/)?.[1];
assert(mobileRules, 'Mobile carousel sizing remains inside the <=640px media block');
const mobile = mobileRules.match(/\.restaurant-carousel\{width:calc\(([^)]+)\);margin-right:([^;]+);grid-template-columns:([^;]+);gap:([^}]+)\}/);
assert(mobile, 'Mobile carousel keeps its local sizing rule');
assert.equal(mobile[1], '100% + 14px', 'Size against the usable containing block, not scrollbar-inclusive 100vw');
assert.equal(mobile[2], '-14px', 'Keep right-edge bleed');
assert.equal(mobile[3], 'repeat(5,250px)', 'Keep mobile card dimensions');
assert.equal(mobile[4], '12px', 'Keep mobile spacing');
assert.match(css, /\.restaurant-carousel\{grid-template-columns:repeat\(3,minmax\(250px,1fr\)\);overflow-x:auto;/, 'Keep native carousel scrolling at <=900px');

function sample(viewportWidth, clientWidth, scrollWidth) {
  return runInNewContext(`(${measureDocumentBounds.toString()})()`, {
    innerWidth: viewportWidth, document: { documentElement: { clientWidth, scrollWidth } }
  });
}
assert.equal(sample(500, 485, 500).overflow, true, 'Catch the observed 15px scrollbar-gutter overflow that innerWidth misses');
assert.equal(sample(500, 485, 485).overflow, false);
assert.equal(sample(500, 485, 486).overflow, false, 'Allow at most 1px rounding');
assert.equal(sample(500, 485, 487).overflow, true);
assertClassicScrollbarBounds(sample(500, 485, 485));
assert.throws(() => assertClassicScrollbarBounds(sample(500, 500, 500)), /actual positive browser gutter/);
assert.throws(() => assertClassicScrollbarBounds(sample(500, 485, 500)), /fit its clientWidth/);
const classicRunner = await readFile(new URL('./test-home-carousel-classic-scrollbar.mjs', import.meta.url), 'utf8');
assert.match(classicRunner, /ignoreDefaultArgs: \['--hide-scrollbars'\]/, 'Only the scrollbar-hiding default may be omitted; retain other launch/security defaults');

// Geometry contract, not a browser-rendering claim: .page-shell is 100%-28px
// below 640px. Zero-gutter phones retain exactly the old width; classic-gutter
// browsers lose only their accidental document overflow. 900px stays untouched.
const geometry = [];
for (const width of [320, 390, 500, 900]) {
  for (const gutter of [0, 15]) {
    const client = width - gutter;
    if (width <= 640) {
      const shell = client - 28, left = 14;
      const oldRight = left + width - 14;
      const correctedRight = left + shell + 14;
      assert.equal(correctedRight, client);
      assert.equal(oldRight - correctedRight, gutter);
      assert.equal(sample(width, client, correctedRight).overflow, false);
      if (gutter) assert.equal(sample(width, client, oldRight).overflow, true);
      assert(5 * 250 + 4 * 12 > shell + 14, 'Card content still needs native scrolling');
      geometry.push({ width, gutter, oldRight, correctedRight, internalContentWidth: 1298 });
    } else {
      geometry.push({ width, gutter, mobileRuleApplies: false });
    }
  }
}
console.log('Home carousel bounds regression passed (offline contract/geometry only):', JSON.stringify(geometry));
