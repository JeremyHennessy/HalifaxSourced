import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateAccessPolicy } from './lib/link-access-policy.mjs';

// Regression tests run the real collector and release gate in isolated trees.
// The finite fetch preload has no path to the network: unexpected or unused
// requests fail the subprocess even if application code catches their error.
const dependencies = [
  'scripts/check-source-links.mjs', 'scripts/check-release-link-health.mjs',
  'scripts/import-official-sites.mjs', 'scripts/import-structured-place-facts.mjs', 'scripts/build-thumbnail-candidates.mjs',
  'scripts/lib/robots-policy.mjs', 'scripts/lib/place-facts-history.mjs', 'scripts/lib/media-rights-contract.mjs', 'app-media.js',
  'scripts/lib/fetch-public-source.mjs', 'scripts/lib/lifecycle-language.mjs',
  'scripts/lib/reviewed-corrections.mjs', 'scripts/lib/link-access-policy.mjs',
  'scripts/lib/link-health-urls.mjs', 'scripts/lib/link-health-report.mjs', 'scripts/lib/validate-link-health.mjs',
  'scripts/lib/deny-source-network.mjs', 'scripts/lib/source-access-state.mjs',
  'restaurant-corrections.js', 'source-integrity.js'
];
const committedPolicy = JSON.parse(await readFile(new URL('../data/source-link-access-holds.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => structuredClone(value);
const committedObservations = [committedPolicy, ...(committedPolicy.historicalEvidence || [])].flatMap(group => group.observations);
const sha = 'a'.repeat(40);
const old = '2001-01-01T00:00:00.000Z';
const fresh = () => new Date(Date.now() - 1000).toISOString();
const observation = (url, status = 403, finalUrl = url) => ({url, finalUrl, status, observedAt:old});
function policyFor(observations = [observation('https://unused-policy.example.com/held')]) {
  const policy = {...clone(committedPolicy), provenance:{...clone(committedPolicy.provenance), reportGeneratedAt:old}, observations};
  delete policy.historicalEvidence;
  return policy;
}
const restaurant = (id, website, extra = {}) => ({id, website, operatingStatus:'active', ...extra});
const catalogFor = urls => ({restaurants:urls.map((url, i) => restaurant('fixture-' + i, url))});
const ok = {status:200, body:'ordinary fixture page'};
const root = await mkdtemp(join(tmpdir(), 'halifax-link-access-holds-'));
let cases = 0;
try {
  for (const file of dependencies) {
    await mkdir(dirname(join(root, file)), {recursive:true});
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  await mkdir(join(root, 'data/build'), {recursive:true});
  const save = (file, value) => writeFile(join(root, file), JSON.stringify(value, null, 2));
  const load = file => readFile(join(root, file), 'utf8').then(JSON.parse);
  const reportPath = 'data/build/source-link-health-report.json';
  const hook = join(root, 'mock-fetch.mjs');
  await writeFile(hook, `
import { readFileSync, appendFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { sourceAccessState } from './scripts/lib/source-access-state.mjs';
const plan = JSON.parse(readFileSync(new URL('./fetch-plan.json', import.meta.url), 'utf8'));
const events = new URL('./fetch-events.jsonl', import.meta.url);
const note = event => appendFileSync(events, JSON.stringify({at:new Date().toISOString(), ...event}) + '\\n');
new Headers(); // Warm the implementation before fixture operation deadlines begin.
const forever = () => new Promise(() => {});
let failed = false;
const deferredResponses = [];
const actualWriteFile = fsPromises.writeFile;
fsPromises.writeFile = async (...args) => {
  const result = await actualWriteFile(...args);
  const path = String(args[0]);
  const directory = ['artifacts','data/build'].find(value => path.endsWith('/' + value + '/source-link-health-report.json'));
  if (!directory || !deferredResponses.length) return result;
  note({event:'report-written',directory,sha256:createHash('sha256').update(readFileSync(args[0])).digest('hex')});
  const ready = deferredResponses.filter(item => !item.released && item.after === directory);
  for (const item of ready) { item.released = true; item.resolve(); }
  if (ready.length) {
    // Explicit I/O barrier, not a delay race: resolve late transport only after
    // the chosen report write, then drain its promise callbacks before allowing
    // the collector's next filesystem operation or completion to continue.
    await new Promise(resolve => setImmediate(resolve));
    const state = sourceAccessState();
    for (const item of ready) {
      const late = state.lateRestrictionReceipts.filter(receipt => receipt.sourceUrl === item.url);
      const suspended = state.access.find(item.url)?.reason === 'transport_unresolved';
      if (!suspended || late.length !== ([401,403,429].includes(item.status) ? 1 : 0)) { failed = true; throw Error('Deterministic late-response barrier did not settle safely'); }
      note({event:'interleaved-response-processed',url:item.url,directory,suspended,lateRestrictions:late.length});
    }
  }
  return result;
};
syncBuiltinESMExports();
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  note({event:'fetch', url, method:options.method, redirect:options.redirect});
  options.signal?.addEventListener('abort', () => note({event:'abort', url}), {once:true});
  const queue = plan[url];
  if (!queue?.length) { failed = true; throw Error('Unexpected fixture transport: ' + url); }
  const step = queue.shift();
  if (step.fetchMode === 'stall') return forever();
  if (step.fetchMode === 'abort') return new Promise((resolve,reject) => {
    const fail = () => reject(options.signal.reason || new DOMException('Aborted','AbortError'));
    if (options.signal?.aborted) fail(); else options.signal?.addEventListener('abort',fail,{once:true});
  });
  if (step.fetchMode === 'after-abort') await new Promise(resolve => {
    if (options.signal?.aborted) queueMicrotask(resolve);
    else options.signal?.addEventListener('abort',() => queueMicrotask(resolve),{once:true});
  });
  if (step.fetchMode === 'after-report-write') await new Promise(resolve => deferredResponses.push({url,status:step.status,after:step.releaseAfter,resolve,released:false}));
  if (step.fetchMode === 'reject') throw Error('fixture transport failed');
  if (step.delayMs) await new Promise(resolve => setTimeout(resolve, step.delayMs));
  let read = false;
  const cancel = async () => {
    note({event:'cancel', url});
    if (step.bodyMode === 'stall-cancel') return forever();
    if (step.bodyMode === 'throw-cancel') throw Error('fixture cancellation failed');
  };
  note({event:'response',url,status:step.status});
  return {status:step.status, ok:step.status >= 200 && step.status < 300, url,
    text:async () => { note({event:'body',url}); return step.body || ''; },
    headers:new Headers(step.headers || {}),
    body:{cancel, getReader:() => ({cancel, read:async () => {
      if (!read && step.body) { read = true; note({event:'body', url}); return {done:false, value:new TextEncoder().encode(step.body)}; }
      if (step.bodyMode === 'stall-read') return forever();
      return {done:true};
    }})}};
};
process.on('exit', () => {
  const unused = Object.entries(plan).filter(([, queue]) => queue.length).map(([url, queue]) => url + ' (' + queue.length + ')');
  if (failed || unused.length || deferredResponses.some(item => !item.released)) {
    process.stderr.write('Finite fixture transport mismatch. Unexpected=' + failed + '; unused=' + unused.join(', ') + '\\n');
    process.exitCode = 91;
  }
});
`);
  const baseEnv = {...process.env, NODE_OPTIONS:'--import ' + join(root, 'scripts/lib/deny-source-network.mjs'), SOURCE_COMMIT_SHA:sha, GITHUB_SHA:sha,
    GITHUB_RUN_ID:'987654321', GITHUB_RUN_ATTEMPT:'1',
    GITHUB_EVENT_NAME:'workflow_dispatch', LINK_HEALTH_SCOPE:'release', LINK_HEALTH_REUSE_RECENT:'0',
    LINK_HEALTH_LIMIT:'0', LINK_HEALTH_TIMEOUT_MS:'80', LINK_HEALTH_CONCURRENCY:'6'};
  const run = (script, env = {}) => spawnSync(process.execPath, ['--import', hook, join(root, 'scripts', script)], {
    cwd:root, env:{...baseEnv, ...env}, encoding:'utf8', timeout:10000
  });
  async function configure({policy = policyFor(), catalog = catalogFor([]), firstParty = {records:[]}, facts = {records:[]}, city = {events:[]}, resolutions = [], corrections = {records:[], additions:[], aliases:[]}} = {}) {
    if (policy === null) await rm(join(root, 'data/source-link-access-holds.json'), {force:true});
    else if (typeof policy === 'string') await writeFile(join(root, 'data/source-link-access-holds.json'), policy);
    else await save('data/source-link-access-holds.json', policy);
    for (const [name, value] of Object.entries({catalog, 'first-party-sources':firstParty, 'structured-place-facts':facts, 'city-events':city})) await save('data/build/' + name + '.json', value);
    await writeFile(join(root, 'data/reviewed-restaurant-corrections.js'), 'window.HALIFAX_RESTAURANT_CORRECTIONS=' + JSON.stringify(corrections) + ';');
    await writeFile(join(root, 'data/reviewed-place-resolutions.js'), 'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS=' + JSON.stringify({records:resolutions}) + ';');
    await rm(join(root, reportPath), {force:true});
  }
  async function transport(plan = {}) {
    await save('fetch-plan.json', plan);
    await writeFile(join(root, 'fetch-events.jsonl'), '');
    await rm(join(root, 'artifacts/source-access-diagnostics.jsonl'), {force:true});
  }
  async function collect(plan = {}, env = {}) {
    await transport(plan);
    const result = run('check-source-links.mjs', env);
    assert([0,1].includes(result.status) && !result.error && !result.signal, 'Collector must finish with success or explicit nonpublishable diagnostics, not a harness/transport failure: ' + result.stderr + result.stdout + (result.error || ''));
    assert(!result.stderr.includes('Finite fixture transport mismatch'), 'Unexpected fixture requests are always fatal: ' + result.stderr);
    const report = await load(reportPath);
    const hasPendingReview = report.pendingAccessHolds.length > 0 || (report.pendingTransportReviews || []).length > 0;
    assert.equal(result.status, hasPendingReview ? 1 : 0, 'New restrictions or unresolved transport must stop the workflow command after diagnostics');
    const diagnostics = (await readFile(join(root, 'artifacts/source-access-diagnostics.jsonl'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; })).trim().split('\n').filter(Boolean).map(JSON.parse);
    const loggedDiagnostics = result.stderr.split('\n').filter(line => line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line => JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
    assert.deepEqual(loggedDiagnostics,diagnostics,'Every durable diagnostic must also remain retrievable verbatim from stderr');
    const artifacts = await load('artifacts/source-link-health-report.json');
    assert.deepEqual(artifacts, report, 'Published artifact and build report match exactly');
    assert.equal(await readFile(join(root,'artifacts/source-link-health-report.json'),'utf8'),await readFile(join(root,reportPath),'utf8'),'Both report copies must contain the same immutable bytes');
    const events = (await readFile(join(root, 'fetch-events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    for (const event of events.filter(event => event.event === 'fetch')) {
      assert.equal(event.method, 'GET');
      assert.equal(event.redirect, 'manual', 'Every redirect goes through source guards');
    }
    return {report, events, diagnostics};
  }
  async function producer(script, plan = {}, env = {}) {
    await transport(plan);
    const outcome = run(script, env);
    assert.equal(outcome.status, 0, script + ' must complete using only the finite fixture plan: ' + outcome.stdout + outcome.stderr + (outcome.error || ''));
    const events = (await readFile(join(root, 'fetch-events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    return {outcome,events};
  }
  async function browserPayload(file, variable) {
    const source = await readFile(join(root,file),'utf8');
    const prefix = 'window.' + variable + ' = ';
    assert(source.startsWith(prefix));
    return JSON.parse(source.slice(prefix.length).replace(/;\s*$/, ''));
  }
  async function gate(report, pass = true, label = '') {
    if (report) await save(reportPath, report);
    await transport();
    const result = run('check-release-link-health.mjs');
    if (pass) assert.equal(result.status, 0, label + '\n' + result.stderr + result.stdout + (result.error || ''));
    else {
      assert.equal(result.error, undefined, 'Gate rejection must not be a subprocess timeout: ' + label);
      assert.equal(result.signal, null, 'Gate rejection must not be a killed process: ' + label);
      assert(Number.isInteger(result.status) && result.status > 0, 'Gate must reject ' + label + '\n' + result.stdout);
      assert(!result.stderr.includes('Finite fixture transport mismatch'), 'Gate must reject its evidence, not fail fixture transport: ' + label);
    }
    return result;
  }
  const checked = label => { cases++; console.log('ok ' + cases + ' - ' + label); };
  const expectedCounts = rows => ({checked:rows.length, reused:rows.filter(r => r.reusedObservation === true).length, attempted:rows.filter(r => r.attempted).length,
      unattempted:rows.filter(r => !r.attempted).length, observed:rows.filter(r => r.observedAt !== null).length,
      ...Object.fromEntries(['ok','broken','restricted','transient','http_error','quarantined','held'].map(s => [s === 'http_error' ? 'httpError' : s, rows.filter(r => r.state === s).length]))});
  const counts = report => assert.deepEqual(report.counts, expectedCounts(report.results));
  function refreshSummaries(report) {
    report.counts = expectedCounts(report.results);
    report.broken = report.results.filter(row => row.confirmedBroken);
    for (const state of ['restricted','transient','held']) report[state] = report.results.filter(row => row.state === state);
    report.lifecycleCandidates = report.results.filter(row => row.attempted && row.state === 'ok' && row.observedAt).flatMap(row => row.lifecycle.map(candidate => ({...candidate,sourceUrl:row.url,observedAt:row.observedAt,restaurantIds:row.officialEntityIds})));
    return report;
  }
  function held(row, prior = null, attempted = false) {
    assert.equal(row.state, 'held');
    assert.equal(row.status, null);
    assert.equal(row.observedAt, null);
    assert.equal(row.attempted, attempted);
    if (!attempted) { assert.equal(row.attemptedAt, null); assert.deepEqual(row.receipts, []); }
    assert.equal(row.finalUrl, null);
    assert.equal(row.confirmedBroken, false);
    assert(!row.reusedObservation, 'An access hold is never a reused successful observation');
    assert.deepEqual(row.lifecycle, []);
    assert.deepEqual(row.priorObservation, prior);
    assert.equal(row.accessHold.resume, 'reviewed_evidence_required');
    assert(Date.now() - Date.parse(row.assessedAt) < 10000, 'Assessment clock belongs to this run, not the old source evidence');
  }

  // All 223 actual committed current and historical observations must suppress transport, even when
  // a recent same-head success cache would otherwise be eligible for reuse.
  assert.equal(committedPolicy.observations.length, 187, 'Retain all reviewed incident observations');
  assert.equal(committedObservations.length, 223, 'Retain earlier restrictions and all nine reviewed HTTP receipts');
  assert.deepEqual(committedPolicy.historicalEvidence.map(group => [group.provenance.workflowRunId,group.observations.length]), [['39767300296',26],['39744158052',1],...Array.from({length:5},()=>['39792176695',1]),['39801572908',1],['39817151873',1],['39817151873',1],['39964122111',1]]);
  const originalPolicy = {...clone(committedPolicy),historicalEvidence:clone(committedPolicy.historicalEvidence.slice(0,2))};
  assert.equal(digest(originalPolicy),'1a77c729b7328969f7f244e6d4d1343dda513447a1f271e56cf75ee852c9c123','All original observations, clocks and provenance remain unchanged');
  const beforeOrderOnlinePolicy = {...clone(committedPolicy),historicalEvidence:clone(committedPolicy.historicalEvidence.slice(0,-4))};
  assert.equal(digest(beforeOrderOnlinePolicy),'2556894ef813c8d585120bad40af0cd211662467c3694cd1b8b28338f4f28a03','All 219 prior observations, clocks and provenance remain exactly unchanged');
  const beforeCurrentMainPolicy = {...clone(committedPolicy),historicalEvidence:clone(committedPolicy.historicalEvidence.slice(0,-3))};
  assert.equal(digest(beforeCurrentMainPolicy),'f30a03d7dbe7b22298e2e2145c17c4fa4e95ab3e1c1f4cc07b99f0c32cdd043e','All 220 observations preceding current main remain exactly unchanged');
  const beforeNogginsPolicy = {...clone(committedPolicy),historicalEvidence:clone(committedPolicy.historicalEvidence.slice(0,-1))};
  assert.equal(digest(beforeNogginsPolicy),'6d7a0ab05fe6a190af187869ff077958c6911abbf3b3faef7e0572f766715343','All 222 observations preceding the scheduled Noggins denial remain exactly unchanged');
  validateAccessPolicy(committedPolicy);
  assert(committedPolicy.historicalEvidence[0].observations.every(row => row.status === 403 && new URL(row.url).hostname === 'junglejims.ca'));
  assert.equal(committedPolicy.historicalEvidence[1].observations[0].status, 429);
  const independentUrl = value => { const url = new URL(value); url.hash = ''; url.hostname = url.hostname.toLowerCase().replace(/\.+$/,'').replace(/^www\./,''); return url.href; };
  const exactRestrictionKeys = new Set(committedObservations.filter(row => [401,403].includes(row.status)).flatMap(row => [independentUrl(row.url),independentUrl(row.finalUrl)]));
  const restrictedHosts = new Set(committedObservations.filter(row => row.status === 429).map(row => new URL(independentUrl(row.finalUrl)).hostname));
  assert.equal(exactRestrictionKeys.size, 82, 'Independent normalized exact source/final restriction union');
  assert.deepEqual([...restrictedHosts].sort(), ['cantongardenns.com','instagram.com','linkedin.com']);
  for (const group of [committedPolicy,...committedPolicy.historicalEvidence]) {
    assert.equal(group.provenance.repository, 'JeremyHennessy/HalifaxSourced');
    if (group.provenance.kind === 'reviewed_workflow_log') {
      const p = group.provenance;
      const expected = {
        '39792176695':{sourceCommitSha:'c1fd484193edb6200a508f067f00d47ac6656de2',workflowJobId:119870732180,logSha256:'24ccd634fb6f1b5677901fb4250bef55a2b80539918576f8b5d7d377db958bca',policy:originalPolicy},
        '39801572908':{sourceCommitSha:'8baaca6180488c84ba31d0bb4eef9617a5b1aa0d',workflowJobId:119903376388,logSha256:'75c5846730bc055cb7383f1b1982e2acd67570628a7e00d1008cd01deb3110b0',policy:beforeOrderOnlinePolicy},
        '39817151873':{sourceCommitSha:'18091d41dbcc1d57e759cb9149d93f5c2396a251',workflowJobId:119958511096,logSha256:'5090ddddc0d48d57a60333afb892f42c06a5456cb47066dc3ed324376f975df6',policy:beforeCurrentMainPolicy},
        '39964122111':{sourceCommitSha:'ba6be06ce519e66aabb6b866d18e2dfb4f9ef96f',workflowJobId:120449390865,logSha256:'e152a2329e1f5548e14d842539684b327e3b4f203c8eb2908d5d2ac14c02b41c',policy:beforeNogginsPolicy}
      }[p.workflowRunId];
      assert(expected,'Only the four specifically reviewed failed workflow runs may supply these real observations');
      assert.equal(p.sourceCommitSha,expected.sourceCommitSha);
      assert.equal(p.workflowRunAttempt,'1');
      assert.equal(p.workflowJob,'data-integrity');
      assert.equal(p.workflowJobId,expected.workflowJobId);
      assert.equal(p.logSha256,expected.logSha256);
      assert.equal(p.accessPolicySha256,digest(expected.policy));
      assert.equal(p.diagnostic.kind,'http_restriction');
      assert.equal(p.diagnosticSha256,digest(p.diagnostic));
      assert.equal(p.receiptSha256,digest(p.diagnostic.evidence.receipt));
      assert.deepEqual(group.observations,[p.diagnostic.evidence.hold.evidence]);
      assert.equal(p.diagnostic.evidence.late,false);
      assert.equal(p.diagnostic.evidence.suspensionId,null);
      assert(!Object.hasOwn(p.diagnostic.evidence.receipt,'retryAfter'),'No Retry-After header was recorded');
      assert(group.observations.every(row => Date.parse(row.observedAt) <= Date.parse(p.loggedAt)));
    } else {
      assert.equal(group.provenance.kind, undefined, 'Only the strict original artifact provenance or reviewed workflow-log variant is accepted');
      assert.equal(group.provenance.member, 'data/build/source-link-health-report.json');
      assert.match(group.provenance.artifactSha256, /^[a-f0-9]{64}$/);
      assert.match(group.provenance.memberSha256, /^[a-f0-9]{64}$/);
      assert(group.observations.every(row => Date.parse(row.observedAt) <= Date.parse(group.provenance.reportGeneratedAt)));
    }
  }
  assert.deepEqual(committedPolicy.historicalEvidence.slice(2).map(group=>group.observations[0].status),[403,403,403,403,429,403,403,403,403]);
  await configure({policy:committedPolicy, catalog:catalogFor(committedObservations.map(r => r.url))});
  const fakeRecent = {version:3, sourceCommitSha:sha, accessPolicySha256:digest(committedPolicy), results:committedObservations.map((r, i) => ({url:r.url, state:'ok', status:200, observedAt:fresh(), attempted:true, lifecycle:[{kind:'closures', phrase:'permanently closed'}], entityIds:['fixture-' + i], kinds:['official_website']}))};
  await save(reportPath, fakeRecent);
  let result = await collect({}, {LINK_HEALTH_REUSE_RECENT:'1'});
  assert.equal(result.events.length, 0);
  assert.equal(result.report.results.length, 223);
  result.report.results.forEach((r, i) => held(r, committedObservations[i]));
  assert.equal(result.report.counts.held, 223);
  assert.equal(result.report.counts.attempted, 0);
  assert.deepEqual(result.report.lifecycleCandidates, []);
  assert.deepEqual(result.report.pendingAccessHolds, []);
  counts(result.report);
  await gate(result.report);
  checked('all 223 committed artifact/log restrictions retain original evidence and make zero calls; independent union is 82 exact keys and three hosts');

  // The previous failed QA run adds exactly one URL, never an order.online host hold.
  const latestObservation = committedPolicy.historicalEvidence.at(-4).observations[0];
  assert.deepEqual(latestObservation,{url:'https://order.online/business/~277519',finalUrl:'https://order.online/business/~277519',status:403,observedAt:'2026-10-22T15:11:21.212Z'});
  assert.equal(committedPolicy.historicalEvidence.at(-4).provenance.diagnostic.evidence.receipt.attemptedAt,'2026-10-22T15:11:21.146Z');
  const latestAliases = [latestObservation.url,'https://www.order.online./business/~277519#retained-reference'];
  const unrelatedBusinessUrls = ['https://order.online/business/fixture-unrelated-one','https://order.online/business/fixture-unrelated-two'];
  await configure({policy:committedPolicy,catalog:catalogFor([...latestAliases,...unrelatedBusinessUrls])});
  result = await collect(Object.fromEntries(unrelatedBusinessUrls.map(url=>[url,[ok]])));
  held(result.report.results[0],latestObservation);
  held(result.report.results[1],null); // A normalized alias has no distinct genuine observation.
  assert.deepEqual(result.report.results[1].accessHold.evidence,latestObservation);
  assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),unrelatedBusinessUrls,'The new exact403 must not block unrelated same-host business URLs');
  assert(result.report.results.slice(2).every(row=>row.attempted && row.state==='ok' && row.status===200));
  assert.equal(result.report.counts.held,2);
  assert.equal(result.report.counts.attempted,2);
  await gate(result.report);
  checked('new actual order.online403 and its normalized alias are unattempted with the original clock; unrelated same-host business fixtures remain unaffected');

  // Current main's two reviewed 403s are exact URL holds. Preserve their
  // source identities while allowing unrelated paths on the same hosts.
  const currentMainObservations = committedPolicy.historicalEvidence.slice(-3,-1).map(group => group.observations[0]);
  assert.deepEqual(currentMainObservations,[
    {url:'https://classic-pizza.order-online.ai/',finalUrl:'https://classic-pizza.order-online.ai/',status:403,observedAt:'2026-10-22T16:54:04.780Z'},
    {url:'https://maygarden.order-online.ai/#/',finalUrl:'https://maygarden.order-online.ai/#/',status:403,observedAt:'2026-10-22T16:54:35.670Z'}
  ]);
  const currentAliases = ['https://www.classic-pizza.order-online.ai./#menu','https://www.maygarden.order-online.ai./#retained-reference'];
  const currentUnrelated = ['https://classic-pizza.order-online.ai/menu','https://maygarden.order-online.ai/menu'];
  await configure({policy:committedPolicy,catalog:catalogFor([currentMainObservations[0].url,currentAliases[0],currentMainObservations[1].url,currentAliases[1],...currentUnrelated])});
  result = await collect(Object.fromEntries(currentUnrelated.map(url=>[url,[ok]])));
  held(result.report.results[0],currentMainObservations[0]);
  held(result.report.results[1],null);
  held(result.report.results[2],currentMainObservations[1]);
  held(result.report.results[3],null);
  assert.deepEqual(result.report.results[1].accessHold.evidence,currentMainObservations[0]);
  assert.deepEqual(result.report.results[3].accessHold.evidence,currentMainObservations[1]);
  assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),currentUnrelated);
  assert(result.report.results.slice(4).every(row=>row.attempted && row.state==='ok' && row.status===200));
  assert.equal(result.report.counts.held,4);
  assert.equal(result.report.counts.attempted,2);
  await gate(result.report);
  checked('current main Classic Pizza and May Garden exact403 aliases stay unattempted with original clocks; unrelated same-host fixtures remain callable');

  const exact = 'https://www.exact-hold.example.com/denied?which=one';
  const final = 'https://exact-hold.example.com/login?return=one';
  const rate = 'https://rate-hold.example.com/old';
  const auth = 'https://auth-hold.example.com/private';
  const oldPolicy = policyFor([observation(exact,403,final), observation(rate,429), observation(auth,401)]);
  const heldUrls = [exact, 'https://exact-hold.example.com./denied?which=one#fragment', final,
    'https://www.exact-hold.example.com/login?return=one#fragment', rate,
    'http://www.rate-hold.example.com./new/path', 'https://rate-hold.example.com/unrelated?query=yes', auth];
  const allowedUrls = ['https://exact-hold.example.com/other', 'https://exact-hold.example.com/denied?which=two',
    'http://exact-hold.example.com/denied?which=one', 'https://sub.exact-hold.example.com/denied?which=one',
    'https://sub.rate-hold.example.com/new', 'https://rate-hold.example.com.other.example.net/new', 'https://auth-hold.example.com/public'];
  await configure({policy:oldPolicy, catalog:catalogFor([...heldUrls, ...allowedUrls])});
  result = await collect(Object.fromEntries(allowedUrls.map(url => [url,[ok]])));
  result.report.results.slice(0, heldUrls.length).forEach(r => held(r, oldPolicy.observations.find(o => o.url === r.url) || null));
  assert(result.report.results.slice(heldUrls.length).every(r => r.state === 'ok'));
  assert.equal(result.events.filter(e => e.event === 'fetch').length, allowedUrls.length);
  counts(result.report);
  await gate(result.report);
  checked('decades-old holds persist; 401/403 match exact source/final URLs, 429 matches canonical host only');

  const heldBaseline = clone(result.report);
  const heldMutations = [
    ['fresh HTTP status on held row', r => { r.results[0].status = 403; }],
    ['fresh observation on held row', r => { r.results[0].observedAt = fresh(); }],
    ['invented attempt on held row', r => { r.results[0].attempted = true; }],
    ['invented receipt on held row', r => { r.results[0].receipts = [{url:exact, status:403, observedAt:fresh(), attempt:1}]; }],
    ['known hold replaced by invented timeout', r => { Object.assign(r.results[0], {state:'transient',attempted:true,attemptedAt:r.results[0].assessedAt,attempt:1,error:'timeout'}); }],
    ['missing original evidence', r => { r.results[0].priorObservation = null; }],
    ['altered original evidence', r => { r.results[0].priorObservation.observedAt = fresh(); }],
    ['evidence borrowed by alias URL', r => { r.results[1].priorObservation = clone(oldPolicy.observations[0]); }],
    ['missing hold proof', r => { delete r.results[0].accessHold; }],
    ['hold with altered status', r => { r.results[0].accessHold.evidence.status = 429; }],
    ['old receipt laundered by current assessment', r => { r.results[0].priorObservation.observedAt = r.results[0].assessedAt; }],
    ['hold with forged target', r => { r.results[0].accessHold.target = 'https://other.example.com/'; }],
    ['hold with altered provenance', r => { r.results[0].accessHold.provenance.policySha256 = '0'.repeat(64); }],
    ['hold with lifecycle evidence', r => { r.results[0].lifecycle = [{kind:'closures', phrase:'permanently closed'}]; }],
    ['held assessment timestamp is old', r => { r.results[0].assessedAt = old; }],
    ['held assessment timestamp is future', r => { r.results[0].assessedAt = new Date(Date.now()+60000).toISOString(); }]
  ];
  for (const [label, mutate] of heldMutations) { const report = clone(heldBaseline); mutate(report); await gate(report, false, label); }
  checked('release gate rejects invented held observations, attempts, lifecycle signals, and policy evidence');

  // A 429 must latch before body cancellation finishes. HTTP, www, and trailing
  // dot aliases wait in the same queue; an unrelated host remains independent.
  const start = 'https://runtime-rate.example.com/start';
  const aliases = ['http://www.runtime-rate.example.com/next', 'https://runtime-rate.example.com./third'];
  const unrelated = 'https://independent.example.com/';
  await configure({catalog:catalogFor([start,...aliases,unrelated])});
  result = await collect({[start]:[{status:429, headers:{'retry-after':'120'}, bodyMode:'stall-cancel'}], [unrelated]:[ok]});
  const [limited,...rest] = result.report.results;
  assert.equal(limited.state, 'transient');
  assert.equal(limited.error, 'timeout');
  assert.equal(limited.observedAt, null);
  assert.equal(limited.status, null);
  assert.equal(limited.receipts.length, 1);
  assert.equal(limited.receipts[0].status, 429);
  assert.equal(Date.parse(limited.receipts[0].retryNotBefore) - Date.parse(limited.receipts[0].observedAt), 120000);
  rest.slice(0,2).forEach(r => held(r));
  assert.equal(rest[2].state, 'ok');
  const independentRequest = result.events.findIndex(e => e.event === 'fetch' && e.url === unrelated);
  const rateDeadline = result.events.findIndex(e => e.event === 'abort' && e.url === start);
  assert(independentRequest >= 0 && rateDeadline > independentRequest, 'An unrelated host must run before the restricted host deadline');
  assert.equal(result.report.pendingAccessHolds.length, 1);
  assert.equal(result.report.pendingAccessHolds[0].evidence.observedAt, limited.receipts[0].observedAt);
  assert.equal(result.report.pendingAccessHolds[0].provenance.sourceCommitSha, sha);
  assert.equal(result.report.pendingAccessHolds[0].provenance.requestId, limited.receipts[0].requestId);
  assert.deepEqual(result.events.filter(e => e.event === 'fetch').map(e => e.url).sort(), [start,unrelated].sort());
  counts(result.report);
  await gate(result.report, false, 'new rate limit needs committed reviewed policy');
  checked('current-run 429 latches before stalled cancellation and suppresses alias queue while unrelated host proceeds');

  // Abort is advisory: an HTTP response can arrive after the caller timed
  // out. Keep unrelated work alive beyond 70ms so this exercises late evidence
  // before report serialization, not merely a late callback after process exit.
  for (const lateStatus of [429,200,null]) {
    const first = 'https://late-response.example.com/first';
    const queued = ['http://www.late-response.example.com/second','https://late-response.example.com./third'];
    const independent = [1,2,3].map(index => 'https://late-independent.example.com/keep-open-' + index);
    await configure({catalog:catalogFor([first,...queued,...independent])});
    result = await collect({
      [first]:[lateStatus === null ? {fetchMode:'stall'} : {status:lateStatus,delayMs:70,headers:{'content-type':'text/html','retry-after':'120'},body:'<p>We are permanently closed.</p>'}],
      ...Object.fromEntries(independent.map(url => [url,[{...ok,delayMs:30}]]))
    }, {LINK_HEALTH_TIMEOUT_MS:'45',LINK_HEALTH_CONCURRENCY:'6'});
    assert.deepEqual(result.events.filter(event => event.event === 'fetch').map(event => event.url).sort(), [first,...independent].sort(), 'Uncertain timed-out host must block every queued alias before a late response is known');
    const abort = result.events.findIndex(event => event.event === 'abort' && event.url === first);
    const lateResponse = result.events.findIndex(event => event.event === 'response' && event.url === first);
    const lastIndependent = result.events.findIndex(event => event.event === 'response' && event.url === independent.at(-1));
    assert(abort >= 0 && lastIndependent > abort, 'Unrelated host must continue after the uncertain request times out');
    if (lateStatus === null) assert.equal(lateResponse, -1, 'A never-settling request has no invented HTTP response');
    else assert(lateResponse > abort && lastIndependent > lateResponse, 'The real late response must arrive after timeout but before unrelated collection finishes');
    assert.equal(result.report.pendingTransportReviews.length, 1);
    const suspension = result.report.pendingTransportReviews[0];
    assert.equal(suspension.scope, 'host');
    assert.equal(suspension.target, 'late-response.example.com');
    assert.equal(suspension.reason, 'transport_unresolved');
    assert.equal(suspension.evidence.url, first);
    assert.equal(suspension.evidence.finalUrl, first);
    assert.equal(suspension.evidence.status, null, 'An unresolved request is not an invented HTTP restriction');
    assert.equal(suspension.evidence.observedAt, null);
    assert.equal(suspension.provenance.kind, 'unsettled_transport');
    assert.equal(suspension.provenance.sourceCommitSha, sha);
    assert.equal(suspension.resume, 'reviewed_evidence_required');
    assert(result.diagnostics.some(row => row.kind === 'unsettled_transport' && row.evidence.id === suspension.id));
    const timedOut = result.report.results[0];
    assert.equal(timedOut.state, 'transient');
    assert.equal(timedOut.error, 'timeout');
    assert.equal(timedOut.attempted, true);
    assert.equal(timedOut.status, null);
    assert.equal(timedOut.observedAt, null);
    assert.equal(timedOut.finalUrl, null);
    assert.deepEqual(timedOut.receipts, [], 'A late response cannot become an on-time successful or terminal receipt');
    assert.deepEqual(timedOut.lifecycle, []);
    assert.equal(timedOut.confirmedBroken, false);
    for (const row of result.report.results.slice(1,3)) {
      held(row);
      assert.equal(row.accessHold.id, suspension.id, 'Queued aliases use the unresolved transport suspension, not invented HTTP evidence');
      assert.equal(row.attempted, false);
      assert.equal(row.attemptedAt, null);
      assert.equal(row.attempt, 0);
      assert.equal(row.status, null);
      assert.equal(row.observedAt, null);
      assert.deepEqual(row.receipts, []);
      assert.deepEqual(row.lifecycle, []);
      assert.equal(row.confirmedBroken, false);
    }
    assert(result.report.results.slice(3).every(row => row.state === 'ok'), 'Unrelated host still completes ordinary work');
    assert.deepEqual(result.report.lifecycleCandidates, [], 'Late200 closure language must never revive successful lifecycle evidence');
    assert(!result.events.some(event => event.event === 'body' && event.url === first), 'Late response content must not be read for lifecycle extraction');
    if (lateStatus === 429) {
      const actualHold = result.report.pendingAccessHolds.find(hold => hold.evidence.url === first && hold.evidence.status === 429);
      assert(actualHold, 'Actual late429 must remain explicit restriction evidence requiring review');
      assert.equal(result.report.lateRestrictionReceipts.length, 1);
      const lateReceipt = result.report.lateRestrictionReceipts[0];
      assert.equal(lateReceipt.sourceUrl, first);
      assert.equal(lateReceipt.url, first);
      assert.equal(lateReceipt.status, 429);
      assert.equal(lateReceipt.observedAt, actualHold.evidence.observedAt);
      assert.equal(lateReceipt.requestId, suspension.provenance.requestId);
      assert.equal(lateReceipt.suspensionId, suspension.id);
      assert.equal(lateReceipt.retryAfter, '120');
      assert.equal(Date.parse(lateReceipt.retryNotBefore) - Date.parse(lateReceipt.observedAt), 120000);
      assert(result.diagnostics.some(row => row.kind === 'late_http_restriction' && row.evidence.receipt.requestId === lateReceipt.requestId));
      assert(Date.parse(actualHold.evidence.observedAt) >= Date.parse(result.events[lateResponse].at));
      assert(Date.parse(actualHold.evidence.observedAt) > Date.parse(result.events[abort].at));
    } else {
      assert.deepEqual(result.report.pendingAccessHolds, [], 'Late200 or an absent response must not be fabricated into a restriction receipt');
      assert.deepEqual(result.report.lateRestrictionReceipts, []);
      assert(!result.diagnostics.some(row => row.kind === 'late_http_restriction'));
    }
    counts(result.report);
    const denied = await gate(result.report, false, 'timed-out in-flight host with late' + lateStatus + ' response');
    assert.match(denied.stderr, /uncertain|unresolved|restriction|late/i, 'Fail closed specifically on unresolved source uncertainty/restriction');
  }
  checked('abort-ignoring late429, late200, and never-settling fetches never reopen queued aliases or revive response/lifecycle evidence; unrelated work continues');

  const drain429Url = 'https://drain-response.example.com/first';
  const drainAliases = ['http://www.drain-response.example.com/second','https://drain-response.example.com./third'];
  await configure({catalog:catalogFor([drain429Url,...drainAliases])});
  result = await collect({[drain429Url]:[{status:429,fetchMode:'after-abort',headers:{'retry-after':'0','content-type':'text/html'},body:'<p>We are permanently closed.</p>'}]},
    {LINK_HEALTH_TIMEOUT_MS:'45',LINK_HEALTH_CONCURRENCY:'6'});
  assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),[drain429Url],'Cleanup-window429 must suppress every queued alias even after Retry-After has expired');
  const drainAbort = result.events.findIndex(event=>event.event==='abort' && event.url===drain429Url);
  const drainResponse = result.events.findIndex(event=>event.event==='response' && event.url===drain429Url);
  assert(drainAbort>=0 && drainResponse>drainAbort,'The response must actually settle after abort, inside the cleanup drain');
  assert.deepEqual(result.report.pendingTransportReviews,[],'An actual response settled within cleanup is not unresolved transport');
  assert.equal(result.report.pendingAccessHolds.length,1);
  assert.equal(result.report.lateRestrictionReceipts.length,1);
  const drainReceipt = result.report.lateRestrictionReceipts[0];
  assert.equal(drainReceipt.status,429);
  assert.equal(drainReceipt.sourceUrl,drain429Url);
  assert.equal(drainReceipt.suspensionId,null);
  assert.equal(drainReceipt.retryAfter,'0');
  assert.equal(drainReceipt.retryNotBefore,drainReceipt.observedAt);
  assert.equal(result.report.pendingAccessHolds[0].evidence.observedAt,drainReceipt.observedAt);
  assert.equal(result.report.pendingAccessHolds[0].resume,'reviewed_evidence_required');
  assert.equal(result.report.results[0].state,'transient');
  assert.equal(result.report.results[0].error,'timeout');
  assert.equal(result.report.results[0].status,null);
  assert.equal(result.report.results[0].observedAt,null);
  assert.deepEqual(result.report.results[0].receipts,[],'Late headers must not replace the completed timeout decision');
  result.report.results.slice(1).forEach(row=>held(row));
  assert.deepEqual(result.report.lifecycleCandidates,[]);
  assert(!result.events.some(event=>event.event==='body' && event.url===drain429Url));
  assert(result.diagnostics.some(row=>row.kind==='late_http_restriction' && row.evidence.receipt.requestId===drainReceipt.requestId && row.evidence.suspensionId===null));
  assert(!result.diagnostics.some(row=>row.kind==='unsettled_transport'));
  counts(result.report);
  const drainDenied = await gate(result.report,false,'actual cleanup-window429 with expired Retry-After must remain nonpublishable');
  assert.match(drainDenied.stderr,/New access restrictions require a reviewed policy update/,'Cleanup-window evidence must validate truthfully before the explicit pending-restriction gate rejects it');
  checked('actual expired429 settled inside abort cleanup creates a durable restriction without invented transport uncertainty, successful evidence, or alias retry');

  const ordinaryAbortUrl = 'https://ordinary-abort.example.com/terminal';
  await configure({catalog:catalogFor([ordinaryAbortUrl])});
  result = await collect({[ordinaryAbortUrl]:[{fetchMode:'abort'}]}, {LINK_HEALTH_TIMEOUT_MS:'45'});
  assert.equal(result.report.results[0].state, 'transient');
  assert.equal(result.report.results[0].error, 'timeout');
  assert.equal(result.report.results[0].attempted, true);
  assert.equal(result.report.results[0].observedAt, null);
  assert.equal(result.report.results[0].status, null);
  assert.deepEqual(result.report.results[0].receipts, []);
  assert.deepEqual(result.report.pendingTransportReviews, [], 'Prompt native abort rejection is settled, not unknown transport');
  assert.deepEqual(result.report.lateRestrictionReceipts, []);
  assert.deepEqual(result.report.pendingAccessHolds, []);
  assert.deepEqual(result.diagnostics, []);
  await gate(result.report);
  checked('terminal ordinary native abort settles within cleanup and creates no fabricated uncertainty or HTTP evidence');

  // Deterministically release an abort-ignoring response between the two actual
  // report writes, and separately after both. No timing margin decides the
  // interleaving. The report stays a point-in-time snapshot while later genuine
  // restrictions survive in diagnostics and the host suspension still blocks.
  for (const releaseAfter of ['artifacts','data/build']) for (const lateStatus of [401,403,429,200]) {
    const url = 'https://terminal-late.example.com/' + lateStatus;
    const alias = 'http://www.terminal-late.example.com./queued';
    await configure({catalog:catalogFor([url,alias])});
    result = await collect({[url]:[{status:lateStatus,fetchMode:'after-report-write',releaseAfter,headers:{'content-type':'text/html','retry-after':'120'},body:'<p>We are permanently closed.</p>'}]}, {LINK_HEALTH_TIMEOUT_MS:'45'});
    const writes = result.events.filter(event => event.event === 'report-written');
    assert.deepEqual(writes.map(event=>event.directory),['artifacts','data/build'],'Both reports are written once, never rewritten to absorb late evidence');
    assert.equal(writes[0].sha256,writes[1].sha256,'The published byte snapshot cannot change between writes');
    assert.equal(writes[0].sha256,createHash('sha256').update(await readFile(join(root,reportPath))).digest('hex'),'Neither copy changes after its write');
    const writtenIndex = result.events.findIndex(event => event.event === 'report-written' && event.directory === releaseAfter);
    const responseIndex = result.events.findIndex(event => event.event === 'response' && event.url === url);
    const processedIndex = result.events.findIndex(event => event.event === 'interleaved-response-processed' && event.url === url);
    assert(writtenIndex >= 0 && responseIndex > writtenIndex && processedIndex > responseIndex,'The chosen filesystem barrier must precede the actual response and its registry callback');
    if (releaseAfter === 'artifacts') assert(result.events.findIndex(event=>event.event==='report-written' && event.directory==='data/build') > processedIndex,'Late callback must complete between the report copies');
    else assert.equal(result.events.filter((event,index)=>index>processedIndex && event.event==='report-written').length,0,'Post-publication diagnostics never rewrite the snapshot');
    assert.equal(result.events[processedIndex].suspended,true,'An actual late response never silently resumes the unresolved host');
    assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),[url],'Queued canonical-host alias remains unattempted');
    const lateResponse = result.events.find(event => event.event === 'response' && event.url === url);
    assert(lateResponse && Date.parse(lateResponse.at) >= Date.parse(result.report.generatedAt),'Real clocks must agree with the explicitly ordered post-snapshot response, including equal-millisecond observations');
    assert.equal(result.report.pendingTransportReviews.length, 1);
    assert.deepEqual(result.report.lateRestrictionReceipts, []);
    assert.deepEqual(result.report.pendingAccessHolds, [], 'The serialized report must not invent knowledge of a response not yet received');
    assert.equal(result.report.results[0].state, 'transient');
    assert.equal(result.report.results[0].status, null);
    assert.equal(result.report.results[0].observedAt, null);
    assert.deepEqual(result.report.results[0].receipts, []);
    assert.deepEqual(result.report.results[0].lifecycle, []);
    held(result.report.results[1]);
    assert.equal(result.report.results[1].accessHold.id,result.report.pendingTransportReviews[0].id);
    assert.deepEqual(result.report.lifecycleCandidates, []);
    const lateDiagnostics = result.diagnostics.filter(row => row.kind === 'late_http_restriction');
    if ([401,403,429].includes(lateStatus)) {
      assert.equal(lateDiagnostics.length, 1, 'Actual post-snapshot restriction must survive in durable source diagnostics');
      const receipt = lateDiagnostics[0].evidence.receipt;
      assert.equal(receipt.url, url);
      assert.equal(receipt.status, lateStatus);
      assert(Date.parse(receipt.observedAt) >= Date.parse(lateResponse.at));
      assert.equal(receipt.retryAfter, '120');
      assert.equal(lateDiagnostics[0].disposition, 'nonpublishable_requires_review');
      assert.equal(lateDiagnostics[0].evidence.suspensionId, result.report.pendingTransportReviews[0].id);
    } else assert.deepEqual(lateDiagnostics, [], 'Late200 cannot be reclassified as a restriction or used for closure claims');
    assert(!result.events.some(event => event.event === 'body' && event.url === url));
    await gate(result.report, false, 'terminal late' + lateStatus + ' after ' + releaseAfter + ' cannot clear transport uncertainty');
  }
  checked('eight deterministic interleavings preserve identical immutable report bytes; late401/403/429 remain in blocking stderr/JSONL and late200 never revives content or the suspended host');

  for (const status of [401,403]) {
    const source = 'https://runtime-exact.example.com/denied';
    const alias = 'https://www.runtime-exact.example.com./denied#fragment';
    const other = 'https://runtime-exact.example.com/allowed';
    await configure({catalog:catalogFor([source,alias,other])});
    result = await collect({[source]:[{status}], [other]:[ok]});
    assert.equal(result.report.results[0].state, 'restricted');
    assert.equal(result.report.results[0].receipts[0].status, status);
    held(result.report.results[1]);
    assert.equal(result.report.results[2].state, 'ok');
    assert.equal(result.report.pendingAccessHolds.length, 1);
    await gate(result.report, false, 'new ' + status + ' needs reviewed policy');
  }
  checked('runtime 401/403 stop equivalent URLs but do not suppress other paths; unreviewed restrictions fail the gate');

  for (const value of ['Thu, 01 Jan 2099 00:00:00 GMT', 'not-a-delay', '-1']) {
    const url = 'https://retry-after.example.com/';
    await configure({catalog:catalogFor([url])});
    result = await collect({[url]:[{status:429, headers:{'retry-after':value}}]});
    const receipt = result.report.results[0].receipts[0];
    assert.equal(receipt.retryAfter, value);
    assert.equal(receipt.retryNotBefore, value.startsWith('Thu,') ? '2099-01-01T00:00:00.000Z' : null);
    assert.equal(result.report.pendingAccessHolds[0].resume, 'reviewed_evidence_required');
  }
  checked('Retry-After date and malformed values remain explicit receipts, never automatic hold release');

  const redirected = 'https://redirect-hold.example.com/start';
  const destination = 'https://www.redirect-hold.example.com/private';
  await configure({policy:policyFor([observation(destination)]), catalog:catalogFor([redirected,destination])});
  result = await collect({[redirected]:[{status:302, headers:{location:destination}}]});
  held(result.report.results[0], null, true);
  assert.equal(result.report.results[0].receipts.length, 1);
  assert.equal(result.report.results[0].receipts[0].status, 302);
  assert.equal(result.report.results[0].receipts[0].redirectUrl, destination);
  assert.equal(result.report.results[0].holdTarget, destination);
  held(result.report.results[1], observation(destination));
  assert.deepEqual(result.events.filter(e => e.event === 'fetch').map(e => e.url), [redirected]);
  await gate(result.report);
  checked('redirect destinations are checked before transport and partial 302 receipt does not become a fresh held observation');

  await configure({policy:policyFor([observation(destination)]), catalog:catalogFor([redirected])});
  result = await collect({[redirected]:[{status:404},{status:302,headers:{location:destination}}]});
  held(result.report.results[0], null, true);
  assert.equal(result.report.results[0].attempt, 2, 'A held second-attempt redirect retains the real confirmation attempt');
  assert.deepEqual(result.report.results[0].receipts.map(r => [r.status,r.attempt]), [[404,1],[302,2]]);
  await gate(result.report);
  checked('a second confirmation attempt redirected into a hold preserves both genuine attempt receipts');

  const deadlineUrls = ['https://fetch-deadline.example.com/fetch', 'https://body-deadline.example.com/body', 'https://cancel-deadline.example.com/cancel', 'https://cancel-error.example.com/cancel-error'];
  await configure({catalog:catalogFor(deadlineUrls)});
  result = await collect({
    [deadlineUrls[0]]:[{fetchMode:'stall'}],
    [deadlineUrls[1]]:[{status:200, headers:{'content-type':'text/html'}, body:'<p>We are permanently closed.</p>', bodyMode:'stall-read'}],
    [deadlineUrls[2]]:[{status:200, bodyMode:'stall-cancel'}],
    [deadlineUrls[3]]:[{status:200, bodyMode:'throw-cancel'}]
  });
  for (const [i,r] of result.report.results.entries()) {
    assert.equal(r.attempted, true);
    assert(r.attemptedAt);
    if (i < 3) { assert.equal(r.state, 'transient'); assert.equal(r.error, 'timeout'); assert.equal(r.status, null); assert.equal(r.observedAt, null); assert.equal(r.confirmedBroken, false); }
    else assert.equal(r.state, 'ok');
    assert.equal(r.receipts.length, i === 0 ? 0 : 1);
    assert.deepEqual(r.lifecycle, []);
  }
  assert.deepEqual(result.report.lifecycleCandidates, []);
  counts(result.report);
  await gate(result.report, false, 'unresolved fetch timeout remains a nonpublishable transport review');
  checked('fetch/body/cancel deadlines preserve partial receipts without claiming fresh success or lifecycle proof');

  const hardUrls = ['https://hard.example.com/confirmed', 'https://hard.example.com/recovered', 'https://hard.example.com/incomplete'];
  await configure({catalog:catalogFor(hardUrls)});
  result = await collect({[hardUrls[0]]:[{status:404},{status:410}], [hardUrls[1]]:[{status:410},ok], [hardUrls[2]]:[{status:404},{fetchMode:'stall'}]});
  assert.equal(result.report.results[0].confirmedBroken, true);
  assert.equal(result.report.results[0].state, 'broken');
  assert.deepEqual(result.report.results[0].receipts.map(r => [r.status,r.attempt]), [[404,1],[410,2]]);
  assert.equal(result.report.results[1].state, 'ok');
  assert.equal(result.report.results[1].confirmedBroken, false);
  assert.equal(result.report.results[2].state, 'transient');
  assert.equal(result.report.results[2].confirmedBroken, false);
  assert.equal(result.report.results[2].receipts.length, 1);
  assert.equal(result.report.broken.length, 1);
  await gate(result.report, false, 'unfinished confirmation fetch requires transport review');
  checked('only two actual 404/410 responses confirm broken links; successful or incomplete retries cannot');

  // A self-consistent one-response broken report must not bypass the two
  // actual-response requirement by clearing confirmedBroken and its summary.
  for (const status of [404,410]) {
    const url = 'https://terminal-confirmation.example.com/' + status;
    await configure({catalog:catalogFor([url])});
    result = await collect({[url]:[{status},{status}]});
    await gate(result.report);
    assert.equal(result.report.results[0].receipts.length, 2);
    const truncated = clone(result.report);
    const row = truncated.results[0];
    row.receipts = row.receipts.slice(0,1);
    Object.assign(row, {attempt:1,confirmedBroken:false,status,observedAt:row.receipts[0].observedAt,finalUrl:row.receipts[0].url});
    refreshSummaries(truncated);
    assert.equal(truncated.counts.broken, 1, 'A hard response classification remains visible');
    assert.deepEqual(truncated.broken, [], 'No independently confirmed broken summary remains');
    const denied = await gate(truncated, false, 'terminal ' + status + ' attempt1/unconfirmed after actual second receipt removal');
    assert.match(denied.stderr, /Terminal hard404\/410 lacks actual confirmation response/);
  }
  checked('terminal404 and410 attempt1/unconfirmed mutations fail even after genuine second receipts are removed and all summaries recomputed');

  // Preserve syntactically correct, same-host ordered chains so these mutations
  // isolate impossible request bounds rather than malformed receipt syntax.
  const chainUrls = [1,2,3,4,5].map(index=>'https://receipt-bound.example.com/hop-'+index);
  await configure({catalog:catalogFor([chainUrls[0]])});
  result = await collect(Object.fromEntries(chainUrls.slice(0,4).map((url,index)=>[url,[index===3?ok:{status:302,headers:{location:chainUrls[index+1]}}]])));
  assert.equal(result.report.results[0].receipts.length,4);
  await gate(result.report);
  const fiveResponses = clone(result.report);
  const chainRow = fiveResponses.results[0];
  const fourth = chainRow.receipts.at(-1);
  const fifth = {...clone(fourth),url:chainUrls[4],requestId:String(Math.max(...chainRow.receipts.map(receipt=>Number(receipt.requestId)))+1)};
  Object.assign(fourth,{status:302,redirectUrl:chainUrls[4]});
  chainRow.receipts.push(fifth);
  chainRow.finalUrl=chainUrls[4];
  refreshSummaries(fiveResponses);
  assert(chainRow.receipts.every(receipt=>receipt.attempt===1));
  const tooMany = await gate(fiveResponses,false,'five correctly chained responses within one attempt');
  assert.match(tooMany.stderr,/HTTP chain exceeds four-request bound/);

  const mismatchedAttemptUrl = 'https://receipt-attempt.example.com/confirmed-source';
  await configure({catalog:catalogFor([mismatchedAttemptUrl])});
  result = await collect({[mismatchedAttemptUrl]:[{status:404},ok]});
  await gate(result.report);
  assert.deepEqual(result.report.results[0].receipts.map(receipt=>[receipt.status,receipt.attempt]),[[404,1],[200,2]]);
  const underdeclaredAttempt = clone(result.report);
  Object.assign(underdeclaredAttempt.results[0],{state:'transient',attempt:1,error:'timeout',status:null,observedAt:null,finalUrl:null,confirmedBroken:false,lifecycle:[]});
  delete underdeclaredAttempt.results[0].contentReceipt;
  refreshSummaries(underdeclaredAttempt);
  const exceedsAttempt = await gate(underdeclaredAttempt,false,'attempt1 timeout contains a valid attempt2 response after genuine first404');
  assert.match(exceedsAttempt.stderr,/Receipt exceeds declared attempt/);
  checked('strict gate rejects five correctly chained responses and attempt1 timeout laundering actual attempt2 evidence after summaries are recomputed');

  const live = 'https://lifecycle.example.com/live';
  const closed = 'https://lifecycle.example.com/held';
  await configure({policy:policyFor([observation(closed)]), catalog:catalogFor([live,closed])});
  result = await collect({[live]:[{status:200, headers:{'content-type':'text/html'}, body:'<p>We are permanently closed.</p>'}]});
  assert(result.report.results[0].lifecycle.length > 0);
  held(result.report.results[1], observation(closed));
  assert(result.report.lifecycleCandidates.length > 0);
  assert(result.report.lifecycleCandidates.every(r => r.sourceUrl === live && r.observedAt === result.report.results[0].observedAt));
  await gate(result.report);
  result = await collect({[live]:[ok]}, {GITHUB_EVENT_NAME:'pull_request'});
  assert.equal(result.report.lifecycleExtraction, false);
  assert.deepEqual(result.report.lifecycleCandidates, []);
  checked('lifecycle candidates require actual successful source evidence and remain disabled for pull requests');

  const unsafeSource = 'https://bowtiecreamery.com/held-fixture';
  await configure({policy:policyFor([observation(unsafeSource,429)]), catalog:catalogFor([unsafeSource])});
  result = await collect();
  assert.equal(result.events.length, 0);
  assert.equal(result.report.results[0].state, 'quarantined', 'Existing safety quarantine takes precedence over a canonical-host hold');
  assert.equal(result.report.results[0].attempted, false);
  assert.equal(result.report.results[0].observedAt, null);
  assert.equal(result.report.results[0].status, null);
  assert.deepEqual(result.report.results[0].receipts, []);
  await gate(result.report);
  const redirectOrigin = 'https://quarantine-origin.example.com/start';
  const crossHost = 'https://quarantine-destination.example.com/private';
  await configure({catalog:catalogFor([redirectOrigin])});
  result = await collect({[redirectOrigin]:[{status:302,headers:{location:crossHost}}]});
  assert.equal(result.report.results[0].state, 'quarantined');
  assert.equal(result.report.results[0].attempted, true);
  assert.equal(result.report.results[0].receipts[0].redirectUrl, crossHost);
  assert.deepEqual(result.events.filter(e => e.event === 'fetch').map(e => e.url), [redirectOrigin]);
  await gate(result.report);
  result = await collect({[redirectOrigin]:[ok]});
  const forgedQuarantine = clone(result.report);
  Object.assign(forgedQuarantine.results[0], {state:'quarantined',status:null,observedAt:null,finalUrl:null,attempted:false,attemptedAt:null,attempt:0,receipts:[],error:'quarantined_cross_entity_redirect'});
  Object.assign(forgedQuarantine.counts, {attempted:0,unattempted:1,observed:0,ok:0,quarantined:1});
  await gate(forgedQuarantine, false, 'fabricated quarantine without unsafe source or actual forbidden redirect');
  checked('existing safety quarantine precedes access holds; forbidden redirects preserve receipts and invented quarantine is rejected');

  const reusableUrl = 'https://reusable.example.com/current';
  await configure({catalog:catalogFor([reusableUrl])});
  result = await collect({[reusableUrl]:[{status:200,headers:{'content-type':'text/html'},body:'<p>We are permanently closed.</p>'}]});
  assert(result.report.lifecycleCandidates.length > 0);
  const actualReceipt = clone(result.report.results[0]);
  result = await collect({}, {LINK_HEALTH_REUSE_RECENT:'1'});
  assert.equal(result.events.length, 0);
  assert.equal(result.report.results[0].reusedObservation, true);
  assert.equal(result.report.results[0].contentReceipt, undefined, 'Reused HTML must not retain current content-read proof');
  assert.equal(result.report.results[0].attempted, false);
  assert.equal(result.report.results[0].attemptedAt, null);
  assert.equal(result.report.results[0].attempt, 0);
  assert.equal(result.report.results[0].observationAttemptedAt, actualReceipt.attemptedAt);
  assert.equal(result.report.results[0].observationAttempt, actualReceipt.attempt);
  assert.deepEqual(result.report.results[0].lifecycle, []);
  assert.equal(result.report.counts.attempted, 0);
  assert.equal(result.report.counts.reused, 1);
  counts(result.report);
  assert.equal(result.report.results[0].observedAt, actualReceipt.observedAt);
  assert.deepEqual(result.report.results[0].receipts, actualReceipt.receipts);
  await gate(result.report);
  assert.deepEqual(result.report.lifecycleCandidates, []);
  const cacheBaseline = clone(result.report);
  const cacheMutations = [
    ['cache claims current attempt', r => { r.results[0].attempted = true; }],
    ['cache invents current attempt clock', r => { r.results[0].attemptedAt = r.results[0].assessedAt; }],
    ['cache invents current attempt number', r => { r.results[0].attempt = 1; }],
    ['cache missing provenance', r => { delete r.results[0].reusedFrom; }],
    ['cache wrong source commit', r => { r.results[0].reusedFrom.sourceCommitSha = 'b'.repeat(40); }],
    ['cache wrong policy', r => { r.results[0].reusedFrom.accessPolicySha256 = '0'.repeat(64); }],
    ['cache invalid report digest', r => { r.results[0].reusedFrom.reportSha256 = 'invalid'; }],
    ['cache old source report', r => { r.results[0].reusedFrom.generatedAt = old; }],
    ['cache future source report', r => { r.results[0].reusedFrom.generatedAt = new Date(Date.now()+60000).toISOString(); }],
    ['cache old response laundered by fresh assessment', r => { r.results[0].observedAt = old; r.results[0].receipts[0].observedAt = old; }],
    ['cache missing historical attempt clock', r => { delete r.results[0].observationAttemptedAt; }],
    ['cache incorrect historical attempt', r => { r.results[0].observationAttempt = 2; }],
    ['cache restores old lifecycle language', r => { r.results[0].lifecycle = clone(actualReceipt.lifecycle); }],
    ['cache reused count omitted', r => { r.counts.reused = 0; }]
  ];
  for (const [label, mutate] of cacheMutations) { const report = clone(cacheBaseline); mutate(report); await gate(report, false, label); }
  const newlyCommitted = policyFor([observation(reusableUrl)]);
  await save('data/source-link-access-holds.json', newlyCommitted);
  result = await collect({}, {LINK_HEALTH_REUSE_RECENT:'1'});
  assert.equal(result.events.length, 0);
  held(result.report.results[0], newlyCommitted.observations[0]);
  await gate(result.report);
  checked('genuine same-head success reuse preserves receipt clocks without current attempts or lifecycle; ' + cacheMutations.length + ' laundering mutations fail and newly committed holds supersede caches');

  const mayNotFetch = 'https://must-not-fetch.example.com/';
  for (const invalid of [null, '{', {}, {...policyFor(), resume:'after_retry_after'}, {...policyFor(), expiresAt:old},
    {...policyFor(), observations:[]}, {...policyFor(), observations:[observation(mayNotFetch,200)]},
    {...policyFor(), observations:[observation(mayNotFetch),observation(mayNotFetch)]},
    {...policyFor(), observations:[{...observation(mayNotFetch), observedAt:'invalid'}]},
    {...policyFor(), observations:[observation(mayNotFetch,403,'https://another-host.example.com/')]}]) {
    await configure({policy:invalid, catalog:catalogFor([mayNotFetch])});
    await transport();
    const runResult = run('check-source-links.mjs');
    assert.notEqual(runResult.status, 0, 'Missing/malformed policy must fail before collection');
    assert.equal(await readFile(join(root,'fetch-events.jsonl'),'utf8'), '', 'Invalid policy cannot contact any source');
  }
  checked('missing, malformed, duplicate, invalid-status, cross-host, and release-override policies fail before transport');

  // Independently enumerated coverage checks catch collector/gate drift rather
  // than deriving expected values from their shared universe helper.
  const u = path => 'https://coverage.example.com/' + path;
  const catalog = {restaurants:[
    restaurant('active-a',u('shared'), {sources:[{type:'menu',url:u('catalog-menu')},{type:'listing',url:u('excluded-listing')}]}),
    restaurant('active-b',u('shared')),
    restaurant('inactive',u('excluded-inactive'), {operatingStatus:'permanently_closed'})
  ]};
  const resolutions = [{restaurantId:'active-a',website:u('reviewed-web'),menuUrl:u('reviewed-menu'),socialProfiles:[{platform:'facebook',profileUrl:u('reviewed-social')}]},
    {restaurantId:'inactive',website:u('excluded-resolution')}];
  const firstParty = {records:[{restaurantId:'active-a',socialProfiles:[{platform:'instagram',profileUrl:u('shared')}],linkHubs:[{platform:'linktree',url:u('hub')}],relatedLinks:[{kind:'delivery',url:u('action')}]},
    {restaurantId:'inactive',relatedLinks:[{kind:'delivery',url:u('excluded-action')}]}]};
  const facts = {records:[{restaurantId:'active-b',menus:[{url:u('fact-menu')}],reservations:[{url:u('reservation')}],ordering:[{url:u('ordering')}]},
    {restaurantId:'inactive',menus:[{url:u('excluded-menu')}]}]};
  const expected = [
    {url:u('shared'),kinds:['official_website','social:instagram'],entityIds:['active-a','active-b']},
    ...['catalog-menu','reviewed-web','reviewed-menu','reviewed-social','hub','action'].map((path,i) => ({url:u(path),kinds:[['menu','official_website','menu','social:facebook','link_hub:linktree','action:delivery'][i]],entityIds:['active-a']})),
    ...['fact-menu','reservation','ordering'].map((path,i) => ({url:u(path),kinds:[['menu','reservation','ordering'][i]],entityIds:['active-b']}))
  ];
  await configure({catalog, resolutions, firstParty, facts, city:{events:[{id:'event',ticketUrl:u('excluded-ticket'),officialUrl:u('excluded-event')}]}});
  result = await collect(Object.fromEntries(expected.map(({url}) => [url,[ok]])));
  assert.deepEqual(result.report.results.map(({url,kinds,entityIds}) => ({url,kinds,entityIds})), expected);
  assert.equal(result.report.totalCatalogRecords, 3);
  assert.equal(result.report.activeCatalogRecords, 2);
  assert.equal(result.report.totalUniqueUrls, expected.length);
  assert.equal(result.report.complete, true);
  assert.equal(result.report.version, 3);
  assert.equal(result.report.accessPolicySha256, digest(policyFor()));
  counts(result.report);
  await gate(result.report);
  checked('full ordered active official/social/menu/action universe is covered with exact kinds, entities, counts, and policy digest');

  const baseline = clone(result.report);
  const mutations = [
    ['old report version', r => { r.version = 2; }],
    ['wrong source commit', r => { r.sourceCommitSha = 'b'.repeat(40); }],
    ['wrong workflow run', r => { r.sourceWorkflowRunId = '987654322'; }],
    ['missing workflow run', r => { delete r.sourceWorkflowRunId; }],
    ['missing policy digest', r => { delete r.accessPolicySha256; }],
    ['wrong policy digest', r => { r.accessPolicySha256 = '0'.repeat(64); }],
    ['partial report flag', r => { r.complete = false; }],
    ['wrong report scope', r => { r.scope = 'all_sources'; }],
    ['stale generated clock', r => { r.generatedAt = old; }],
    ['future generated clock', r => { r.generatedAt = new Date(Date.now()+60000).toISOString(); }],
    ['missing result', r => { r.results.pop(); }],
    ['duplicate result', r => { r.results.push(clone(r.results[0])); }],
    ['reordered results', r => { [r.results[0],r.results[1]] = [r.results[1],r.results[0]]; }],
    ['wrong URL', r => { r.results[0].url = u('invented'); }],
    ['wrong result kinds', r => { r.results[0].kinds = ['menu']; }],
    ['wrong result entities', r => { r.results[0].entityIds = ['inactive']; }],
    ['wrong catalog count', r => { r.totalCatalogRecords++; }],
    ['wrong active count', r => { r.activeCatalogRecords++; }],
    ['wrong URL count', r => { r.totalUniqueUrls++; }],
    ['wrong checked count', r => { r.counts.checked++; }],
    ['wrong attempted count', r => { r.counts.attempted--; }],
    ['wrong observed count', r => { r.counts.observed--; }],
    ['forged held summary', r => { r.held = [clone(r.results[0])]; }],
    ['forged broken summary', r => { r.broken = [clone(r.results[0])]; }],
    ['forged lifecycle summary', r => { r.lifecycleCandidates = [{sourceUrl:r.results[0].url,kind:'closures'}]; }],
    ['unreviewed runtime hold', r => { r.pendingAccessHolds = [{scope:'host',target:'coverage.example.com'}]; }],
    ['missing source receipts', r => { delete r.results[0].receipts; }],
    ['empty source receipts', r => { r.results[0].receipts = []; }],
    ['false attempted flag', r => { r.results[0].attempted = false; }],
    ['attempt without an attempt number', r => { r.results[0].attempt = 0; }],
    ['unsupported unattempted timeout', r => { Object.assign(r.results[0],{state:'transient',attempted:false,attemptedAt:null,attempt:0,status:null,observedAt:null,finalUrl:null,receipts:[],lifecycle:[],error:'timeout'}); }],
    ['missing attempt clock', r => { r.results[0].attemptedAt = null; }],
    ['future attempt clock', r => { r.results[0].attemptedAt = new Date(Date.now()+60000).toISOString(); }],
    ['missing assessment clock', r => { delete r.results[0].assessedAt; }],
    ['old source observation', r => { r.results[0].observedAt = old; }],
    ['invented result status', r => { r.results[0].status = 201; }],
    ['terminal attempt differs from its receipt', r => { r.results[0].attempt = 2; }],
    ['invented final URL', r => { r.results[0].finalUrl = u('invented'); }],
    ['invented broken confirmation', r => { r.results[0].confirmedBroken = true; }],
    ['unknown result state', r => { r.results[0].state = 'success'; }],
    ['source receipt status mismatch', r => { r.results[0].receipts[0].status = 404; }],
    ['source receipt URL mismatch', r => { r.results[0].receipts[0].url = 'https://other-host.example.com/'; }],
    ['source receipt clock mismatch', r => { r.results[0].receipts[0].observedAt = old; }],
    ['source receipt missing clock', r => { delete r.results[0].receipts[0].observedAt; }],
    ['source receipt invalid attempt', r => { r.results[0].receipts[0].attempt = 0; }]
  ];
  for (const [label, mutate] of mutations) { const report = clone(baseline); mutate(report); await gate(report, false, label); }
  checked('strict gate rejects ' + mutations.length + ' report, universe, counter, receipt, timestamp, and status mutations');

  result = await collect(Object.fromEntries(expected.slice(0,2).map(({url}) => [url,[ok]])), {LINK_HEALTH_LIMIT:'2'});
  assert.equal(result.report.complete, false);
  assert.equal(result.report.totalUniqueUrls, expected.length);
  assert.equal(result.report.results.length, 2);
  await gate(result.report, false, 'bounded partial collection');
  checked('positive collector limit produces explicitly partial evidence that cannot pass the release gate');


  // Freeze the exact PR validation surface, and freeze the scheduled/manual
  // audit from accepted commit 4f3a43b0ce8236519d2fb9f93e91c4775d8ecb50.
  // Only the explicit PR exclusion and diagnostic-upload step may be added to
  // that audit body. Literal blocks and SHA-256 avoid YAML packages or git in CI.
  // Exercise every producer through its real entrypoint, not a local copy of
  // hold matching. An empty finite plan makes even a robots request fatal.
  const officialCases = [
    {label:'exact',retain:true},
    {label:'alias_fragment',retain:true,current:'https://www.official-producer.example.com./stable#current',prior:{website:'https://official-producer.example.com/stable#old'}},
    {label:'explicit_association',retain:true,prior:{website:'https://official-producer.example.com/redirected',sourceAssociation:'https://official-producer.example.com/stable'}},
    {label:'successful_root_flags',retain:true,prior:{attempted:true,state:'observed'}},
    {label:'historical_held_assessment',retain:true,prior:{latestAssessment:{restaurantId:'historical_held_assessment',website:'https://official-producer.example.com/stable',assessedAt:old,state:'held',error:'source_access_hold',attempted:false,observedAt:null,accessHold:{scope:'url',target:'https://official-producer.example.com/stable',evidence:observation('https://official-producer.example.com/stable')}}}},
    {label:'changed_path',retain:false,prior:{website:'https://official-producer.example.com/old-location'}},
    {label:'changed_query',retain:false,current:'https://official-producer.example.com/stable?location=halifax',prior:{website:'https://official-producer.example.com/stable?location=dartmouth'}},
    {label:'changed_location_identity',retain:false,prior:{restaurantId:'different-location'}},
    {label:'changed_source_association',retain:false,prior:{sourceAssociation:'https://official-producer.example.com/old-location'}},
    {label:'invalid_clock',retain:false,prior:{observedAt:'not-a-source-clock'}},
    {label:'rollover_clock',retain:false,prior:{observedAt:'2026-02-30T00:00:00.000Z'}},
    {label:'timezone_missing_clock',retain:false,prior:{observedAt:'2026-09-01T00:00:00.000'}},
    {label:'missing_clock',retain:false,prior:{observedAt:undefined}},
    {label:'future_clock',retain:false,prior:{observedAt:new Date(Date.now()+86400000).toISOString()}},
    {label:'missing_status',retain:false,prior:{status:undefined}},
    {label:'failed_status',retain:false,prior:{status:403}},
    {label:'string_status',retain:false,prior:{status:'200'}},
    {label:'wrong_kind',retain:false,prior:{sourceKind:'unverified_directory'}},
    {label:'prior_error',retain:false,prior:{error:'previous_attempt_failed'}},
    {label:'root_unattempted',retain:false,prior:{attempted:false}},
    {label:'root_held',retain:false,prior:{state:'held'}},
    {label:'root_failed',retain:false,prior:{state:'failed'}},
    {label:'root_restricted',retain:false,prior:{state:'restricted'}},
    {label:'root_restricted_review',retain:false,prior:{reviewState:'restricted'}},
    {label:'root_hold_target',retain:false,prior:{holdTarget:'https://official-producer.example.com/stable'}},
    {label:'root_access_hold',retain:false,prior:{accessHold:{scope:'url',target:'https://official-producer.example.com/stable',evidence:observation('https://official-producer.example.com/stable')}}},
    {label:'root_reused_observation',retain:false,prior:{attempted:true,reusedObservation:true}},
    {label:'no_prior',retain:false,noPrior:true}
  ];
  const officialCatalog = {restaurants:officialCases.map(item => restaurant(item.label,item.current || 'https://official-producer.example.com/stable',{name:item.label}))};
  const originalOfficialRows = officialCases.filter(item => !item.noPrior).map(item => ({
    restaurantId:item.label,name:item.label,website:'https://official-producer.example.com/stable',
    status:200,observedAt:old,sourceKind:'official_website',reviewState:'cross-check',
    keywordHits:['brunch'],signalMatches:{brunch:['brunch']},candidateLinks:[{href:'https://official-producer.example.com/menu',text:'Historical menu'}],...item.prior
  })).map(row => JSON.parse(JSON.stringify(row)));
  await configure({catalog:officialCatalog,policy:policyFor([...new Set(officialCatalog.restaurants.map(row => row.website))].map(url => observation(url)))});
  await save('data/build/official-site-signals.json',{generatedAt:old,sourceHistory:[],results:originalOfficialRows});
  result = await producer('import-official-sites.mjs',{}, {OFFICIAL_SITE_LIMIT:'999',OFFICIAL_SITE_DELAY_MS:'0',OFFICIAL_SITE_TIMEOUT_MS:'80'});
  assert.deepEqual(result.events, [], 'Known official-source restrictions suppress both robots and page transport');
  const officialOutput = await load('data/build/official-site-signals.json');
  assert.deepEqual(await browserPayload('data/official-site-signals.js','HALIFAX_OFFICIAL_SITE_SIGNALS'),officialOutput);
  assert.equal(officialOutput.assessments.length,officialCases.length);
  for (const item of officialCases) {
    const row = officialOutput.results.find(row => row.restaurantId === item.label);
    const assessment = officialOutput.assessments.find(row => row.restaurantId === item.label);
    const prior = originalOfficialRows.find(row => row.restaurantId === item.label);
    assert(row && assessment,item.label);
    assert.equal(assessment.state,'held',item.label);
    assert.equal(assessment.error,'source_access_hold',item.label);
    assert.equal(assessment.attempted,false,item.label);
    assert.equal(assessment.observedAt,null,item.label);
    assert.equal(assessment.status ?? null,null,item.label);
    assert.equal(assessment.httpObservation,undefined,item.label);
    assert(Date.parse(assessment.assessedAt)>Date.parse(old),item.label);
    if (item.retain) {
      const {latestAssessment,...evidence} = row;
      const {latestAssessment:previousAssessment,...priorEvidence} = prior;
      assert.deepEqual(evidence,priorEvidence,'Retained official source must preserve every original clock and content field: '+item.label);
      assert.deepEqual(latestAssessment,assessment,item.label);
    } else {
      assert.equal(row.observedAt,null,'Invalid or reassociated old evidence must not become current: '+item.label);
      assert.equal(row.status ?? null,null,item.label);
      assert.equal(row.attempted,false,item.label);
      assert.equal(row.keywordHits,undefined,item.label);
      assert.equal(row.signalMatches,undefined,item.label);
      assert.equal(row.candidateLinks,undefined,item.label);
      if (prior) {
        const archived = officialOutput.sourceHistory.find(entry => entry.evidenceId === digest(prior));
        assert(archived,'Disqualified prior evidence must be archived, not relabeled or discarded: '+item.label);
        assert.deepEqual(archived.record,prior,item.label);
        assert(['source_association_changed','invalid_prior_evidence'].includes(archived.reason),item.label);
      }
    }
  }
  const disappearedPrior = originalOfficialRows.find(row => row.restaurantId === 'different-location');
  assert.equal(officialOutput.results.some(row => row.restaurantId === disappearedPrior.restaurantId),false,'A disappeared canonical identity must not survive as active source content');
  assert.deepEqual(officialOutput.sourceHistory.find(entry=>entry.evidenceId===digest(disappearedPrior))?.record,disappearedPrior,'Disappeared identity evidence is archived unchanged');
  checked('actual official-site producer makes zero robots/page calls and retains only valid same-location exact-source evidence with separate held assessments');

  // Limit selection is not permission to bypass evidence qualification. The
  // second prior is deliberately outside the requested refresh batch, but must
  // still match its current canonical catalog identity and exact source.
  let unselectedCases = 0;
  for (const item of officialCases.filter(item=>!item.noPrior)) {
    const currentUrl = item.current || 'https://official-producer.example.com/stable';
    const prior = originalOfficialRows.find(row=>row.restaurantId===(item.prior?.restaurantId || item.label));
    const selectedUrl = 'https://official-producer.example.com/selected';
    await configure({catalog:{restaurants:[restaurant('selected',selectedUrl,{name:'Selected'}),restaurant(item.label,currentUrl,{name:item.label})]},
      policy:policyFor([observation('https://official-producer.example.com/restricted',429)])});
    await save('data/build/official-site-signals.json',{generatedAt:old,sourceHistory:[],results:[prior]});
    result = await producer('import-official-sites.mjs',{}, {OFFICIAL_SITE_LIMIT:'1',OFFICIAL_SITE_DELAY_MS:'0',OFFICIAL_SITE_TIMEOUT_MS:'80'});
    assert.deepEqual(result.events,[],'Unselected retention must not cause robots/page requests: '+item.label);
    const output = await load('data/build/official-site-signals.json');
    assert.deepEqual(await browserPayload('data/official-site-signals.js','HALIFAX_OFFICIAL_SITE_SIGNALS'),output);
    assert.equal(output.checkedWebsites,1,item.label);
    assert.equal(output.assessments.length,1,'No new assessment may be manufactured for an unselected record: '+item.label);
    assert.equal(output.assessments[0].restaurantId,'selected',item.label);
    assert.equal(output.assessments[0].state,'held',item.label);
    assert.equal(output.assessments[0].attempted,false,item.label);
    assert.equal(output.assessments[0].observedAt,null,item.label);
    const unselected = output.results.find(row=>row.restaurantId===prior.restaurantId);
    if (item.retain) {
      assert.deepEqual(unselected,prior,'Valid unselected historical content must remain byte-for-byte unchanged: '+item.label);
      assert.equal(JSON.stringify(unselected),JSON.stringify(prior),item.label);
      assert.deepEqual(output.sourceHistory,[],item.label);
      assert.equal(output.kindCounts.brunch,1,item.label);
      assert.equal(output.count,2,item.label);
    } else {
      assert.equal(unselected,undefined,'Invalid unselected evidence must not remain active content: '+item.label);
      assert.equal(output.results.some(row=>row.restaurantId===item.label),false,'An unselected invalid record must not receive a fabricated replacement assessment: '+item.label);
      assert.equal(output.sourceHistory.length,1,item.label);
      assert.equal(output.sourceHistory[0].evidenceId,digest(prior),item.label);
      assert.deepEqual(output.sourceHistory[0].record,prior,'Unselected invalid evidence must be archived unchanged: '+item.label);
      assert.equal(JSON.stringify(output.sourceHistory[0].record),JSON.stringify(prior),item.label);
      assert.equal(output.kindCounts.brunch,0,'Archived invalid content must not contribute active signal counts: '+item.label);
      assert.equal(output.count,1,item.label);
    }
    unselectedCases++;
  }
  checked('all '+unselectedCases+' unselected official priors use the same strict evidence/source/identity qualification without fabricated assessments or refreshed clocks');

  for (const failureMode of ['robots_denial','transport_rejection']) {
    const sourceUrl = 'https://official-failed.example.com/location';
    const robotsUrl = 'https://official-failed.example.com/robots.txt';
    const prior = {...clone(originalOfficialRows[0]),restaurantId:'failed-official',website:sourceUrl};
    await configure({catalog:{restaurants:[restaurant('failed-official',sourceUrl,{name:'Failed official'})]}});
    await save('data/build/official-site-signals.json',{generatedAt:old,results:[prior]});
    const plan = {[robotsUrl]:[{status:200,body:failureMode==='robots_denial'?'User-agent: *\nDisallow: /\n':'User-agent: *\nDisallow:\n'}]};
    if (failureMode==='transport_rejection') plan[sourceUrl]=[{fetchMode:'reject'}];
    result = await producer('import-official-sites.mjs',plan,{OFFICIAL_SITE_LIMIT:'1',OFFICIAL_SITE_DELAY_MS:'0',OFFICIAL_SITE_TIMEOUT_MS:'80'});
    assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),failureMode==='robots_denial'?[robotsUrl]:[robotsUrl,sourceUrl]);
    const output = await load('data/build/official-site-signals.json');
    const {latestAssessment,...retained} = output.results[0];
    assert.deepEqual(retained,prior,'A failed refresh must not retimestamp previously accepted official evidence');
    assert.deepEqual(output.assessments,[latestAssessment]);
    assert.equal(latestAssessment.state,'failed');
    assert.equal(latestAssessment.attempted,failureMode==='transport_rejection','Only a genuinely initiated page request may count as attempted');
    assert.equal(latestAssessment.observedAt,null);
    assert.equal(latestAssessment.httpObservation,undefined);
    assert.equal(latestAssessment.error,failureMode==='robots_denial'?'robots_disallow':'fixture transport failed');
  }
  checked('actual failed official refreshes retain accepted evidence with separate truthful robots-denied versus attempted transport-failure assessments');

  const factUrls = ['https://facts-producer.example.com/location','http://www.facts-rate.example.com./location'];
  const oldFacts = factUrls.map((sourceUrl,index) => ({restaurantId:'facts-'+index,name:'Facts '+index,sourceUrl,observedAt:old,lastVerifiedAt:old,
    sourceKind:'official_website_structured_facts',reviewState:'verified_source',hours:null,phone:'902-555-010'+index,email:null,address:null,
    features:[{feature:'patio',evidencePhrase:'patio',sourceUrl,observedAt:old,lastVerifiedAt:old,confidence:'official_source_explicit_text'}],
    menus:[{url:sourceUrl+'/menu',menuType:'general',verifiedAt:old}],reservations:[],ordering:[]}));
  await configure({policy:policyFor([observation(factUrls[0]),observation('https://facts-rate.example.com/denial',429)]),
    catalog:{restaurants:factUrls.map((url,index)=>restaurant('facts-'+index,url,{name:'Facts '+index}))},
    firstParty:{records:factUrls.map((url,index)=>({restaurantId:'facts-'+index,website:url,resolvedUrl:url}))},facts:{records:oldFacts,sourceHistory:[]}});
  await save('data/build/verified-source-pages.json',{records:[]});
  result = await producer('import-structured-place-facts.mjs',{}, {STRUCTURED_PLACE_FACT_LIMIT:'999',STRUCTURED_PLACE_FACT_DELAY_MS:'0',STRUCTURED_PLACE_FACT_TIMEOUT_MS:'80'});
  assert.deepEqual(result.events, [], 'Structured-facts holds suppress robots and source fetches');
  const heldFacts = await load('data/build/structured-place-facts.json');
  assert.deepEqual(await browserPayload('data/structured-place-facts.js','HALIFAX_STRUCTURED_PLACE_FACTS'),heldFacts);
  assert.deepEqual(heldFacts.records,oldFacts,'Every accepted top-level and nested source clock/content field survives a held refresh unchanged');
  assert.equal(heldFacts.retainedRecords,2);
  assert.deepEqual(heldFacts.sourceHistory,[]);
  assert.equal(heldFacts.failures.length,2);
  for (const failure of heldFacts.failures) {
    assert.equal(failure.reason,'source_access_hold');
    assert.equal(failure.attempted,false);
    assert(failure.accessHold);
    assert.equal(failure.observedAt ?? null,null);
    assert(Date.parse(failure.checkedAt)>Date.parse(old));
  }
  assert(heldFacts.refreshObservations.every(row=>row.state==='blocked' && row.attempted===false));
  checked('actual structured-facts producer suppresses exact and canonical-host held requests and preserves original accepted evidence clocks');

  const imagePage = 'https://thumbnail-producer.example.com/location';
  const blockedImage = 'https://thumbnail-producer.example.com/photos/terrace.jpg';
  const seedThumbnail = {restaurantId:'thumbnail-held',restaurantName:'Thumbnail held',thumbnailUrl:blockedImage,sourceUrl:imagePage,
    sourceKind:'official_feed_media',extractionMethod:'retained_fixture',observedAt:old,reviewState:'candidate_review',rightsStatus:'requires_rights_review',
    confidence:'official_source',width:900,height:600,imageProbe:{ok:true,status:200,width:900,height:600,contentType:'image/jpeg',sampledBytes:24000}};
  await configure({catalog:{restaurants:[restaurant('thumbnail-held',imagePage,{name:'Thumbnail held'})]},policy:policyFor([observation(imagePage),observation(blockedImage)])});
  await save('data/build/thumbnail-candidates.json',{candidates:[seedThumbnail],failures:[]});
  const thumbnailEnv = {THUMBNAIL_DISCOVERY_DELAY_MS:'0',THUMBNAIL_DISCOVERY_TIMEOUT_MS:'80',THUMBNAIL_DISCOVERY_SCOPE:'all',THUMBNAIL_DISCOVERY_PAGE_LIMIT:'1',
    THUMBNAIL_DISCOVERY_PAGES_PER_RESTAURANT:'1',THUMBNAIL_DISCOVERY_SUBPAGE_LIMIT:'0',THUMBNAIL_IMAGE_PROBE_LIMIT:'1'};
  result = await producer('build-thumbnail-candidates.mjs',{}, {...thumbnailEnv,THUMBNAIL_DISCOVERY_FETCH:'0',THUMBNAIL_IMAGE_PROBE:'0'});
  assert.deepEqual(result.events,[]);
  const originalThumbnails = (await load('data/build/thumbnail-candidates.json')).candidates;
  assert.equal(originalThumbnails.length,1);
  assert.equal(originalThumbnails[0].observedAt,old);
  result = await producer('build-thumbnail-candidates.mjs',{}, {...thumbnailEnv,THUMBNAIL_DISCOVERY_FETCH:'1',THUMBNAIL_IMAGE_PROBE:'1'});
  assert.deepEqual(result.events,[],'The thumbnail producer must not request an exact403-held page');
  const blockedPageOutput = await load('data/build/thumbnail-candidates.json');
  assert.deepEqual(blockedPageOutput.candidates,originalThumbnails,'Held page assessment must not retimestamp or rewrite existing thumbnail evidence');
  assert(blockedPageOutput.failures.some(row=>row.pageUrl===imagePage && row.reason==='source_access_hold'));
  const allowedImagePage = 'https://thumbnail-producer.example.com/gallery';
  await configure({catalog:{restaurants:[restaurant('thumbnail-held',allowedImagePage,{name:'Thumbnail held'})]},policy:policyFor([observation(imagePage),observation(blockedImage)])});
  await save('data/build/thumbnail-candidates.json',{candidates:originalThumbnails,failures:[]});
  result = await producer('build-thumbnail-candidates.mjs',{[allowedImagePage]:[{status:200,headers:{'content-type':'text/html'},body:'<meta property="og:image" content="'+blockedImage+'">'}]}, {...thumbnailEnv,THUMBNAIL_DISCOVERY_FETCH:'1',THUMBNAIL_IMAGE_PROBE:'1'});
  assert.deepEqual(result.events.filter(event=>event.event==='fetch').map(event=>event.url),[allowedImagePage],'An allowed page may be observed, but its exact403-held image must never be requested');
  const blockedImageOutput = await load('data/build/thumbnail-candidates.json');
  assert.deepEqual(await browserPayload('data/thumbnail-candidates.js','HALIFAX_THUMBNAIL_CANDIDATES'),blockedImageOutput);
  assert.deepEqual(blockedImageOutput.candidates.filter(row=>row.sourceKind==='official_feed_media'),originalThumbnails);
  const imageCandidate = blockedImageOutput.candidates.find(row=>row.sourceKind==='official_page_thumbnail_candidate');
  assert(imageCandidate,'The actual page parser must discover the held image and exercise its guarded probe');
  assert.deepEqual(imageCandidate.imageProbe,{ok:false,reason:'source_access_hold'});
  assert.equal(imageCandidate.eligibleForProduction,false,'A source hold never approves an image');
  assert.equal(blockedImageOutput.counts.restaurantsWithApprovedThumbnail,0);
  checked('actual thumbnail producer blocks exact403 page/image requests, retains existing candidates unchanged, and never approves held media');

  const workflowPath = '.github/workflows/content-quality-audit.yml';
  const workflow = await readFile(new URL('../' + workflowPath, import.meta.url), 'utf8');
  const expectedPrJob = "  validate-pr:\n    if: ${{ github.event_name == 'pull_request' }}\n    runs-on: ubuntu-24.04\n    timeout-minutes: 10\n    steps:\n      - name: Checkout exact PR head\n        uses: actions/checkout@v6\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - name: Set up Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - name: Validate link access policy without source requests\n        env:\n          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n        run: |\n          node scripts/test-link-audit-freshness.mjs\n          node scripts/test-link-access-holds.mjs\n\n";
  const diagnosticStep = "      - name: Preserve access-hold diagnostics\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: source-link-access-diagnostics\n          path: |\n            artifacts/source-link-health-report.json\n            artifacts/source-access-diagnostics.jsonl\n          if-no-files-found: ignore\n          retention-days: 30\n";
  const auditGuard = "    if: ${{ github.event_name != 'pull_request' }}\n";
  const textDigest = text => createHash('sha256').update(text).digest('hex');
  function validateContentWorkflow(source) {
    const parts = source.split('jobs:\n');
    assert.equal(parts.length, 2, 'Exactly one jobs mapping is allowed');
    assert.equal(textDigest(parts[0]), 'a4fe449ebd2f93e455dc716c03dc9925f1dbd4210912958c605db6b841f11bb8', 'PR filters, schedule, workflow keys, or read-only permissions changed');
    const jobs = parts[1];
    assert(jobs.startsWith(expectedPrJob + '  audit:\n'), 'PR job must use exact head, network-denying NODE_OPTIONS, and only the two offline tests');
    let audit = jobs.slice(expectedPrJob.length);
    assert(audit.startsWith('  audit:\n' + auditGuard), 'The live audit must exclude pull requests');
    audit = audit.replace('  audit:\n' + auditGuard, '  audit:\n');
    assert.equal(audit.split(diagnosticStep).length, 2, 'Exactly one unchanged diagnostic upload belongs only to the live audit');
    audit = audit.replace(diagnosticStep, '');
    assert.equal(textDigest(audit), '1afb6f3a24dbf901d1f30e84613ccd7fa53fd9a8b16135e559bfde06b40910a3', 'Scheduled/manual collector commands, bounds, env, permissions, or job scope changed from the accepted baseline');
  }
  validateContentWorkflow(workflow);
  const workflowMutations = [
    ['PR condition removed', s => s.replace("    if: ${{ github.event_name == 'pull_request' }}\n", '')],
    ['PR condition broadened', s => s.replace("github.event_name == 'pull_request'", "github.event_name != 'schedule'")],
    ['live PR exclusion removed', s => s.replace(auditGuard, '')],
    ['live PR exclusion broadened', s => s.replace("github.event_name != 'pull_request'", 'always()')],
    ['PR checkout main', s => s.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: main')],
    ['PR checkout merge ref', s => s.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.sha }}')],
    ['denial import removed', s => s.replace('          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n', '')],
    ['denial import replaced', s => s.replace('NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs', 'NODE_OPTIONS: --no-warnings')],
    ['extra node flag', s => s.replace('node scripts/test-link-access-holds.mjs', 'node --import ./unreviewed.mjs scripts/test-link-access-holds.mjs')],
    ['node eval collector', s => s.replace('node scripts/test-link-access-holds.mjs', 'node --eval "import(\'./scripts/check-source-links.mjs\')"')],
    ['collector replaces offline test', s => s.replace('node scripts/test-link-access-holds.mjs', 'node scripts/check-source-links.mjs')],
    ['collector appended to offline test', s => s.replace('node scripts/test-link-access-holds.mjs', 'node scripts/test-link-access-holds.mjs; node scripts/check-source-links.mjs')],
    ['collector in third run line', s => s.replace('node scripts/test-link-access-holds.mjs', 'node scripts/test-link-access-holds.mjs\n          node scripts/check-source-links.mjs')],
    ['env command suppression', s => s.replace('node scripts/test-link-access-holds.mjs', 'env -u NODE_OPTIONS node scripts/test-link-access-holds.mjs')],
    ['inline env suppression', s => s.replace('node scripts/test-link-access-holds.mjs', "NODE_OPTIONS='' node scripts/test-link-access-holds.mjs")],
    ['extra PR upload', s => s.replace('\n  audit:\n', '\n      - uses: actions/upload-artifact@v4\n\n  audit:\n')],
    ['extra PR step', s => s.replace('\n  audit:\n', '\n      - run: node scripts/check-source-links.mjs\n\n  audit:\n')],
    ['extra live job', s => s + '  unexpected-live-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/check-source-links.mjs\n'],
    ['write permission', s => s.replace('  contents: read', '  contents: write')],
    ['new job permission', s => s.replace('  validate-pr:\n', '  validate-pr:\n    permissions: write-all\n')],
    ['environment overlay', s => s.replace('  validate-pr:\n', '  validate-pr:\n    env:\n      NODE_OPTIONS: ""\n')],
    ['live timeout changed', s => s.replace('LINK_HEALTH_TIMEOUT_MS: 4000', 'LINK_HEALTH_TIMEOUT_MS: 8000')],
    ['live concurrency changed', s => s.replace('LINK_HEALTH_CONCURRENCY: 16', 'LINK_HEALTH_CONCURRENCY: 20')],
    ['live limit changed', s => s.replace('LINK_HEALTH_LIMIT: 0', 'LINK_HEALTH_LIMIT: 200')],
    ['live scope changed', s => s.replace('LINK_HEALTH_SCOPE: release', 'LINK_HEALTH_SCOPE: all')],
    ['scheduled command changed', s => s.replace('run: node scripts/export-catalog.mjs', 'run: node scripts/check-source-links.mjs')],
    ['diagnostic upload broadened', s => s.replace('            artifacts/source-access-diagnostics.jsonl', '            data/**')],
    ['late diagnostic upload removed', s => s.replace('            artifacts/source-access-diagnostics.jsonl\n', '')],
    ['mandatory source registry PR filter removed', s => s.replace('      - scripts/lib/source-access-state.mjs\n', '')],
    ['schedule changed', s => s.replace('17 12 * * 3', '17 * * * *')]
  ];
  for (const [label, mutate] of workflowMutations) {
    const changed = mutate(workflow);
    assert.notEqual(changed, workflow, 'Mutation must exercise its target: ' + label);
    assert.throws(() => validateContentWorkflow(changed), undefined, 'Reject workflow boundary change: ' + label);
  }
  checked('exact offline PR boundary and frozen scheduled/manual audit reject ' + workflowMutations.length + ' adversarial workflow mutations');

  // The bounded patch scope is checked against every repository workflow's PR
  // path filter. This is a declared review matrix, not git-diff-dependent state.
  const changedScope = [
    ".github/workflows/content-quality-audit.yml",
    ".github/workflows/quality-gate.yml",
    ".github/workflows/social-source-preview.yml",
    ".github/workflows/source-expansion-preview.yml",
    "data/source-link-access-holds.json",
    "docs/release-validation.md",
    "scripts/build-content-quality-report.mjs",
    "scripts/check-release-link-health.mjs",
    "scripts/check-report-deployment-parity.mjs",
    "scripts/check-restaurant-lifecycle.mjs",
    "scripts/check-source-links.mjs",
    "scripts/import-official-sites.mjs",
    "scripts/import-structured-place-facts.mjs",
    "scripts/lib/fetch-public-source.mjs",
    "scripts/lib/link-access-policy.mjs",
    "scripts/lib/link-health-report.mjs",
    "scripts/lib/link-health-urls.mjs",
    "scripts/lib/robots-policy.mjs",
    "scripts/lib/source-access-state.mjs",
    "scripts/lib/update-consistency.mjs",
    "scripts/lib/validate-link-health.mjs",
    "scripts/test-first-party-feed-safety.mjs",
    "scripts/test-lifecycle-language.mjs",
    "scripts/test-link-access-holds.mjs",
    "scripts/test-link-access-policy-provenance.mjs",
    "scripts/test-link-audit-freshness.mjs",
    "scripts/test-place-facts-history.mjs",
    "scripts/test-public-source-fetch.mjs",
    "scripts/test-public-special-refresh-safety.mjs",
    "scripts/test-public-special-robots.mjs",
    "scripts/test-reviewed-fact-batch.mjs",
    "scripts/test-robots-policy-adapters.mjs",
    "scripts/test-robots-policy.mjs",
    "scripts/test-robots-redirect-guards.mjs",
    "scripts/test-scheduled-source-guards.mjs",
    "scripts/test-source-verifier-startup.mjs",
    "scripts/test-thumbnail-observation-clocks.mjs",
    "scripts/test-update-consistency.mjs"
  ];
  const workflowNames = (await readdir(new URL('../.github/workflows/', import.meta.url))).filter(name => name.endsWith('.yml')).sort();
  assert.equal(workflowNames.length, 13, 'Review new workflow filters before expanding this change scope');
  const workflows = Object.fromEntries(await Promise.all(workflowNames.map(async name => [name,await readFile(new URL('../.github/workflows/' + name, import.meta.url),'utf8')])));
  function prPaths(source) {
    const start = source.indexOf('  pull_request:\n');
    if (start < 0) return null;
    const remainder = source.slice(start + '  pull_request:\n'.length);
    const end = remainder.search(/^(?:  [^ ]|[^ ])/m);
    const block = end < 0 ? remainder : remainder.slice(0,end);
    const pathsStart = block.indexOf('    paths:\n');
    if (pathsStart < 0) return ['**'];
    const pathBlock = block.slice(pathsStart + '    paths:\n'.length);
    return [...pathBlock.matchAll(/^      - (.+)$/gm)].map(match => match[1].trim());
  }
  const matchesPath = (pattern, path) => (pattern === '**' || pattern.endsWith('/**')) ? (pattern === '**' || path.startsWith(pattern.slice(0,-2))) : pattern === path;
  function changedScopeMatrix(sources) {
    return Object.entries(sources).map(([workflow,source]) => {
      const paths = prPaths(source);
      return {workflow, pullRequest:paths !== null, matched:paths ? changedScope.filter(path => paths.some(pattern => matchesPath(pattern,path))) : []};
    });
  }
  function validateRestaurantOfflineBoundary(source) {
    // Frozen complete offline envelope: broad fixture paths may now intersect
    // the historical access-hold scope, but must never restore its legacy PR
    // collector. Pin every key/step as well as the unchanged producer bytes.
    assert.equal(textDigest(source), '7f884c1787f2b2e6f6c3f6d88bbb56f4abafaa976994022679b34c453f3083ff',
      'Restaurant must retain its exact offline PR envelope and unchanged scheduled/manual producer');
    assert.equal(source.split('jobs:\n').length, 2);
    const jobs = source.split('jobs:\n')[1];
    assert(jobs.startsWith("  validate-pr:\n    if: ${{ github.event_name == 'pull_request' }}\n"));
    assert.equal(jobs.split('  discover:\n').length, 2);
    const [validator, producer] = jobs.split('  discover:\n');
    assert(validator.includes('ref: ${{ github.event.pull_request.head.sha }}'));
    assert(validator.includes('NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs'));
    assert(validator.includes('node scripts/test-restaurant-discovery-offline.mjs'));
    assert(!validator.includes('upload-artifact'));
    assert(producer.startsWith("    if: ${{ github.event_name != 'pull_request' }}\n"));
  }
  function validateChangedScope(sources) {
    const matrix = changedScopeMatrix(sources);
    assert.deepEqual(matrix.filter(row => row.matched.length).map(row => row.workflow), [
      'city-events-preview.yml', 'content-quality-audit.yml', 'quality-gate.yml', 'restaurant-discovery-preview.yml',
      'social-source-preview.yml', 'source-expansion-preview.yml', 'structured-place-facts-preview.yml', 'structured-specials-preview.yml'
    ], 'Historical changed-scope matrix must select only the eight protected validations');
    assert(matrix.find(row => row.workflow === 'restaurant-discovery-preview.yml').matched.length > 0);
    validateRestaurantOfflineBoundary(sources['restaurant-discovery-preview.yml']);
    return matrix;
  }
  const scopeMatrix = validateChangedScope(workflows);
  for (const path of ['scripts/check-source-links.mjs','data/**']) {
    const altered = {...workflows, 'restaurant-discovery-preview.yml':workflows['restaurant-discovery-preview.yml'].replace('    paths:\n','    paths:\n      - ' + path + '\n')};
    assert.throws(() => validateChangedScope(altered), undefined, 'Reject changes to Restaurant protected PR filters: ' + path);
  }
  const restaurantBoundaryMutations = [
    ['PR condition removed', s => s.replace("    if: ${{ github.event_name == 'pull_request' }}\n", '')],
    ['PR condition broadened', s => s.replace("github.event_name == 'pull_request'", 'always()')],
    ['producer exclusion removed', s => s.replace("    if: ${{ github.event_name != 'pull_request' }}\n", '')],
    ['producer exclusion reversed', s => s.replace("github.event_name != 'pull_request'", "github.event_name == 'pull_request'")],
    ['wrong head', s => s.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: main')],
    ['network denial removed', s => s.replace('          NODE_OPTIONS: --import ${{ github.workspace }}/scripts/lib/deny-source-network.mjs\n', '')],
    ['network denial bypassed', s => s.replace('node scripts/test-restaurant-discovery-offline.mjs', 'env -u NODE_OPTIONS node scripts/test-restaurant-discovery-offline.mjs')],
    ['collector replaces fixture', s => s.replace('node scripts/test-restaurant-discovery-offline.mjs', 'node scripts/import-directory-restaurants.mjs')],
    ['collector appended', s => s.replace('node scripts/test-restaurant-discovery-offline.mjs', 'node scripts/test-restaurant-discovery-offline.mjs; node scripts/import-opening-watch.mjs')],
    ['extra PR upload', s => s.replace('  discover:\n', '      - uses: actions/upload-artifact@v4\n\n  discover:\n')],
    ['duplicate PR job', s => s.replace('  discover:\n', '  validate-pr:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/import-opening-watch.mjs\n\n  discover:\n')],
    ['new live job', s => s + '  unexpected-live-job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/import-opening-watch.mjs\n'],
    ['new push trigger', s => s.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n')],
    ['write permissions', s => s.replace('  contents: read', '  contents: write')]
  ];
  for (const [label, mutate] of restaurantBoundaryMutations) {
    const changed = mutate(workflows['restaurant-discovery-preview.yml']);
    assert.notEqual(changed, workflows['restaurant-discovery-preview.yml'], 'Mutation must exercise its target: ' + label);
    assert.throws(() => validateChangedScope({...workflows, 'restaurant-discovery-preview.yml':changed}), undefined,
      'Reject Restaurant collector activation or unsafe PR envelope: ' + label);
  }
  console.log('Changed-scope PR matrix: ' + scopeMatrix.map(row => row.workflow + '=' + (row.matched.length ? 'triggered' : row.pullRequest ? 'not-matched' : 'no-PR-trigger')).join(', '));
  checked('all 13 workflow PR filters reviewed; eight protected validations selected; Restaurant PR collector remains excluded and ' + (restaurantBoundaryMutations.length + 2) + ' boundary mutations rejected');

  // This standalone fixture owns its own temporary tree. Execute its real
  // sibling entrypoint with an explicit transport denial, not sandbox copies.
  const provenanceTest = spawnSync(process.execPath,[
    '--import',fileURLToPath(new URL('./lib/deny-source-network.mjs',import.meta.url)),
    fileURLToPath(new URL('./test-link-access-policy-provenance.mjs',import.meta.url))
  ],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NODE_OPTIONS:''},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  assert.equal(provenanceTest.status,0,'Reviewed workflow-log policy provenance fixture failed: '+provenanceTest.stdout+provenanceTest.stderr+(provenanceTest.error || ''));
  checked('standalone reviewed workflow-log policy provenance regression passes under explicit network denial');

  console.log('Link access-hold regression passed: ' + cases + ' groups; actual production entrypoints, finite mocked transport, no live network.');
} finally {
  await rm(root, {recursive:true, force:true});
}
