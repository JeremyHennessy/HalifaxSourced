import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the production entry points, with all network requests replaced by
// one explicit fixture. No source snapshots or real source clocks are touched.
const root = await mkdtemp(join(tmpdir(), 'halifax-link-audit-time-'));
try {
  for (const file of ['scripts/check-release-link-health.mjs', 'scripts/check-source-links.mjs', 'scripts/lib/fetch-public-source.mjs', 'scripts/lib/lifecycle-language.mjs', 'scripts/lib/reviewed-corrections.mjs', 'restaurant-corrections.js', 'source-integrity.js']) {
    await mkdir(dirname(join(root, file)), {recursive:true});
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  await mkdir(join(root, 'data/build'), {recursive:true});
  await writeFile(join(root, 'data/reviewed-restaurant-corrections.js'), 'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root, 'data/reviewed-place-resolutions.js'), 'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  const url = 'https://example.com/fixture-location';
  const save = (name, value) => writeFile(join(root, 'data/build', name + '.json'), JSON.stringify(value));
  await save('catalog', {restaurants:[{id:'fixture', website:url, operatingStatus:'active'}]});
  const now = Date.now();
  const fresh = new Date(now - 10000).toISOString();
  const invalid = [undefined, null, '', 'not-a-date', new Date(now + 60000).toISOString(), new Date(now - 86400001).toISOString()];
  const receipt = {url, state:'ok', observedAt:fresh, status:200, confirmedBroken:false, lifecycle:[], kinds:['official_website'], entityIds:['fixture']};
  const report = {generatedAt:fresh, sourceCommitSha:'fixture-head', complete:true, scope:'active_catalog_official_social_menu_actions', totalCatalogRecords:1, results:[receipt], broken:[], counts:{checked:1, broken:0, restricted:0, transient:0}};
  const env = {...process.env, SOURCE_COMMIT_SHA:'fixture-head', GITHUB_SHA:'fixture-head', GITHUB_EVENT_NAME:'pull_request', LINK_HEALTH_SCOPE:'release', LINK_HEALTH_REUSE_RECENT:'1', LINK_HEALTH_LIMIT:'10', LINK_HEALTH_CONCURRENCY:'1'};
  const runGate = () => spawnSync(process.execPath, [join(root, 'scripts/check-release-link-health.mjs')], {env, encoding:'utf8'});
  await save('source-link-health-report', report);
  assert.equal(runGate().status, 0, 'Fresh exact-head report and receipt pass');
  for (const value of invalid) {
    await save('source-link-health-report', {...report, generatedAt:value});
    const result = runGate();
    assert.notEqual(result.status, 0, 'Reject invalid report timestamp: ' + value);
    assert.match(result.stderr, /timestamp/);
    await save('source-link-health-report', {...report, results:[{...receipt, observedAt:value}]});
    assert.notEqual(runGate().status, 0, 'Fresh report cannot launder invalid receipt timestamp: ' + value);
  }
  const hook = join(root, 'mock-fetch.mjs');
  await writeFile(hook, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch=async url=>{if(String(url)!==${JSON.stringify(url)}) throw Error('Unexpected fixture network target: '+url);appendFileSync(${JSON.stringify(join(root,'fetches.txt'))},'fetch\\n');return new Response('fixture',{status:200});};\n`);
  const cases = [
    {label:'fresh same head', at:fresh, sha:'fixture-head', reuse:true},
    ...invalid.map(at => ({label:'invalid receipt ' + at, at, sha:'fixture-head', reuse:false})),
    {label:'older than reuse window', at:new Date(now - 3600001).toISOString(), sha:'fixture-head', reuse:false},
    {label:'different head', at:fresh, sha:'different-head', reuse:false},
    {label:'unbound local run', at:fresh, sha:null, unbound:true, reuse:false}
  ];
  for (const test of cases) {
    await writeFile(join(root,'fetches.txt'), '');
    await save('source-link-health-report', {...report, sourceCommitSha:test.sha, results:[{...receipt, observedAt:test.at}]});
    const result = spawnSync(process.execPath, ['--import', hook, join(root, 'scripts/check-source-links.mjs')], {env:{...env, ...(test.unbound ? {SOURCE_COMMIT_SHA:'', GITHUB_SHA:''} : {})}, encoding:'utf8'});
    assert.equal(result.status, 0, test.label + '\n' + result.stderr);
    const fetched = await readFile(join(root,'fetches.txt'), 'utf8');
    assert.equal(Boolean(fetched), !test.reuse, test.label);
    const output = JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json'), 'utf8'));
    assert.equal(Boolean(output.results[0].reusedObservation), test.reuse, test.label);
    if (test.reuse) assert.equal(output.results[0].observedAt, fresh, 'Reuse preserves original receipt clock');
    else assert(Number.isFinite(Date.parse(output.results[0].observedAt)), 'Actual fixture response creates its own observation');
  }
  console.log('Link audit freshness passed: invalid/future/stale report and receipt times rejected; only recent same-head observations reused; all requests mocked.');
} finally { await rm(root, {recursive:true, force:true}); }
