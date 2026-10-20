import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = await mkdtemp(join(tmpdir(), 'halifax-facts-history-'));
try {
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  for (const file of ['scripts/import-structured-place-facts.mjs', 'scripts/check-structured-place-facts.mjs', 'scripts/lib/local-restaurant-policy.mjs', 'scripts/lib/fetch-public-source.mjs', 'source-integrity.js']) {
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  // The helper is absent before the repair; exercise the actual old importer too.
  await copyFile(new URL('./lib/place-facts-history.mjs', import.meta.url), join(root, 'scripts/lib/place-facts-history.mjs')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const oldDate = '2026-09-01T12:00:00.000Z';
  const ids = ['failed', 'restricted', 'robots', 'empty', 'changed', 'limited', 'no-source', 'retired', 'excluded'];
  const prior = ids.map(id => ({ restaurantId: id, name: id, sourceUrl: `https://${id}.example/`, observedAt: oldDate, lastVerifiedAt: oldDate, sourceKind: 'official_website_structured_facts', reviewState: 'verified_source', phone: '902-555-0100', hours: null, email: null, address: null, features: [], menus: [], reservations: [], ordering: [] }));
  const save = (name, data) => writeFile(join(root, 'data/build', name + '.json'), JSON.stringify(data));
  await save('catalog', { restaurants: ids.filter(id => id !== 'excluded').map(id => ({ id, name: id, operatingStatus: id === 'retired' ? 'permanently_closed' : 'active' })) });
  await save('first-party-sources', { records: ids.filter(id => id !== 'no-source').map(id => ({ restaurantId: id, website: `https://${id}.example/` })) });
  await save('structured-place-facts', { records: prior, failures: [{ restaurantId: 'restricted', sourceUrl: 'https://restricted.example/', reason: 'http_403' }] });
  await writeFile(join(root, 'runner.mjs'), `
    import {writeFile} from 'node:fs/promises';
    const requests=[];
    globalThis.fetch=async input=>{
      const url=String(input);requests.push(url);
      if(url.includes('restricted.example')||url.includes('retired.example')||url.includes('excluded.example'))throw Error('Forbidden attempt:'+url);
      if(url.endsWith('/robots.txt'))return new Response(url.includes('robots.example')?'User-agent: *\\nDisallow: /':'User-agent: *\\nDisallow:');
      if(url.includes('failed.example'))throw new DOMException('Offline timeout','TimeoutError');
      if(url.includes('empty.example'))return new Response('<html>No parsable facts</html>',{headers:{'content-type':'text/html'}});
      if(url.includes('changed.example'))return new Response('<a href="tel:902-555-0200">Phone</a>',{headers:{'content-type':'text/html'}});
      throw Error('Unexpected request:'+url);
    };
    try{await import('./scripts/import-structured-place-facts.mjs');}
    finally{await writeFile('requests.json',JSON.stringify(requests));}
  `);
  const run = (limit = '5') => {
    const result = spawnSync(process.execPath, [join(root, 'runner.mjs')], { cwd: root, env: { ...process.env, STRUCTURED_PLACE_FACT_LIMIT: limit, STRUCTURED_PLACE_FACT_DELAY_MS: '0', STRUCTURED_PLACE_FACT_CONCURRENCY: '1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  run();
  const payload = JSON.parse(await readFile(join(root, 'data/build/structured-place-facts.json')));
  const records = new Map(payload.records.map(record => [record.restaurantId, record]));
  for (const id of ['failed', 'restricted', 'robots', 'empty', 'limited', 'no-source']) {
    assert.deepEqual(records.get(id), prior.find(record => record.restaurantId === id), 'Must retain exact accepted evidence without freshening: ' + id);
  }
  assert.equal(records.get('changed').phone, '902-555-0200');
  assert(!records.has('retired') && !records.has('excluded'), 'History must not revive inactive/noncanonical recommendations');
  assert.equal(payload.counts.records, 7);
  assert.equal(payload.refreshCounts.changed, 1);
  assert.equal(payload.refreshCounts.failed, 1);
  assert.equal(payload.refreshCounts.blocked, 2);
  assert.equal(payload.refreshCounts.inconclusive, 1);
  assert.equal(payload.refreshCounts.not_attempted, 2);
  assert.equal(payload.retainedRecords, 6);
  for (const id of ['retired', 'excluded', 'changed']) assert(payload.sourceHistory.some(entry => entry.record.restaurantId === id && entry.record.lastVerifiedAt === oldDate), 'Prior evidence remains auditable: ' + id);
  const requests = JSON.parse(await readFile(join(root, 'requests.json')));
  assert(!requests.some(url => /restricted|retired|excluded|limited/.test(url)), 'Known access restrictions, inactive/excluded sources and bounded targets are never requested');
  for (const observation of payload.refreshObservations) assert(Number.isFinite(Date.parse(observation.checkedAt)));
  const context = { window: {} }; vm.runInNewContext(await readFile(join(root, 'data/structured-place-facts.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.window.HALIFAX_STRUCTURED_PLACE_FACTS), JSON.stringify(payload), 'Browser and JSON payloads must match');
  // Repeated failure/unchanged data must not grow history or refresh old evidence.
  run();
  const second = JSON.parse(await readFile(join(root, 'data/build/structured-place-facts.json')));
  assert.equal(second.sourceHistory.length, payload.sourceHistory.length);
  assert.equal(second.refreshCounts.unchanged, 1);
  assert.deepEqual(second.records.find(record => record.restaurantId === 'failed'), prior[0]);
  assert(second.accessRestrictions.some(item => item.sourceUrl === 'https://restricted.example/'), 'Known restriction survives future bounded refreshes');
  const check = () => spawnSync(process.execPath, [join(root, 'scripts/check-structured-place-facts.mjs')], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(check().status, 0, 'Real validator accepts honest receipt');
  await save('structured-place-facts', { ...second, counts: { ...second.counts, records: 999 } });
  assert.equal(check().status, 1, 'Real validator rejects fabricated totals');
  await save('structured-place-facts', second);
  run('0');
  const bounded = JSON.parse(await readFile(join(root, 'data/build/structured-place-facts.json')));
  assert.deepEqual(bounded.records, second.records, 'Zero-target run retains accepted records without freshening');
  assert.equal(bounded.refreshCounts.not_attempted, 7);
  assert.equal(bounded.accessRestrictions.length, second.accessRestrictions.length);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'requests.json'))), [], 'Zero-target run makes zero requests');
  console.log('Place-facts history regression passed: failed/restricted/empty/unattempted evidence retained; exclusions archived, changes auditable, timestamps and counts honest.');
} finally { await rm(root, { recursive: true, force: true }); }
