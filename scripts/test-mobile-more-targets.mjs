import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../styles-mobile-fixes.css');
const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
assert.match(sheets.at(-1), /styles-mobile-fixes\.css\?v=20261027-more-target-1$/, 'Load the cache-busted mobile target override after component styles');
const targetRule = css.match(/\[data-mobile-more-sheet\] button,\s*\.mobile-more-sheet button\s*\{([^}]+)\}/)?.[1];
assert(targetRule, 'Keep the override on the actual More-sheet button selectors');
assert.match(css, /^@media \(max-width:640px\)\{/, 'Keep mobile-only target sizing');
for (const dimension of ['width', 'height']) {
  const minimum = targetRule.match(new RegExp(`min-${dimension}:([0-9.]+)px!important`));
  assert(minimum && Number(minimum[1]) >= 48, `More-sheet button needs a real minimum ${dimension} above the 44px audit floor`);
}
assert.match(targetRule, /flex-shrink:0;/, 'Do not let the heading shrink its close target');
const sheetMarkup = html.match(/<aside[^>]*data-mobile-more-sheet[\s\S]*?<\/aside>/)?.[0] || '';
assert.match(sheetMarkup, /<button[^>]*data-mobile-more-close[^>]*aria-label="Close more navigation"/);
assert.deepEqual([...sheetMarkup.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]),
  ['#news', '#specials', '#menus', '#saved', '#explore?feature=opening'], 'Retain every More-menu destination');

// Exercise the actual audit branch without launching a browser. In particular,
// 43.99999999999994 must still fail, and the failure must not print as 44px.
const audit = read('./verify-iphone-links.mjs');
const smallTargetCheck = audit.match(/if \(rect\.width < 44 \|\| rect\.height < 44\) \{([\s\S]*?)\n      \}/)?.[0];
assert(smallTargetCheck, 'Retain the strict, unrounded 44px threshold');
for (const [width, height] of [[44, 44], [48, 48], [43.99999999999994, 44], [48, 43.99999999999994], [40, 40]]) {
  const smallTargets = runInNewContext(`const smallTargets = []; ${smallTargetCheck}; smallTargets`, {
    rect: { width, height }, label: '×', element: { tagName: 'BUTTON' }
  });
  assert.equal(smallTargets.length, width < 44 || height < 44 ? 1 : 0);
  if (smallTargets.length) {
    assert.equal(smallTargets[0].width, width, 'Report the exact failing width');
    assert.equal(smallTargets[0].height, height, 'Report the exact failing height');
  }
}
console.log('Mobile More target regression passed: 48px non-shrinking minimum, routes/label, strict fractional audit and unrounded diagnostics (offline contract only).');
