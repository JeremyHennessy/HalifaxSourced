import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the real offline builder, not a second implementation of its union.
const root = await mkdtemp(join(tmpdir(), 'halifax-menu-coverage-'));
try {
  for (const file of ['scripts/build-content-coverage-report.mjs', 'scripts/reconcile-structured-coverage.mjs', 'scripts/lib/coverage-values.mjs', 'scripts/lib/reviewed-corrections.mjs', 'restaurant-corrections.js', 'scripts/lib/media-rights-contract.mjs', 'source-integrity.js', 'app-media.js']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  await mkdir(join(root, 'data/build'), { recursive: true });
  const save = (name, value) => writeFile(join(root, 'data/build', name + '.json'), JSON.stringify(value));
  await save('catalog', { restaurants: [
    { id: 'existing', name: 'Existing', sources: [{ type: 'menu', url: 'https://local.example/menu' }] },
    { id: 'new-reviewed', name: 'New reviewed location', sources: [
      { type: 'menu', url: 'https://local.example/new-menu', status: 'verified' },
      { type: 'menu', url: 'https://local.example/new-menu', status: 'verified' }
    ] },
    { id: 'archived', name: 'Archived', operatingStatus: 'permanently_closed', sources: [{ type: 'menu', url: 'https://closed.example/menu' }] },
    { id: 'unsafe', name: 'Unsafe', sources: [{ type: 'menu', url: 'https://glitterbeancafe.com/contact' }] },
    { id: 'not-menu', name: 'Not a menu', sources: [
      { type: 'official_website', url: 'https://local.example/menu' },
      { type: 'menu', url: 'javascript:alert(1)' }
    ] }
  ] });
  await save('restaurant-lifecycle-report', { catalogAudit: { records: [{ restaurantId: 'archived', status: 'permanently_closed' }] } });
  await save('verified-source-pages', { menuSources: [{ restaurantId: 'existing', url: 'https://local.example/menu' }, { restaurantId: 'outside-catalog', url: 'https://outside.example/menu' }] });
  await writeFile(join(root, 'data/reviewed-place-resolutions.js'), 'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[{restaurantId:"existing",menuUrl:"https://local.example/menu"}]};');
  execFileSync(process.execPath, [join(root, 'scripts/build-content-coverage-report.mjs')], { cwd: root, stdio: 'pipe' });
  const report = JSON.parse(await readFile(join(root, 'data/build/content-coverage-report.json')));
  assert.equal(report.restaurantCoverage.totalCanonicalPlaces, 5);
  assert.equal(report.restaurantCoverage.withMenuLink, 2, 'Count canonical menu sources once; exclude archived, unsafe, malformed and noncanonical evidence');
  assert.equal(report.restaurantCoverage.withVerifiedMenuLink, 1, 'Reviewed source pointers must not inflate separately parsed/verified menus');
  await writeFile(join(root, 'data/reviewed-restaurant-corrections.js'), 'window.HALIFAX_RESTAURANT_CORRECTIONS={factFieldRejections:[{id:"ambiguous-hours",restaurantId:"new-reviewed",fields:["hours"],reviewState:"rejected"}]};');
  const hours = { monday: [{ open: '00:00', close: '24:00' }] };
  await save('structured-place-facts', { records: [
    { restaurantId: 'new-reviewed', hours, menus: [{ url: 'https://local.example/new-menu' }] },
    { restaurantId: 'existing', hours }
  ] });
  execFileSync(process.execPath, [join(root, 'scripts/reconcile-structured-coverage.mjs')], { cwd: root, stdio: 'pipe' });
  const reconciled = JSON.parse(await readFile(join(root, 'data/build/content-coverage-report.json')));
  assert.equal(reconciled.restaurantCoverage.withMenuLink, 2, 'Structured reconciliation must not count the same canonical menu place twice');
  assert.equal(reconciled.restaurantCoverage.withStructuredOrSourceHours, 1, 'A rejected schedule must not inflate published hours coverage; unrelated hours remain eligible');
  console.log('Menu coverage builder regression passed: canonical reviewed sources included, duplicate/archived/unsafe/orphan evidence controlled, verified metric distinct.');
} finally {
  await rm(root, { recursive: true, force: true });
}
