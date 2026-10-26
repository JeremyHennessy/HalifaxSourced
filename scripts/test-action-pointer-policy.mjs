import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import integrity from '../source-integrity.js';

const root = new URL('../', import.meta.url);
const bayers = 'osm-node-11552234300-sushi-nami-royale';
const downtown = 'osm-node-5161526522-sushi-nami-royale';
const wrongBranch = 'https://sushinami.ca/downtown-halifax/take-out/';
const validBranch = 'https://sushinami.ca/bayers-lake/lunch-menu/';
const generic = 'https://www.ubereats.com/';
const blockedFirst = [{ url: wrongBranch, label: 'Rejected first', observedAt: '2026-09-04' }, { url: generic, label: 'Unreviewed runner-up' }];
const raw = JSON.stringify(blockedFirst);
for (const kind of ['ordering', 'reservations']) {
  assert.equal(integrity.primaryActionUrl(bayers, kind, blockedFirst), null);
  assert.deepEqual(integrity.actionLinks(bayers, kind, blockedFirst), []);
  assert.equal(integrity.actionAvailable(bayers, kind, blockedFirst, true), false, 'Stale availability cannot bypass a rejected primary');
  assert.equal(integrity.primaryActionUrl(downtown, kind, blockedFirst), wrongBranch, 'Other restaurant identity remains eligible');
  assert.equal(integrity.primaryActionUrl(bayers, kind, [{ url: validBranch }, ...blockedFirst]), validBranch);
  assert.deepEqual(integrity.actionLinks(bayers, kind, [{ url: validBranch }, ...blockedFirst]).map(link => link.url), [validBranch, generic], 'Valid primary retains permitted secondary evidence without promoting rejected entries');
  for (const links of [null, {}, [], [{ url: 'javascript:alert(1)' }], [{ url: null }], [{}]]) assert.equal(integrity.primaryActionUrl(bayers, kind, links), null);
}
assert.equal(JSON.stringify(blockedFirst), raw, 'Policy projection must not mutate raw order or source clocks');
assert.equal(integrity.actionAvailable(bayers, 'reservations', [], true), true, 'Preserve legacy keyword-only reservation capability');
assert.equal(integrity.actionAvailable(bayers, 'ordering', [], true), false);
assert.equal(integrity.primaryActionUrl(bayers, 'unknown', [{ url: generic }]), null);
const kindSpecific = 'https://www.takosushiramen.ca/menu/chefs-special-rolls';
assert.equal(integrity.pointerSafe('osm-node-11552510567-tako-sushi-and-ramen', 'special', kindSpecific), false);
assert.equal(integrity.primaryActionUrl('osm-node-11552510567-tako-sushi-and-ramen', 'ordering', [{ url: kindSpecific }]), kindSpecific, 'Do not broaden an existing kind-specific rejection');

const lifecycle = await readFile(new URL('app-lifecycle.js', root), 'utf8');
const addedBlock = lifecycle.match(/  for \(const \[kind, field, flag\][\s\S]*?\n  }\n/);
assert(addedBlock, 'Locate the action projection block for the former behavior comparison');
const formerLifecycle = lifecycle.replace(addedBlock[0], '');
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-25T21:00:00.000Z'])); }
  static now() { return RealDate.parse('2026-10-25T21:00:00.000Z'); }
}
const html = await readFile(new URL('index.html', root), 'utf8');
async function actualProjection(lifecycleSource) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({insertAdjacentHTML:()=>{}}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date: FixedDate, Intl, Set, Map });
  let rawBefore;
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
    const file = match[1];
    if (file.startsWith('vendor/')) continue;
    if (file === 'app-lifecycle.js') rawBefore = JSON.stringify(Object.fromEntries(Object.entries(context.window).filter(([key]) => key.startsWith('HALIFAX_'))));
    vm.runInContext(file === 'app-lifecycle.js' ? lifecycleSource : await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
    if (file === 'app-feature-filters.js') break;
  }
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(context.window).filter(([key]) => key.startsWith('HALIFAX_')))), rawBefore, 'All source payloads and original clocks survive final action projection');
  return { context, restaurants: JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context)), raw: rawBefore };
}
const before = await actualProjection(formerLifecycle);
const after = await actualProjection(lifecycle);
assert.equal(before.raw, after.raw);
const changed = new Set([bayers, 'osm-node-7465111619-brawta-jamaican-jerk-joint', 'osm-node-4797459277-downtown-pizza']);
assert.deepEqual(before.restaurants.map(record => record.id), after.restaurants.map(record => record.id));
for (let index = 0; index < before.restaurants.length; index++) {
  const prior = before.restaurants[index], final = after.restaurants[index];
  if (!changed.has(final.id)) assert.deepEqual(final, prior, `Unrelated projection changed: ${final.id}`);
  else {
    assert.equal(prior.hasOrdering, true);
    assert.equal(final.hasOrdering, false);
    assert.deepEqual({ ...final, hasOrdering: true }, prior, 'Only ordering availability changes; all raw action arrays are retained');
  }
  for (const [kind, field] of [['ordering', 'orderingLinks'], ['reservations', 'reservationLinks']]) {
    assert.deepEqual(final[field], prior[field]);
    for (const link of integrity.actionLinks(final.id, kind, final[field])) assert(integrity.pointerSafe(final.id, kind, link.url));
  }
}
const counts = records => ({ ordering: records.filter(record => record.hasOrdering).length, reservations: records.filter(record => record.hasReservation).length });
assert.deepEqual(counts(before.restaurants), { ordering: 62, reservations: 97 });
assert.deepEqual(counts(after.restaurants), { ordering: 59, reservations: 97 });
const keywordOnly = before.restaurants.filter(record => record.hasReservation && !record.reservationLinks?.length);
assert.equal(keywordOnly.length, 42);
for (const prior of keywordOnly) {
  const final = after.restaurants.find(record => record.id === prior.id);
  assert.equal(final.hasReservation, prior.hasReservation, 'Do not redefine keyword-only reservation capability');
  assert.deepEqual(final.reservationLinks, prior.reservationLinks);
}
assert.equal(after.context.window.__halifaxOrderingLinkedRestaurantCount, 59);
assert.equal(after.context.window.__halifaxReservationLinkedRestaurantCount, 97);
const filteredIds = JSON.parse(vm.runInContext('JSON.stringify(filteredRestaurants({feature:"ordering"}).map(record=>record.id))', after.context));
for (const id of changed) assert(!filteredIds.includes(id), 'Array-length fallback must not restore rejected availability');

// Valid structured provider metadata must survive deduplication with first-party
// links that lack provider fields (e.g. OpenTable/Tock/Toast).
let preservedProviderTerms = 0;
for (const record of after.restaurants) {
  const text = vm.runInContext(`searchableText(restaurants.find(record=>record.id===${JSON.stringify(record.id)}))`, after.context);
  for (const [kind, field, factField] of [['ordering','orderingLinks','ordering'],['reservations','reservationLinks','reservations']]) {
    if (!integrity.primaryActionUrl(record.id, kind, record[field])) continue;
    for (const fact of record.structuredFacts?.[factField] || []) {
      if (!fact.provider || !integrity.pointerSafe(record.id, kind, fact.url)) continue;
      assert(text.includes(fact.provider.replaceAll('_',' ').toLowerCase()), `Valid provider term lost: ${record.id} ${fact.provider}`);
      preservedProviderTerms++;
    }
  }
}
assert(preservedProviderTerms > 100, 'Exercise the actual retained provider search universe');

// Reapply the actual final lifecycle after a stale decorator/manual mutation.
// Its retained array order must never become a new primary on repeated visits.
const stateBefore = JSON.stringify(after.restaurants);
for (const id of changed) vm.runInContext(`restaurants.find(record=>record.id===${JSON.stringify(id)}).hasOrdering=true`, after.context);
vm.runInContext(lifecycle, after.context);
assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), stateBefore);
vm.runInContext(lifecycle, after.context);
assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), stateBefore, 'Repeated application is idempotent');

// A unique rejected action label/provider is absent from both search decorators;
// unrelated descriptive source keywords remain existing search evidence.
vm.runInContext(`
  const actionSearchFixture = {
    id: ${JSON.stringify(bayers)}, name: 'Fixture',
    orderingLinks: [{url:${JSON.stringify(wrongBranch)},label:'rejectedlabel',provider:'rejectedprovider'}, {url:${JSON.stringify(generic)},label:'runneruplabel',provider:'runnerupprovider'}],
    relatedLinks: [{kind:'ordering',url:${JSON.stringify(generic)},label:'relatedrunneruplabel'}],
    structuredFacts: {ordering:[{url:${JSON.stringify(wrongBranch)},provider:'rejectedprovider'}]}
  };
`, after.context);
const search = vm.runInContext('searchableText(actionSearchFixture)', after.context);
for (const term of ['rejectedlabel', 'rejectedprovider', 'runneruplabel', 'runnerupprovider', 'relatedrunneruplabel']) assert(!search.includes(term), term);

// Use the real detail renderer; stub only unrelated UI/DOM helpers.
vm.runInContext(await readFile(new URL('app-media.js', root), 'utf8'), after.context);
vm.runInContext(await readFile(new URL('app-detail.js', root), 'utf8'), after.context);
vm.runInContext(`
  mediaTone=()=>''; permittedImageClass=()=>''; mediaImageMarkup=()=>''; mediaAttributionMarkup=()=>'';
  consumerTags=()=>[]; primaryCuisine=()=>'';
  relatedLinkRow=()=>''; socialProfileRow=()=>''; linkHubRow=()=>'';
  structuredSpecialDetailRow=()=>''; structuredEventDetailRow=()=>'';
  currentStructuredSpecial=()=>false; infoCard=()=>''; socialPlatformLabel=()=>''; linkHubLabel=()=>'';
  bindRestaurantDetailTabs=()=>{}; bindCommonActions=()=>{};
  requestAnimationFrame=()=>{};
`, after.context);
for (const id of changed) {
  vm.runInContext(`renderRestaurantDetail(${JSON.stringify(id)})`, after.context);
  const rendered = vm.runInContext('appView.innerHTML', after.context);
  assert(!/>Order online ↗<\/a>/.test(rendered), 'Neither mobile nor desktop may promote a rejected primary or its runner-up');
  assert(!rendered.includes(`href="${wrongBranch}"`), 'No rejected branch pointer in actions, source evidence or latest updates');
}
vm.runInContext(`renderRestaurantDetail(${JSON.stringify(downtown)})`, after.context);
assert(vm.runInContext('appView.innerHTML', after.context).includes(`href="${wrongBranch}"`), 'Valid original-first Downtown action remains visible');
// Exercise actual source/update renderers for every final restaurant. Compare
// only original display slots, retaining raw evidence and kind-specific history.
const rawBeforeRender = vm.runInContext('JSON.stringify(restaurants)', after.context);
const evidenceChanges = [];
const rejectedEvidencePaths = {
  'osm-node-267592735-bluenose-ii': {
    source: ['/wp-admin/nav-menus.php?action=locations'],
    update: ['/wp-login.php?redirect_to=https%3A%2F%2Fbluenoseii.ca%2Fwp-admin%2Fnav-menus.php%3Faction%3Dlocations&reauth=1']
  },
  'osm-node-6910685885-mexi-s': {
    source: ['/moncton/lunch', '/moncton/dinner/', '/moncton/kids/', '/ottawa/dinner/', '/ottawa/kids/'],
    update: ['/moncton/kids/', '/moncton/dinner/', '/moncton/lunch/']
  },
  [downtown]: {
    source: ['/dartmouth-crossing/lunch-menu/', '/bayers-lake/lunch-menu/', '/bedford-highway/lunch-menu/', '/bayers-lake/dinner/', '/dartmouth-crossing/dinner/'],
    update: ['/dartmouth-crossing/dinner/', '/bayers-lake/dinner/', '/bedford-highway/lunch-menu/', '/bayers-lake/lunch-menu/', '/dartmouth-crossing/lunch-menu/']
  },
  [bayers]: {
    source: ['/downtown-halifax/lunch-menu/', '/downtown-halifax/take-out/', '/dartmouth-crossing/lunch-menu/', '/bedford-highway/lunch-menu/', '/downtown-halifax/dinner/', '/dartmouth-crossing/dinner/'],
    update: ['/dartmouth-crossing/dinner/', '/downtown-halifax/dinner/', '/bedford-highway/lunch-menu/', '/dartmouth-crossing/lunch-menu/', '/downtown-halifax/take-out/', '/downtown-halifax/lunch-menu/']
  }
};
for (const record of after.restaurants) {
  const formerlyShown = [];
  for (const source of record.sources || []) {
    const url = vm.runInContext(`safeUrl(${JSON.stringify(source.url ?? null)})`, after.context);
    if (url) formerlyShown.push({ label: source.label || source.type || 'Source', url });
  }
  if (record.signal?.website) formerlyShown.push({ label: 'Official website', url: vm.runInContext(`safeUrl(${JSON.stringify(record.signal.website)})`, after.context) });
  const priorSources = formerlyShown.filter((link, index, links) => link.url && links.findIndex(item => item.url === link.url) === index).slice(0, 24);
  const expectedSources = priorSources.filter(link => integrity.pointerSafe(record.id, 'source', link.url));
  const actualSources = JSON.parse(vm.runInContext(`JSON.stringify(uniqueSourceLinks(restaurants.find(record=>record.id===${JSON.stringify(record.id)})))`, after.context));
  assert.deepEqual(actualSources, expectedSources, `Source links retain original order/cap and neutral evidence scope: ${record.id}`);
  const priorUpdates = !vm.runInContext(`isRestaurantActive(restaurants.find(record=>record.id===${JSON.stringify(record.id)}))`, after.context) ? [] : (record.officialUpdates || []).filter(update => vm.runInContext(`safeUrl(${JSON.stringify(update.postUrl ?? null)})`, after.context)).slice(0, 12);
  const rejectedUpdates = priorUpdates.filter(update => !integrity.pointerSafe(record.id, 'update', update.postUrl));
  const removedSources = priorSources.length - actualSources.length;
  if (removedSources || rejectedUpdates.length) {
    evidenceChanges.push({ id: record.id, sourceLinks: removedSources, updates: rejectedUpdates.length });
    const origin = record.id === 'osm-node-267592735-bluenose-ii' ? 'https://bluenoseii.ca' : record.id === 'osm-node-6910685885-mexi-s' ? 'https://www.mexicalirosas.com' : 'https://sushinami.ca';
    assert.deepEqual(priorSources.filter(link => !integrity.pointerSafe(record.id, 'source', link.url)).map(link => link.url), rejectedEvidencePaths[record.id].source.map(path => origin + path));
    assert.deepEqual(rejectedUpdates.map(update => update.postUrl), rejectedEvidencePaths[record.id].update.map(path => origin + path));
    vm.runInContext(`renderRestaurantDetail(${JSON.stringify(record.id)})`, after.context);
    const rendered = vm.runInContext('appView.innerHTML', after.context);
    for (const match of rendered.matchAll(/href="(https?:[^" ]+)"/g)) assert(integrity.pointerSafe(record.id, 'source', match[1].replaceAll('&amp;', '&')), `Rejected cross-branch public anchor: ${record.id} ${match[1]}`);
    for (const update of priorUpdates.filter(update => integrity.pointerSafe(record.id, 'update', update.postUrl))) assert(rendered.includes(`href="${update.postUrl.replaceAll('&','&amp;')}"`), 'Valid update remains visible');
  }
}
assert.deepEqual(evidenceChanges, [
  { id: 'osm-node-6910685885-mexi-s', sourceLinks: 5, updates: 3 },
  { id: downtown, sourceLinks: 5, updates: 5 },
  { id: bayers, sourceLinks: 6, updates: 6 },
  { id: 'osm-node-267592735-bluenose-ii', sourceLinks: 1, updates: 1 }
]);
assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), rawBeforeRender, 'Rendering preserves every source/update object and original date');
for (const url of ['https://sushinami.ca/', 'https://sushinami.ca/contact/']) assert(integrity.pointerSafe(bayers, 'source', url), 'Shared-brand source evidence remains allowed');
assert(integrity.pointerSafe('osm-node-11552510567-tako-sushi-and-ramen', 'source', kindSpecific), 'Neutral evidence must not inherit a menu/special-specific rejection');
// Synthetic cap regression: neither evidence section fills a rejected original slot.
vm.runInContext(`
  const cappedSourcesFixture = { id: ${JSON.stringify(bayers)}, sources: [
    {url:${JSON.stringify(wrongBranch)}}, ...Array.from({length:24},(_,index)=>({url:'https://sushinami.ca/bayers-lake/?source='+index}))
  ] };
`, after.context);
assert.equal(vm.runInContext('uniqueSourceLinks(cappedSourcesFixture).length', after.context), 23);
assert(!vm.runInContext('uniqueSourceLinks(cappedSourcesFixture).some(link=>link.url.endsWith("source=23"))', after.context));
vm.runInContext(`
  const updateCapRestaurant = restaurants.find(record=>record.id===${JSON.stringify(bayers)});
  const retainedUpdates = updateCapRestaurant.officialUpdates;
  updateCapRestaurant.officialUpdates = [{postUrl:${JSON.stringify(wrongBranch)}}, ...Array.from({length:12},(_,index)=>({postUrl:'https://sushinami.ca/bayers-lake/?update='+index}))];
  renderRestaurantDetail(${JSON.stringify(bayers)});
`, after.context);
const cappedUpdateHtml = vm.runInContext('appView.innerHTML', after.context);
assert(cappedUpdateHtml.includes('href="https://sushinami.ca/bayers-lake/?update=10"'));
assert(!cappedUpdateHtml.includes('href="https://sushinami.ca/bayers-lake/?update=11"'), 'Update cap cannot promote a later item');
vm.runInContext('updateCapRestaurant.officialUpdates = retainedUpdates', after.context);
assert.equal(vm.runInContext('JSON.stringify(restaurants)', after.context), rawBeforeRender);
console.log(JSON.stringify({ removedExistingRejectedPublicEvidence: evidenceChanges }, null, 2));
// Exercise reservation rejection through the same final lifecycle, filter and
// actual mobile/sidebar renderer, even though no accepted record has it today.
vm.runInContext(`
  const reservationFixture = restaurants.find(record=>record.id===${JSON.stringify(bayers)});
  reservationFixture.reservationLinks = [{url:${JSON.stringify(wrongBranch)}},{url:${JSON.stringify(generic)}}];
  reservationFixture.hasReservation = true;
`, after.context);
vm.runInContext(lifecycle, after.context);
assert.equal(vm.runInContext('reservationFixture.hasReservation', after.context), false);
assert.equal(vm.runInContext(`filteredRestaurants({feature:'reservations'}).some(record=>record.id===${JSON.stringify(bayers)})`, after.context), false);
vm.runInContext(`renderRestaurantDetail(${JSON.stringify(bayers)})`, after.context);
assert(!/>Book table ↗<\/a>|>Reservations ↗<\/a>/.test(vm.runInContext('appView.innerHTML', after.context)));

const workflow = await readFile(new URL('.github/workflows/quality-gate.yml', root), 'utf8');
assert(workflow.includes('node scripts/test-action-pointer-policy.mjs'));
console.log(JSON.stringify({ changedOrderingAvailability: [...changed], before: counts(before.restaurants), after: counts(after.restaurants), unchangedRestaurantProjections: before.restaurants.length - changed.size, keywordOnlyReservationsPreserved: keywordOnly.length }, null, 2));
console.log('Action policy passed: exact entity/kind/URL, raw clocks/order, no runner-up promotion, actual browser filters/search/detail and repeat lifecycle.');
