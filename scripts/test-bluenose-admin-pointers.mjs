import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const id = 'osm-node-267592735-bluenose-ii';
const admin = 'https://bluenoseii.ca/wp-admin/nav-menus.php?action=locations';
const login = 'https://bluenoseii.ca/wp-login.php?redirect_to=https%3A%2F%2Fbluenoseii.ca%2Fwp-admin%2Fnav-menus.php%3Faction%3Dlocations&reauth=1';
const menu = 'https://bluenoseii.ca/menu/';
const policy = await readFile(new URL('source-integrity.js', root), 'utf8');
const additions = policy.match(/  \/\/ BEGIN BLUENOSE ADMIN POINTER SUPPRESSIONS\n[\s\S]*?  \/\/ END BLUENOSE ADMIN POINTER SUPPRESSIONS\n/);
assert(additions, 'Locate the exact scoped policy addition for the former-behaviour comparison');
const formerPolicy = policy.replace(additions[0], '');
const now = Date.now();
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const html = await readFile(new URL('index.html', root), 'utf8');
async function model(source) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({ insertAdjacentHTML() {} }), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem() {} }, console, URL, Date: FixedDate, Intl, Set, Map });
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
    const file = match[1]; if (file.startsWith('vendor/')) continue;
    vm.runInContext(file === 'source-integrity.js' ? source : await readFile(new URL(file, root), 'utf8'), context, { filename: file });
    if (file === 'app-feature-filters.js') break;
  }
  const raw = JSON.stringify(Object.fromEntries(Object.entries(context.window).filter(([key]) => key.startsWith('HALIFAX_'))));
  const records = JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
  for (const file of ['app-media.js', 'app-events.js', 'app-detail.js']) vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, { filename: file });
  // Keep the actual source, related-link and update renderers. Only unrelated
  // media/UI and DOM/event helpers are stubbed; no external destination is opened.
  vm.runInContext(`mediaTone=()=>''; permittedImageClass=()=>''; mediaImageMarkup=()=>''; mediaAttributionMarkup=()=>'';
    consumerTags=()=>[]; primaryCuisine=()=>''; structuredSpecialDetailRow=()=>''; structuredEventDetailRow=()=>'';
    currentStructuredSpecial=()=>false; infoCard=()=>''; bindRestaurantDetailTabs=()=>{}; bindCommonActions=()=>{}; requestAnimationFrame=()=>{};`, context);
  return { context, raw, records, integrity: context.HalifaxDataIntegrity };
}
const before = await model(formerPolicy), after = await model(policy);
assert.equal(after.raw, before.raw, 'All accepted source data and original observation clocks are byte-identical');
assert.deepEqual(after.records.map(record => record.id), before.records.map(record => record.id));
const changedKinds = new Set(['menu', 'source', 'update']);
for (const url of [admin, login]) for (const kind of ['menu', 'source', 'update', 'special', 'ordering', 'reservations', 'image_preview', 'evidence']) {
  assert.equal(after.integrity.pointerSafe(id, kind, url), changedKinds.has(kind) ? false : before.integrity.pointerSafe(id, kind, url), kind + ' ' + url);
  assert.equal(after.integrity.pointerSafe('different-location', kind, url), before.integrity.pointerSafe('different-location', kind, url), 'No other identity affected');
  assert.equal(after.integrity.safeSource(url), before.integrity.safeSource(url), 'No new collection-access rule');
}
for (const url of [menu, 'https://bluenoseii.ca/', 'https://bluenoseii.ca/reservations/', admin + '&different=1', 'https://bluenoseii.ca/wp-admin/another-page.php']) {
  for (const kind of changedKinds) assert.equal(after.integrity.pointerSafe(id, kind, url), before.integrity.pointerSafe(id, kind, url), 'Exact URLs only: ' + url);
}
const anchors = text => [...text.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g)].map(match => ({ url: match[1].replaceAll('&amp;', '&'), html: match[0] }));
const render = (context, recordId) => { vm.runInContext(`renderRestaurantDetail(${JSON.stringify(recordId)})`, context); return vm.runInContext('appView.innerHTML', context); };
let unchanged = 0, receipt;
for (let index = 0; index < before.records.length; index++) {
  const previous = before.records[index], current = after.records[index];
  const beforeStamp = vm.runInContext(`restaurantSourceObservationStamp(restaurants.find(record=>record.id===${JSON.stringify(current.id)}))`, before.context);
  const afterStamp = vm.runInContext(`restaurantSourceObservationStamp(restaurants.find(record=>record.id===${JSON.stringify(current.id)}))`, after.context);
  assert.equal(afterStamp, beforeStamp, 'No source freshness change: ' + current.id);
  const oldHtml = render(before.context, current.id), newHtml = render(after.context, current.id);
  if (current.id !== id) {
    assert.deepEqual(current, previous, 'Unrelated complete restaurant projection changed: ' + current.id);
    assert.equal(newHtml, oldHtml, 'Unrelated complete detail render changed: ' + current.id);
    unchanged++;
    continue;
  }
  const expected = { ...previous, menuLinks: previous.menuLinks.filter(link => link.url !== admin), relatedLinks: previous.relatedLinks.filter(link => link.url !== admin) };
  assert.deepEqual(current, expected, 'Only the two derived administrative links are suppressed; raw source/update/history arrays remain');
  assert(current.menuLinks.some(link => link.url === menu));
  assert.equal(current.hasMenu, previous.hasMenu);
  assert.equal(current.hasMenu, true, 'The legitimate menu remains available');
  const oldAnchors = anchors(oldHtml), newAnchors = anchors(newHtml);
  const removed = oldAnchors.filter(link => [admin, login].includes(link.url));
  assert.equal(removed.length, 4, 'Three admin anchors and one login update expose the exact regression');
  assert.equal(removed.filter(link => link.url === admin).length, 3);
  assert.equal(removed.filter(link => link.url === login).length, 1);
  assert.deepEqual(newAnchors, oldAnchors.filter(link => ![admin, login].includes(link.url)), 'Only the four reviewed non-consumer anchors disappear');
  assert(newAnchors.some(link => link.url === menu));
  receipt = { restaurantId: id, beforeAdminAnchors: removed.length, afterAdminAnchors: newAnchors.filter(link => [admin, login].includes(link.url)).length, validMenu: menu, sourceObservationUnchanged: afterStamp };
}
assert(receipt, 'Target identity must exist in the accepted catalogue');
assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), JSON.stringify(after.records), 'Rendering does not mutate the model');
const lifecycle = await readFile(new URL('app-lifecycle.js', root), 'utf8');
for (let repeat = 0; repeat < 2; repeat++) {
  vm.runInContext(lifecycle, after.context);
  assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), JSON.stringify(after.records), 'Repeated lifecycle projection remains idempotent');
}
assert.equal(JSON.stringify(Object.fromEntries(Object.entries(after.context.window).filter(([key]) => key.startsWith('HALIFAX_')))), after.raw);
const workflow = await readFile(new URL('.github/workflows/quality-gate.yml', root), 'utf8');
assert(workflow.includes('node scripts/test-bluenose-admin-pointers.mjs'));
await mkdir(new URL('artifacts/', root), { recursive: true });
const summary = { ...receipt, restaurants: after.records.length, unrelatedCompleteModelsAndRendersUnchanged: unchanged, allRawPayloadsAndSourceClocksUnchanged: true };
await writeFile(new URL('artifacts/bluenose-admin-pointer-regression.json', root), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
