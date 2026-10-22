import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The first 22 cases retain the October 22 audit's actual-collector fixtures,
// but invert each unsafe allowed result. Nothing reaches a real transport.
const cases = [
  { name: 'empty rules', body: 'User-agent: *\nDisallow:', allowed: true },
  { name: 'plain deny control', body: 'User-agent: *\nDisallow: /menu' },
  { name: 'HTTP 401 deny control', status: 401 },
  { name: 'HTTP 403 deny control', status: 403 },
  { name: 'HTTP 404 absent policy', status: 404, allowed: true },
  { name: 'HTTP 429', status: 429 },
  { name: 'HTTP 500', status: 500 },
  { name: 'HTTP 503', status: 503 },
  { name: 'network failure', throws: 'TypeError' },
  { name: 'timeout', throws: 'TimeoutError' },
  { name: 'body read failure', throwsBody: true },
  { name: 'quarantined robots redirect', status: 302, location: 'https://glitterbeancafe.com./robots.txt' },
  { name: 'cross-host robots redirect', status: 302, location: 'https://other-fixture.example/robots.txt' },
  { name: 'missing redirect location', status: 302 },
  { name: 'query exact deny', body: 'User-agent: *\nDisallow: /menu?format=json', path: '/menu?format=json' },
  { name: 'wildcard query deny', body: 'User-agent: *\nDisallow: /*?format=json', path: '/menu?format=json' },
  { name: 'wildcard path deny', body: 'User-agent: *\nDisallow: /private/*', path: '/private/menu' },
  { name: 'end anchor deny', body: 'User-agent: *\nDisallow: /menu$' },
  { name: 'multiple bot groups', body: 'User-agent: HalifaxSourced\nDisallow: /unrelated\nUser-agent: HalifaxSourced\nDisallow: /menu' },
  { name: 'multiple wildcard groups', body: 'User-agent: *\nDisallow: /unrelated\nUser-agent: *\nDisallow: /menu' },
  { name: 'unrelated suffixed bot overrides wildcard', body: 'User-agent: NotHalifaxSourced\nDisallow: /unrelated\nUser-agent: *\nDisallow: /menu' },
  { name: 'Allow does not reopen a denial', body: 'User-agent: *\nDisallow: /\nAllow: /menu' },
  { name: 'HTTP 410 absent policy', status: 410, allowed: true },
  { name: 'valid empty 200 policy', body: '', allowed: true },
  { name: 'comment-only policy', body: '# valid empty policy\n # comment', allowed: true },
  { name: 'Sitemap-only policy', body: 'Sitemap: https://fixture.example/sitemap.xml', allowed: true },
  { name: 'HTML challenge response', contentType: 'text/html', body: '<!doctype html><html><title>Just a moment...</title><body>Verify you are human</body></html>' },
  { name: 'HTML disguised as plain text', contentType: 'text/plain', body: '<html>Verify you are human</html>' },
  { name: 'XML error response', contentType: 'application/xml', body: '<error>Unavailable</error>' },
  { name: 'JSON error response', contentType: 'application/json', body: '{"error":"Unavailable"}' },
  { name: 'plain text error response', body: 'Service temporarily unavailable' },
  { name: 'error directive response', body: 'Error: Temporarily unavailable' },
  { name: 'unknown extension-only response', body: 'Unknown: extension only' },
  { name: 'prose in Disallow', body: 'User-agent: *\nDisallow: Service temporarily unavailable' },
  { name: 'absolute URL in Disallow', body: 'User-agent: *\nDisallow: https://fixture.example/menu' },
  { name: 'malformed Allow', body: 'User-agent: *\nAllow: malformed policy' },
  { name: 'binary control in policy', body: 'User-agent: *\n\u0000' },
  { name: 'unsupported media type', contentType: 'application/octet-stream', body: 'User-agent: *\nDisallow:' },
  { name: 'HTTP 204 unknown success', status: 204 },
  { name: 'HTTP 206 incomplete policy', status: 206 },
  { name: 'HTTP 400 unknown failure', status: 400 },
  { name: 'HTTP 304 unknown redirect', status: 304 },
  { name: 'invalid redirect location', status: 302, location: 'http://[' },
  { name: 'robots redirect loop', status: 302, location: '/robots.txt', robotsRequests: 4 },
  { name: 'same-host policy redirect deny', policyRedirect: true, body: 'User-agent: *\nDisallow: /menu' },
  { name: 'same-host policy redirect allows', policyRedirect: true, body: 'User-agent: *\nDisallow: /private', allowed: true },
  { name: 'fetch stalls until deadline', stallsFetch: true },
  { name: 'body stalls until deadline', stallsBody: true },
  { name: 'case-insensitive exact token', body: 'User-agent: hAlIfAxSoUrCeD\nDisallow: /menu' },
  { name: 'legacy literal dollar remains denied', body: 'User-agent: *\nDisallow: /menu$', path: '/menu$legacy' },
  { name: 'legacy unrelated bot denial preserved', body: 'User-agent: NotHalifaxSourced\nDisallow: /menu\nUser-agent: *\nDisallow: /unrelated' },
  { name: 'encoded unreserved rule', body: 'User-agent: *\nDisallow: /%6denu' },
  { name: 'encoded unreserved path', body: 'User-agent: *\nDisallow: /menu', path: '/%6Denu' },
  { name: 'Unicode rule and path', body: 'User-agent: *\nDisallow: /餐厅', path: '/餐厅' },
  { name: 'wildcard does not override exact bot', body: 'User-agent: HalifaxSourced\nDisallow: /private\nUser-agent: *\nDisallow: /', allowed: true },
  { name: 'regex literals remain literal', body: 'User-agent: *\nDisallow: /m.nu', allowed: true },
  { name: 'anchor does not block longer path', body: 'User-agent: *\nDisallow: /menu$', path: '/menu/child', allowed: true },
  { name: 'same-host page redirect obeys robots', body: 'User-agent: *\nDisallow: /blocked', pageRedirect: '/blocked', requestedPage: true },
  { name: 'failure cache is not retried', status: 503, repeat: true },
  { name: 'valid cache is reused', body: '', allowed: true, repeat: true }
];
const adapters = [
  ['import-official-sites.mjs', 'official-site-signals'],
  ['verify-official-source-pages.mjs', 'verified-source-pages'],
  ['import-structured-events.mjs', 'structured-events']
];
const root = await mkdtemp(join(tmpdir(), 'halifax-robots-policy-adapters-'));
try {
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  for (const file of [
    ...adapters.map(([script]) => 'scripts/' + script),
    'scripts/lib/robots-policy.mjs', 'scripts/lib/fetch-public-source.mjs',
    'scripts/lib/lifecycle-language.mjs', 'scripts/lib/source-page-classification.mjs', 'source-integrity.js'
  ]) await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  for (const [script, outputName] of adapters) for (const test of cases) {
    const pageUrl = new URL(test.path || '/menu', 'https://fixture.example').href;
    const pages = test.repeat ? [pageUrl, pageUrl + '-second'] : [pageUrl];
    const venues = pages.map((website, index) => ({ id: 'fixture-' + index, name: 'Fixture Local ' + index, website }));
    await writeFile(join(root, 'data/build/catalog.json'), JSON.stringify({ restaurants: venues }));
    await writeFile(join(root, 'data/restaurants.js'), `window.HALIFAX_RESTAURANTS = ${JSON.stringify(venues)};`);
    await writeFile(join(root, 'data/osm-restaurants.js'), 'window.HALIFAX_OSM_RESTAURANTS = [];');
    await writeFile(join(root, 'data/build/official-site-signals.json'), JSON.stringify({ results: venues.map(venue => ({
      restaurantId: venue.id, name: venue.name, website: venue.website, signalMatches: { events: ['event'] },
      candidateLinks: [{ href: venue.website, text: 'Menu', signalMatches: { menu: ['menu'] } }]
    })) }));
    await writeFile(join(root, 'data/build/verified-source-pages.json'), JSON.stringify({ menuSources: [], specialSources: [] }));
    const requestLog = join(root, 'requests.json');
    await writeFile(join(root, 'runner.mjs'), `
      import { writeFile } from 'node:fs/promises';
      const test = ${JSON.stringify(test)};
      const pages = ${JSON.stringify(pages)};
      const requests = [];
      globalThis.fetch = async (input, options) => {
        const url = String(input); requests.push(url);
        if (url === 'https://fixture.example/robots.txt' || url === 'https://fixture.example/policy') {
          if (test.policyRedirect && url.endsWith('/robots.txt')) return new Response(null, {status: 302, headers: {location: '/policy'}});
          if (test.throws) throw test.throws === 'TimeoutError' ? new DOMException('fixture timeout', 'TimeoutError') : new TypeError('fixture network failure');
          if (test.stallsFetch) return new Promise(() => {});
          if (test.throwsBody || test.stallsBody) return {status: 200, text: async () => { if (test.throwsBody) throw new TypeError('fixture body failure'); return new Promise(() => {}); }};
          return new Response([204, 302, 304].includes(test.status) ? null : (test.body ?? ''), {status: test.status ?? 200, headers: {...(test.location ? {location: test.location} : {}), ...(test.contentType ? {'content-type': test.contentType} : {})}});
        }
        if (pages.includes(url)) {
          if (test.pageRedirect) return new Response(null, {status: 302, headers: {location: test.pageRedirect}});
          return new Response('<html><body>Menu specials</body></html>', {headers: {'content-type': 'text/html'}});
        }
        throw new Error('NO NETWORK: unexpected fixture target ' + url);
      };
      try { await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', script)).href)}); }
      finally { await writeFile(${JSON.stringify(requestLog)}, JSON.stringify(requests)); }
    `);
    const result = spawnSync(process.execPath, [join(root, 'runner.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, OFFICIAL_SITE_DELAY_MS: '0', OFFICIAL_SITE_CONCURRENCY: '2', OFFICIAL_SITE_TIMEOUT_MS: '35',
        SOURCE_VERIFY_DELAY_MS: '0', SOURCE_VERIFY_TIMEOUT_MS: '35', STRUCTURED_EVENT_DELAY_MS: '0', STRUCTURED_EVENT_ROBOTS_TIMEOUT_MS: '35' }
    });
    const label = `${script}: ${test.name}`;
    assert.equal(result.status, 0, label + '\n' + result.stderr + '\n' + (result.error || ''));
    const requests = JSON.parse(await readFile(requestLog, 'utf8'));
    const expected = Array(test.robotsRequests || 1).fill('https://fixture.example/robots.txt');
    if (test.policyRedirect) expected.push('https://fixture.example/policy');
    if (test.allowed || test.requestedPage) expected.push(...pages);
    assert.deepEqual(requests, expected, label + ': requests');
    const output = JSON.parse(await readFile(join(root, 'data/build', outputName + '.json'), 'utf8'));
    if (script === 'import-official-sites.mjs') {
      assert.equal(output.results.length, pages.length, label);
      for (const row of output.results) {
        if (test.allowed) { assert.equal(row.status, 200, label); assert.equal(row.reviewState, 'cross-check', label); assert(!row.error, label); }
        else { assert.equal(row.error, 'robots_disallow', label); assert(!row.status, label + ': no successful receipt'); if (!test.requestedPage) assert.equal(row.reviewState, 'restricted', label); }
      }
    } else {
      assert.equal(output.scannedPages, test.allowed ? pages.length : 0, label);
      assert.equal(output.failures.length, test.allowed ? 0 : pages.length, label);
      for (const failure of output.failures) assert.equal(failure.reason, 'robots_disallow', label);
      if (!test.allowed) {
        if (script.startsWith('verify-')) {
          assert.deepEqual(output.menuSources, [], label);
          assert.deepEqual(output.specialSources, [], label);
          assert.deepEqual(output.candidateSources, [], label);
        } else assert.deepEqual(output.events, [], label);
      }
    }
  }
  console.log(`Robots adapter regressions passed offline: ${cases.length} fixtures × ${adapters.length} actual entrypoints, including all 22 audit cases, deadlines, caches, redirects and positive controls.`);
} finally { await rm(root, { recursive: true, force: true }); }
