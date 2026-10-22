import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// A real denial or unresolved native request is an intentional nonpublishable
// subprocess result, not a failed fixture. Derive this from the finite plan,
// then independently require its diagnostic rather than accepting any exit1.
function assertAccessExit(result, specs, label, startupExit = 0) {
  const restrictions = specs.filter(spec => [401,403,429].includes(spec?.status));
  const unsettled = specs.some(spec => spec?.stallFetch || spec?.stallsFetch || spec?.lateFetch || spec?.delayFetch);
  const expected = startupExit || (restrictions.length || unsettled ? 1 : 0);
  assert.equal(result.error,undefined,label + ': child must finish within its existing bound');
  assert.equal(result.signal,null,label + ': child must not be killed');
  assert.equal(result.status,expected,label + '\n' + result.stderr);
  const diagnostics = result.stderr.split('\n').filter(line => line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line => JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
  for (const spec of restrictions) assert(diagnostics.some(item => ['http_restriction','late_http_restriction'].includes(item.kind) && item.evidence.receipt.status === spec.status),label + ': actual denial diagnostic');
  if (unsettled) assert(diagnostics.some(item => item.kind === 'unsettled_transport'),label + ': unresolved request diagnostic');
  assert(diagnostics.every(item => item.disposition === 'nonpublishable_requires_review' && (item.kind === 'unsettled_transport' ? unsettled : restrictions.some(spec => item.evidence.receipt?.status === spec.status))),label + ': no unexpected access diagnostic');
}


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
// Complete the helper's semantic/status matrix at the actual entrypoints too.
// These stay independent expectations rather than asking the helper for an oracle.
for (const [name, body, path, allowed] of [
  ['different query remains allowed', 'User-agent: *\nDisallow: /menu?format=json', '/menu?format=html', true],
  ['ordered wildcard deny', 'User-agent: *\nDisallow: /a*b*c$', '/a-b-b-c', false],
  ['anchor suffix remains allowed', 'User-agent: *\nDisallow: /a*b*c$', '/a-b-c-d', true],
  ['wildcard order matters', 'User-agent: *\nDisallow: /a*b*c$', '/a-c-b', true],
  ['consecutive wildcards', 'User-agent: *\nDisallow: /a**b*', '/ab', false],
  ['bounded wildcard matching', 'User-agent: *\nDisallow: /a*' + 'a*'.repeat(80) + 'b$', '/' + 'a'.repeat(1000) + 'c', true],
  ['anchor excludes query', 'User-agent: *\nDisallow: /menu$', '/menu?open=1', true],
  ['regex metacharacters literal', 'User-agent: *\nDisallow: /a.b+(c)[d]{e}^|', '/a.b+(c)[d]{e}^|/menu', false],
  ['encoded tilde', 'User-agent: *\nDisallow: /%7euser', '/~user', false],
  ['UTF8 encoded path', 'User-agent: *\nDisallow: /café', '/caf%C3%A9', false],
  ['UTF8 encoded rule', 'User-agent: *\nDisallow: /caf%c3%a9', '/café', false],
  ['reserved encoding case', 'User-agent: *\nDisallow: /a%2fb', '/a%2Fb', false],
  ['encoded slash not literal slash', 'User-agent: *\nDisallow: /a%2Fb', '/a/b', true],
  ['literal slash not encoded slash', 'User-agent: *\nDisallow: /a/b', '/a%2Fb', true],
  ['encoded wildcard literal', 'User-agent: *\nDisallow: /literal%2A', '/literal%2a', false],
  ['encoded wildcard not glob', 'User-agent: *\nDisallow: /literal%2A', '/literal-anything', true],
  ['encoded dollar literal', 'User-agent: *\nDisallow: /money%24', '/money%24', false],
  ['nonterminal dollar literal', 'User-agent: *\nDisallow: /money$inside', '/money$inside', false],
  ['encoded query unreserved', 'User-agent: *\nDisallow: /menu?x=%7E', '/menu?x=~', false],
  ['encoded query reserved', 'User-agent: *\nDisallow: /menu?x=%2F', '/menu?x=/&tail=1', true],
  ['suffixed bot fallback', 'User-agent: HalifaxSourcedBot\nDisallow: /other\nUser-agent: *\nDisallow: /menu', '/menu', false],
  ['other bot ignored', 'User-agent: Other\nDisallow: /\nUser-agent: *\nDisallow:', '/menu', true],
  ['shared agent group', 'User-agent: Other\nUser-agent: HalifaxSourced\nDisallow: /menu', '/menu', false],
  ['Sitemap group boundary legacy', 'User-agent: HalifaxSourced\nSitemap: https://fixture.example/sitemap.xml\nUser-agent: Other\nDisallow: /menu', '/menu', false],
  ['CR line endings', 'User-agent: *\rDisallow: /menu', '/menu', false],
  ['BOM and inline comment', '\uFEFFUser-agent: *\r\nDisallow: /menu # comment', '/menu', false],
  ['crawl delay directive', 'User-agent: *\nCrawl-delay: 2\nDisallow: /private', '/menu', true],
  ['missing agent directive', 'Disallow: /private', null, false],
  ['oversized policy body', 'User-agent: *\n#' + 'a'.repeat(512 * 1024), null, false]
]) cases.push({ name, body, ...(path ? { path } : {}), allowed });
for (const status of [201, 300, 405, 408, 418, 502, 504, 599]) cases.push({ name: `HTTP ${status}`, status });
cases.push(
  { name: 'patio exact query destination denied', path: '/patios?format=json', body: 'User-agent: *\nDisallow: /patios?format=json' },
  { name: 'patio wildcard query destination denied', path: '/patios?format=json', body: 'User-agent: *\nDisallow: /patios?format=*' },
  { name: 'patio anchored destination denied', path: '/patios/details', body: 'User-agent: *\nDisallow: /patios/details$' },
  { name: 'patio legacy dollar destination denied', path: '/patios/details$legacy', body: 'User-agent: *\nDisallow: /patios/details$' },
  { name: 'patio allowed query destination', path: '/patios?format=html', body: 'User-agent: *\nDisallow: /patios?format=json', allowed: true },
  { name: 'oversized declared body', oversizedLength: true },
  { name: 'cross-host content redirect', body: '', pageRedirect: 'https://other-fixture.example/blocked', requestedPage: true, error: 'quarantined_cross_entity_redirect' },
  { name: 'quarantined content redirect', body: '', pageRedirect: 'https://glitterbeancafe.com./blocked', requestedPage: true, error: 'quarantined_cross_entity_redirect' }
);
const adapters = [
  ['import-official-sites.mjs', 'official-site-signals'],
  ['verify-official-source-pages.mjs', 'verified-source-pages'],
  ['import-structured-events.mjs', 'structured-events'],
  ['import-official-page-intelligence.mjs', 'website-page-intelligence'],
  ['import-patio-directory-facts.mjs', 'patio-directory-facts']
];
// Preserve inherited validation preloads, and enforce fatal real-transport denial
// even when this suite is invoked directly outside the workflow. The preload's
// exit handler catches socket attempts even if a collector swallows the error.
const denialUrl = new URL('./lib/deny-source-network.mjs', import.meta.url).href;
const offlineEnv = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${denialUrl}` };
const root = await mkdtemp(join(tmpdir(), 'halifax-robots-policy-adapters-'));
try {
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  for (const file of [
    ...adapters.map(([script]) => 'scripts/' + script),
    'scripts/lib/robots-policy.mjs', 'scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json',
    'scripts/lib/lifecycle-language.mjs', 'scripts/lib/source-page-classification.mjs', 'source-integrity.js'
  ]) await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  for (const [script, outputName] of adapters) for (const fixture of cases) {
    const patio = script === 'import-patio-directory-facts.mjs';
    const intelligence = script === 'import-official-page-intelligence.mjs';
    // Patio's real entrypoint always starts at this hardcoded URL. Do not rewrite
    // the collector: exercise path/query variants through same-host redirects.
    const origin = patio ? 'https://downtownhalifax.ca' : 'https://fixture.example';
    const test = patio && !fixture.path
      ? { ...fixture, body: fixture.body?.replaceAll('/menu', '/patios').replaceAll('/%6denu', '/%70atios') }
      : fixture;
    const pageUrl = new URL(patio ? '/patios' : (test.path || '/menu'), origin).href;
    const pages = test.repeat && !patio ? [pageUrl, pageUrl + '-second'] : [pageUrl];
    const redirectTarget = patio && test.path ? new URL(test.path, origin).href : null;
    const venues = pages.map((website, index) => ({ id: 'fixture-' + index, name: 'Fixture Local ' + index, website }));
    const sourceMetadata = { id: 'downtown-halifax-patios-2026', enabled: false, label: 'Fixture metadata only' };
    await writeFile(join(root, 'data/place-source-registry.json'), JSON.stringify({ sources: [sourceMetadata] }));
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
      const origin = ${JSON.stringify(origin)};
      const redirectTarget = ${JSON.stringify(redirectTarget)};
      const patio = ${patio};
      const unexpected = [];
      const requests = [];
      globalThis.fetch = async (input, options) => {
        const url = String(input); requests.push(url);
        if (url === origin + '/robots.txt' || url === origin + '/policy') {
          if (test.policyRedirect && url.endsWith('/robots.txt')) return new Response(null, {status: 302, headers: {location: '/policy'}});
          if (test.oversizedLength) return {status: 200, headers: new Headers({'content-length': '999999'}), text: async () => { throw new Error('Oversized body must not be read'); }};
          if (test.throws) throw test.throws === 'TimeoutError' ? new DOMException('fixture timeout', 'TimeoutError') : new TypeError('fixture network failure');
          if (test.stallsFetch) return new Promise(() => {});
          if (test.throwsBody || test.stallsBody) return {status: 200, text: async () => { if (test.throwsBody) throw new TypeError('fixture body failure'); return new Promise(() => {}); }};
          return new Response([204, 302, 304].includes(test.status) ? null : (test.body ?? ''), {status: test.status ?? 200, headers: {...(test.location ? {location: test.location} : {}), ...(test.contentType ? {'content-type': test.contentType} : {})}});
        }
        if (pages.includes(url) || url === redirectTarget) {
          if (redirectTarget && pages.includes(url)) return new Response(null, {status: 302, headers: {location: redirectTarget}});
          if (test.pageRedirect) return new Response(null, {status: 302, headers: {location: test.pageRedirect}});
          return new Response(patio
            ? '<div class="c-info-card"><h4><strong>Fixture Local 0</strong></h4><p>123 Fixture Street</p><div style="background-image:url(/fixture-patio.jpg)"></div></div>'
            : '<html><body>Menu specials</body></html>', {headers: {'content-type': 'text/html'}});
        }
        unexpected.push(url);
        throw new Error('NO NETWORK: unexpected fixture target ' + url);
      };
      try { await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', script)).href)}); }
      finally { await writeFile(${JSON.stringify(requestLog)}, JSON.stringify(requests)); if (unexpected.length) throw new Error('Unexpected fixture URLs: ' + unexpected.join(', ')); }
    `);
    const result = spawnSync(process.execPath, [join(root, 'runner.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...offlineEnv, OFFICIAL_SITE_DELAY_MS: '0', OFFICIAL_SITE_CONCURRENCY: '2', OFFICIAL_SITE_TIMEOUT_MS: '35',
        PAGE_INTELLIGENCE_DELAY_MS: '0', PAGE_INTELLIGENCE_TIMEOUT_MS: '35', PATIO_DIRECTORY_TIMEOUT_MS: '35',
        SOURCE_VERIFY_DELAY_MS: '0', SOURCE_VERIFY_TIMEOUT_MS: '35', STRUCTURED_EVENT_DELAY_MS: '0', STRUCTURED_EVENT_ROBOTS_TIMEOUT_MS: '35' }
    });
    const label = `${script}: ${test.name}`;
    assertAccessExit(result,[test],label);
    const requests = JSON.parse(await readFile(requestLog, 'utf8'));
    const expected = Array(test.robotsRequests || 1).fill(origin + '/robots.txt');
    if (test.policyRedirect) expected.push(origin + '/policy');
    if (test.allowed || test.requestedPage || redirectTarget) expected.push(...pages);
    if (test.allowed && redirectTarget) expected.push(redirectTarget);
    assert.deepEqual(requests, expected, label + ': requests');
    const output = JSON.parse(await readFile(join(root, 'data/build', outputName + '.json'), 'utf8'));
    if (script === 'import-official-sites.mjs') {
      assert.equal(output.results.length, pages.length, label);
      for (const row of output.results) {
        if (test.allowed) { assert.equal(row.status, 200, label); assert.equal(row.reviewState, 'cross-check', label); assert(!row.error, label); }
        else { assert.equal(row.error, test.error || 'robots_disallow', label); assert(!row.status, label + ': no successful receipt'); if (!test.requestedPage) assert.equal(row.reviewState, 'restricted', label); }
      }
    } else if (intelligence || patio) {
      assert.equal(output.records.length, test.allowed ? pages.length : 0, label);
      assert.equal(output.failures.length, test.allowed ? 0 : pages.length, label);
      for (const failure of output.failures) assert.equal(failure.reason, test.error || 'robots_disallow', label);
      if (intelligence) {
        assert.equal(output.pagesChecked, test.allowed ? pages.length : 0, label);
        for (const record of output.records) {
          assert.equal(record.rightsState, 'public_reference_not_media_licence', label);
          assert.equal(record.reviewState, 'needs_date_review', label);
          assert(record.signalMatches.menu.includes('menu'), label);
          assert.equal(record.publishedAt, null, label);
        }
      } else {
        // Registry enablement remains metadata-only in this pre-existing adapter.
        assert.deepEqual(output.source, sourceMetadata, label);
        for (const record of output.records) {
          assert.equal(record.restaurantId, 'fixture-0', label);
          assert.equal(record.reviewState, 'source_signal', label);
          assert.equal(record.rightsState, 'requires_rights_review', label);
          assert.equal(record.sourceImageUrl, origin + '/fixture-patio.jpg', label);
          assert.equal(record.sourceUrl, pageUrl, label);
          assert.equal(record.address, '123 Fixture Street', label);
        }
      }
    } else {
      assert.equal(output.scannedPages, test.allowed ? pages.length : 0, label);
      assert.equal(output.failures.length, test.allowed ? 0 : pages.length, label);
      for (const failure of output.failures) assert.equal(failure.reason, test.error || 'robots_disallow', label);
      if (!test.allowed) {
        if (script.startsWith('verify-')) {
          assert.deepEqual(output.menuSources, [], label);
          assert.deepEqual(output.specialSources, [], label);
          assert.deepEqual(output.candidateSources, [], label);
        } else assert.deepEqual(output.events, [], label);
      }
    }
  }
  const targetedCityCount = await testCityAdapter(root);
  const discoveryCount = await testDiscoveryAdapter(root);
  console.log(`Robots adapter regressions passed offline: ${cases.length} fixtures × ${adapters.length + 1} actual entrypoints, plus ${targetedCityCount} targeted City and ${discoveryCount} discovery/history fixtures, including all 22 audit cases, deadlines, caches, redirects and positive controls.`);
} finally { await rm(root, { recursive: true, force: true }); }

// Public-special combines three independent source families and source-atomic
// history retention. Keep its composite fixtures separate from the unchanged
// generic/City matrix above, and execute each suite once with transport denied.
for (const script of ['test-public-special-robots.mjs', 'test-public-special-refresh-safety.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000, env: offlineEnv
  });
  assert.equal(result.status, 0, script + '\n' + result.stdout + '\n' + result.stderr + '\n' + (result.error || ''));
  process.stdout.write(result.stdout);
}


async function testCityAdapter(parentRoot) {
  // City has its own minimal standalone tree: no catalogs, historical snapshots,
  // entity registries or supplements can accidentally make these fixtures pass.
  const root = join(parentRoot, 'city');
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  for (const file of ['scripts/import-city-events.mjs', 'scripts/lib/robots-policy.mjs',
    'scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json', 'source-integrity.js']) {
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  const origin = 'https://fixture.example';
  const robotsUrl = origin + '/robots.txt';
  const startAt = new Date(Math.floor((Date.now() + 86400000) / 1000) * 1000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 3600000).toISOString();
  const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
  const source = (overrides = {}) => ({ id: 'fixture-city-0', name: 'Fixture City', kind: 'official_calendar',
    mode: 'embedded_event_data', priority: 5, url: origin + '/menu', ...overrides });
  const event = (index = 0, overrides = {}) => ({ '@type': 'Event', '@id': `fixture-event-${index}`,
    name: index ? `Fixture Concert ${index}` : 'Fixture Concert', startDate: startAt, endDate: endAt,
    url: `${origin}/event/fixture-${index}`, location: { name: 'Fixture Hall',
      address: { streetAddress: '123 Fixture Street', addressLocality: 'Halifax' } },
    offers: { price: '10', url: origin + '/tickets' }, ...overrides });
  const html = item => `<script type="application/ld+json">${JSON.stringify(item)}</script>`;
  const expectedEvent = (item, src, pageUrl) => ({
    id: item['@id'] || `${src.id}-${hash(`${new URL(item.url, src.url).href}|${item.name}|${startAt}`)}`,
    title: item.name, startAt, endAt, eventUrl: new URL(item.url, src.url).href, sourceUrl: pageUrl,
    sourceId: src.id, sourceName: src.name, sourceKind: src.kind, venueName: 'Fixture Hall',
    address: '123 Fixture Street, Halifax', city: 'Halifax', ticketUrl: origin + '/tickets', price: '10',
    reviewState: 'source-observed', allDay: false
  });
  async function run({ name, policy = { body: '' }, sources = [source()], routes = {}, requests,
    events = [], rawCounts = sources.map(() => 0), failure = null }) {
    const label = `import-city-events.mjs: ${name}`;
    await writeFile(join(root, 'data/event-source-registry.json'), JSON.stringify({
      scope: { futureDays: 400, pastGraceHours: 6 }, sources
    }));
    await writeFile(join(root, 'runner.mjs'), `
      import { writeFile } from 'node:fs/promises';
      const policy = ${JSON.stringify(policy)};
      const routes = ${JSON.stringify(routes)};
      const requests = [], unexpected = [];
      function response(body, status, headers, url) {
        const result = new Response([204, 302, 304].includes(status) ? null : body, {status, headers});
        Object.defineProperty(result, 'url', {value: url});
        return result;
      }
      globalThis.fetch = async input => {
        const url = String(input); requests.push(url);
        if (url === ${JSON.stringify(robotsUrl)} || (policy.policyRedirect && url === ${JSON.stringify(origin + '/policy')})) {
          if (policy.policyRedirect && url.endsWith('/robots.txt')) return response(null, 302, {location: '/policy'}, url);
          if (policy.oversizedLength) return {status: 200, headers: new Headers({'content-length': '999999'}), text: async () => { throw new Error('Oversized body must not be read'); }};
          if (policy.throws) throw policy.throws === 'TimeoutError' ? new DOMException('fixture timeout', 'TimeoutError') : new TypeError('fixture network failure');
          if (policy.stallsFetch) return new Promise(() => {});
          if (policy.throwsBody || policy.stallsBody) return {status: 200, text: async () => { if (policy.throwsBody) throw new TypeError('fixture body failure'); return new Promise(() => {}); }};
          return response(policy.body ?? '', policy.status ?? 200, {...(policy.location ? {location: policy.location} : {}), ...(policy.contentType ? {'content-type': policy.contentType} : {})}, url);
        }
        if (Object.hasOwn(routes, url)) {
          const route = routes[url];
          return response(route.body ?? '', route.status ?? 200, {'content-type': route.contentType || 'text/html', ...(route.location ? {location: route.location} : {})}, url);
        }
        unexpected.push(url);
        throw new Error('NO NETWORK: unexpected fixture target ' + url);
      };
      try { await import('./scripts/import-city-events.mjs'); }
      finally {
        await writeFile('./requests.json', JSON.stringify(requests));
        if (unexpected.length) throw new Error('Unexpected fixture URLs: ' + unexpected.join(', '));
      }
    `);
    const result = spawnSync(process.execPath, [join(root, 'runner.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 5000, env: { ...offlineEnv, CITY_EVENT_TIMEOUT_MS: '35' }
    });
    assertAccessExit(result,requests.map(url => routes[url] || policy),label);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')), requests, label + ': requests');
    const output = JSON.parse(await readFile(join(root, 'data/build/city-events.json'), 'utf8'));
    const js = await readFile(join(root, 'data/city-events.js'), 'utf8');
    const assignment = js.match(/^window\.HALIFAX_CITY_EVENTS = ([\s\S]*);\s*$/);
    assert(assignment, label + ': JS assignment');
    assert.deepEqual(JSON.parse(assignment[1]), output, label + ': JSON/JS parity');
    assert.equal(output.eventCount, events.length, label);
    assert.equal(output.events.length, events.length, label);
    for (const expected of events) {
      const actual = output.events.find(row => row.id === expected.id);
      assert(actual, label + ': explicit/derived identity ' + expected.id);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, label + ': ' + key);
      assert(!Object.hasOwn(actual, 'sourcePriority'), label + ': private source priority');
    }
    assert.equal(output.failures.length, failure ? sources.length : 0, label);
    assert.equal(output.sourceStats.length, sources.length, label);
    sources.forEach((src, index) => {
      const stats = output.sourceStats[index];
      for (const [key, value] of Object.entries({sourceId: src.id, sourceName: src.name, mode: src.mode,
        status: failure ? 'failed' : 'ok', eventCount: rawCounts[index]})) assert.equal(stats[key], value, label + ': stats ' + key);
      if (failure) {
        assert.equal(stats.reason, failure, label);
        const row = output.failures[index];
        assert.deepEqual({ sourceId: row.sourceId, sourceName: row.sourceName, url: row.url, reason: row.reason },
          { sourceId: src.id, sourceName: src.name, url: src.url, reason: failure }, label);
      } else assert(!Object.hasOwn(stats, 'reason'), label);
    });
    return output;
  }
  for (const test of cases) {
    const pageUrl = new URL(test.path || '/menu', origin).href;
    const pages = test.repeat ? [pageUrl, pageUrl + '-second'] : [pageUrl];
    const sources = pages.map((url, index) => source({id: `fixture-city-${index}`, url}));
    const routes = Object.fromEntries(pages.map((url, index) => [url, test.pageRedirect
      ? {status: 302, location: test.pageRedirect} : {body: html(event(index))}]));
    const requests = Array(test.robotsRequests || 1).fill(robotsUrl);
    if (test.policyRedirect) requests.push(origin + '/policy');
    if (test.allowed || test.requestedPage) requests.push(...pages);
    await run({ name: test.name, policy: test, sources, routes, requests,
      events: test.allowed ? sources.map((src, index) => expectedEvent(event(index), src, pages[index])) : [],
      // Embedded walking sees the JSON-LD too; public dedupe retains one ID.
      rawCounts: sources.map(() => test.allowed ? 2 : 0), failure: test.allowed ? null : test.error || 'robots_disallow' });
  }
  let count = 0;
  const targeted = async fixture => { count++; return run(fixture); };
  const noId = event(0, {'@id': undefined});
  await targeted({name: 'no @id preserves hashed identity', routes: {[source().url]: {body: html(noId)}},
    requests: [robotsUrl, source().url], events: [expectedEvent(noId, source(), source().url)], rawCounts: [2]});
  const tourism = source({mode: 'tourism_event_crawl', url: origin + '/events', maxDetailPages: 1});
  const detail = origin + '/event/fixture';
  const seedHtml = '<a href="/event/fixture">Event</a>';
  await targeted({name: 'tourism seed/detail success', sources: [tourism], routes: {
    [tourism.url]: {body: seedHtml}, [detail]: {body: html(event())}}, requests: [robotsUrl, tourism.url, detail],
    events: [expectedEvent(event(), tourism, detail)], rawCounts: [1]});
  await targeted({name: 'tourism detail denial is intentionally swallowed', policy: {body: 'User-agent: *\nDisallow: /event/fixture'},
    sources: [tourism], routes: {[tourism.url]: {body: seedHtml}}, requests: [robotsUrl, tourism.url]});
  for (const [name, destination, body, failure] of [
    ['path', '/blocked', 'User-agent: *\nDisallow: /blocked', 'robots_disallow'],
    ['query', '/event/fixture?private=1', 'User-agent: *\nDisallow: /event/fixture?private=1', 'robots_disallow'],
    ['literal dollar', '/event/private$legacy', 'User-agent: *\nDisallow: /event/private$', 'robots_disallow'],
    ['cross host', 'https://other-fixture.example/event/fixture', '', 'quarantined_cross_entity_redirect'],
    ['quarantined dotted host', 'https://glitterbeancafe.com./event/fixture', '', 'quarantined_cross_entity_redirect']
  ]) for (const stage of ['seed', 'detail']) {
    const routes = stage === 'seed' ? {[tourism.url]: {status: 302, location: destination}}
      : {[tourism.url]: {body: seedHtml}, [detail]: {status: 302, location: destination}};
    await targeted({name: `tourism ${stage} redirect denied: ${name}`, policy: {body}, sources: [tourism], routes,
      requests: [robotsUrl, tourism.url, ...(stage === 'detail' ? [detail] : [])], failure: stage === 'seed' ? failure : null});
  }
  // A redirected seed's relative link must be based on Response.url, not the
  // original /events URL. The detail's final URL must become sourceUrl too.
  const finalSeed = origin + '/event/landing/';
  const linkedDetail = finalSeed + 'fixture';
  const finalDetail = origin + '/event/final/fixture';
  const relativeEvent = event(0, {url: './canonical-fixture'});
  await targeted({name: 'allowed seed/detail redirects preserve final URLs and relative links', sources: [tourism], routes: {
    [tourism.url]: {status: 302, location: '/event/landing/'}, [finalSeed]: {body: '<a href="fixture">Event</a>'},
    [linkedDetail]: {status: 302, location: '../final/fixture'}, [finalDetail]: {body: html(relativeEvent)}},
    requests: [robotsUrl, tourism.url, finalSeed, linkedDetail, finalDetail],
    // JSON-LD event.url follows the existing source-based canonicalization rule.
    events: [expectedEvent(relativeEvent, tourism, finalDetail)], rawCounts: [1]});
  const tribe = source({id: 'fixture-tribe', name: 'Fixture Tribe', mode: 'tribe_list_crawl',
    url: origin + '/events/list/', icalUrl: origin + '/events/ical/', maxPages: 1});
  for (const policy of [{status: 503}, {throws: 'TypeError'}, {throwsBody: true}]) {
    await targeted({name: `failed robots cached across Tribe fallback: ${JSON.stringify(policy)}`, sources: [tribe], policy,
      requests: [robotsUrl], failure: 'event_list_unavailable'});
  }
  const icsDate = value => value.replace(/[-:]/g, '').replace('.000', '');
  const icsLines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:fixture-uid', 'SUMMARY:Fixture Concert',
    `DTSTART:${icsDate(startAt)}`, `DTEND:${icsDate(endAt)}`, 'LOCATION:Fixture Hall\\, Halifax',
    `URL:${detail}`, 'END:VEVENT', 'END:VCALENDAR'];
  const icsExpected = {...expectedEvent(event(), tribe, detail), id: `${tribe.id}-${hash('fixture-uid')}`,
    eventUrl: detail, venueName: 'Fixture Hall, Halifax', address: 'Fixture Hall, Halifax', price: null, ticketUrl: tribe.url};
  for (const [name, body] of [['normal', icsLines.join('\r\n')],
    ['harmless folding and LF', icsLines.join('\n').replace('SUMMARY:Fixture Concert', 'SUMMARY:Fixture\n  Concert')]]) {
    await targeted({name: `Tribe ICS identity stable: ${name}`, sources: [tribe],
      routes: {[tribe.icalUrl]: {body, contentType: 'text/calendar'}}, requests: [robotsUrl, tribe.icalUrl],
      events: [icsExpected], rawCounts: [1]});
  }
  for (const variant of ['empty ICS', 'HTTP failure ICS', 'path-only ICS denial']) {
    const denied = variant === 'path-only ICS denial';
    await targeted({name: `authorized Tribe fallback: ${variant}`, sources: [tribe],
      policy: {body: denied ? 'User-agent: *\nDisallow: /events/ical/' : ''}, routes: {
        ...(denied ? {} : {[tribe.icalUrl]: {body: '', status: variant === 'HTTP failure ICS' ? 503 : 200}}),
        [tribe.url]: {body: seedHtml}, [detail]: {body: html(event())}},
      requests: [robotsUrl, ...(denied ? [] : [tribe.icalUrl]), tribe.url, detail],
      events: [expectedEvent(event(), tribe, detail)], rawCounts: [1]});
  }
  return count;
}

async function testDiscoveryAdapter(parentRoot) {
  const root = join(parentRoot, 'discovery');
  await mkdir(join(root, 'scripts/lib'), {recursive: true});
  await mkdir(join(root, 'data/build'), {recursive: true});
  for (const file of ['scripts/discover-first-party-sources.mjs', 'scripts/merge-first-party-history.mjs',
    'scripts/sanitize-first-party-sources.mjs', 'scripts/lib/robots-policy.mjs',
    'scripts/lib/fetch-public-source.mjs', 'scripts/lib/source-access-state.mjs', 'scripts/lib/link-access-policy.mjs', 'data/source-link-access-holds.json', 'source-integrity.js', 'data/social-platform-registry.json']) {
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  const origin = 'https://fixture.example';
  const robotsUrl = origin + '/robots.txt';
  const oldAt = new Date(Date.now() - 3 * 86400000).toISOString();
  const oldHash = 'a'.repeat(64);
  const venue = (index = 0, website = origin + '/menu') => ({id: `fixture-${index}`, name: `Fixture ${index}`, website});
  const priorRecord = item => ({restaurantId: item.id, name: item.name, website: item.website, resolvedUrl: item.website,
    observedAt: oldAt, lastVerifiedAt: oldAt, contentHash: oldHash, rightsState: 'public_reference_not_media_licence',
    reviewState: 'needs-review', sourceKind: 'official_website_discovery', scannedOwnedPages: [item.website],
    socialProfiles: [], linkHubs: [], relatedLinks: [], feeds: [], sitemaps: [origin + '/old-map.xml']});
  let count = 0;
  async function run({name, policy = {body: ''}, policies = {}, venues = [venue()], discovered = [], routes = {},
    expectedRequests = [], refreshed = [], failures = [], env = {}, previous = venues.map(priorRecord),
    pipeline = false, expectedExit = 0, settleMs = 0}) {
    count++;
    const label = `discover-first-party-sources.mjs: ${name}`;
    await writeFile(join(root, 'data/build/catalog.json'), JSON.stringify({restaurants: venues}));
    await writeFile(join(root, 'data/discovered-restaurants.js'), `window.HALIFAX_DISCOVERED_RESTAURANTS = ${JSON.stringify(discovered)};`);
    await writeFile(join(root, 'data/social-profile-review-overrides.json'), '{"records":[]}');
    const before = JSON.stringify({generatedAt: oldAt, records: previous}, null, 2);
    await writeFile(join(root, 'previous.json'), before);
    await writeFile(join(root, 'data/build/first-party-sources.json'), before);
    const beforeJs = `window.HALIFAX_FIRST_PARTY_SOURCES = ${before};\n`;
    await writeFile(join(root, 'data/first-party-sources.js'), beforeJs);
    await writeFile(join(root, 'runner.mjs'), `
      import assert from 'node:assert/strict';
      import {writeFile} from 'node:fs/promises';
      const policy = ${JSON.stringify(policy)}, policies = ${JSON.stringify(policies)}, routes = ${JSON.stringify(routes)};
      const requests = [], unexpected = [];
      const base = ${JSON.stringify(origin)};
      globalThis.fetch = async (input, options) => {
        const url = String(input); requests.push(url);
        assert.equal(options.redirect, 'manual');
        assert(options.signal instanceof AbortSignal);
        let spec;
        const parsed = new URL(url);
        if (parsed.pathname === '/robots.txt' || parsed.pathname === '/policy') {
          assert.deepEqual(Object.keys(options.headers), ['User-Agent'], 'No content or API headers on policy requests');
          assert.equal(options.headers['User-Agent'], 'HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)');
          spec = policies[parsed.origin] || (parsed.origin === base ? policy : null);
          if (spec?.policyRedirect && parsed.pathname === '/robots.txt') spec = {status: 302, location: '/policy'};
        } else if (Object.hasOwn(routes, url)) {
          assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent']);
          spec = {...routes[url], contentType: routes[url].contentType || 'text/html'};
        }
        if (!spec) { unexpected.push(url); throw new Error('NO NETWORK: unexpected fixture URL ' + url); }
        if (spec.throws) throw spec.throws === 'TimeoutError' ? new DOMException('fixture timeout', 'TimeoutError') : new TypeError('fixture network failure');
        if (spec.stallsFetch) return new Promise(() => {});
        if (spec.lateFetch) await new Promise(resolve => setTimeout(resolve, 90));
        if (spec.oversizedLength) return {status: 200, headers: new Headers({'content-length': '999999'}), text: () => {throw new Error('Oversized body must not be read');}};
        const response = new Response([204, 302, 304].includes(spec.status) ? null : (spec.body ?? ''), {
          status: spec.status ?? 200, headers: {...(spec.location ? {location: spec.location} : {}),
            ...(spec.contentType ? {'content-type': spec.contentType} : {})}
        });
        Object.defineProperty(response, 'url', {value: url});
        if (spec.throwsBody || spec.stallsBody || spec.lateBody) response.text = async () => {
          if (spec.throwsBody) throw new TypeError('fixture body failure');
          if (spec.stallsBody) return new Promise(() => {});
          await new Promise(resolve => setTimeout(resolve, 90)); return spec.body || '<html>Late, not new evidence</html>';
        };
        return response;
      };
      try { await import('./scripts/discover-first-party-sources.mjs'); }
      finally {
        if (${settleMs}) await new Promise(resolve => setTimeout(resolve, ${settleMs}));
        await writeFile('./requests.json', JSON.stringify(requests));
        if (unexpected.length) throw new Error('Unexpected fixture URLs: ' + unexpected.join(', '));
      }
    `);
    const result = spawnSync(process.execPath, [join(root, 'runner.mjs')], {cwd: root, encoding: 'utf8', timeout: 5000,
      env: {...offlineEnv, FIRST_PARTY_SOURCE_DELAY_MS: '0', FIRST_PARTY_SOURCE_TIMEOUT_MS: '35',
        FIRST_PARTY_SOURCE_CONCURRENCY: '1', FIRST_PARTY_SOURCE_LIMIT: '9999', FIRST_PARTY_SOURCE_IDS: '',
        FIRST_PARTY_OWNED_PAGE_LIMIT: '3', FIRST_PARTY_LINK_HUB_LIMIT: '2', ...env}});
    assertAccessExit(result,expectedRequests.map(url => routes[url] || policies[new URL(url).origin] || policy),label,expectedExit);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'requests.json'), 'utf8')), expectedRequests, label + ': requests');
    async function readPair() {
      const json = JSON.parse(await readFile(join(root, 'data/build/first-party-sources.json'), 'utf8'));
      const js = await readFile(join(root, 'data/first-party-sources.js'), 'utf8');
      const assignment = js.match(/^window\.HALIFAX_FIRST_PARTY_SOURCES = ([\s\S]*);\s*$/);
      assert(assignment, label + ': JS assignment');
      assert.deepEqual(JSON.parse(assignment[1]), json, label + ': JSON/JS parity');
      return json;
    }
    const output = await readPair();
    if (expectedExit) {
      assert.equal(await readFile(join(root, 'data/build/first-party-sources.json'), 'utf8'), before, label + ': failed startup leaves bytes');
      assert.equal(await readFile(join(root, 'data/first-party-sources.js'), 'utf8'), beforeJs);
      return {output, stderr: result.stderr};
    }
    assert.equal(output.refreshedRecords, refreshed.length, label);
    assert.deepEqual(output.failures.map(row => row.reason), failures, label + ': classified failures');
    assert.equal(output.failedWebsites, failures.length, label);
    for (const old of previous.filter(row => !refreshed.includes(row.restaurantId))) {
      const retained = output.records.find(row => row.restaurantId === old.restaurantId);
      assert.equal(JSON.stringify(retained), JSON.stringify(old), label + ': exact failed/unattempted prior record');
    }
    for (const id of refreshed) {
      const record = output.records.find(row => row.restaurantId === id);
      assert(record, label + ': fresh record');
      assert.equal(record.reviewState, 'verified');
      assert.equal(record.rightsState, 'public_reference_not_media_licence');
      assert.equal(record.observedAt, record.lastVerifiedAt);
      assert(record.observedAt > oldAt, label + ': actual observation, not previous clock');
      const content = record.scannedOwnedPages.map(url => `${url}|${routes[url].body}`).join('\n');
      assert.equal(record.contentHash, createHash('sha256').update(content).digest('hex'), label + ': actual successful-page hash');
    }
    let merged;
    if (pipeline) {
      for (const script of ['merge-first-party-history.mjs', 'sanitize-first-party-sources.mjs']) {
        const run = spawnSync(process.execPath, [join(root, 'scripts', script)], {cwd: root, encoding: 'utf8', timeout: 5000,
          env: {...offlineEnv, FIRST_PARTY_PREVIOUS_PATH: join(root, 'previous.json'),
            FIRST_PARTY_CARRY_FORWARD_MAX_DAYS: '180', FIRST_PARTY_PRESERVE_UNREFRESHED_RECORDS: '0',
            FIRST_PARTY_PRESERVE_SANITIZATION_AUDIT: '0'}});
        assert.equal(run.status, 0, label + ': ' + script + '\n' + run.stderr);
        merged = await readPair();
      }
      for (const old of previous.filter(row => !refreshed.includes(row.restaurantId))) {
        assert.equal(JSON.stringify(merged.records.find(row => row.restaurantId === old.restaurantId)), JSON.stringify(old),
          label + ': actual merge/sanitize preserves retained record');
      }
    }
    return {output, merged};
  }
  for (const test of cases) {
    const page = new URL(test.path || '/menu', origin).href;
    const pages = test.repeat ? [page, page + '-second'] : [page];
    const venues = pages.map((url, index) => venue(index, url));
    const expectedRequests = Array(test.robotsRequests || 1).fill(robotsUrl);
    if (test.policyRedirect) expectedRequests.push(origin + '/policy');
    if (test.allowed || test.requestedPage) expectedRequests.push(...pages);
    await run({name: test.name, policy: test, venues, expectedRequests,
      routes: Object.fromEntries(pages.map(url => [url, test.pageRedirect ? {status: 302, location: test.pageRedirect} : {body: '<html>Fixture</html>'}])),
      refreshed: test.allowed ? venues.map(row => row.id) : [],
      failures: test.allowed ? [] : venues.map(() => test.error || 'robots_disallow')});
  }
  const legacyBody = 'User-agent: NotHalifaxSourced\nSitemap: https://fixture.example/sitemap.xml\nUser-agent: Other\nDisallow: /menu\nUser-agent: *\nDisallow: /else';
  await run({name: 'discovery-specific Sitemap group denial', policy: {body: legacyBody}, expectedRequests: [robotsUrl], failures: ['robots_disallow'], pipeline: true});
  const maps = Array.from({length: 14}, (_, index) => `${origin}/map-${index}.xml`);
  const policy = {body: ['Sitemap: https://other.example/map.xml', ...maps.map(url => 'Sitemap: ' + url), 'Sitemap: ' + maps[0]].join('\n')};
  const home = origin + '/menu';
  const homeHtml = '<html><a href="/about">About</a><a href="https://instagram.com/fixture">Instagram</a><link rel="alternate" type="application/rss+xml" href="/feed.xml"></html>';
  const metadata = await run({name: 'one robots cache for permission and bounded deduplicated sitemaps', policy,
    routes: {[home]: {body: homeHtml}, [origin + '/about']: {body: '<html>About</html>'}}, expectedRequests: [robotsUrl, home, origin + '/about'], refreshed: ['fixture-0']});
  assert.deepEqual(metadata.output.records[0].sitemaps, maps.slice(0, 12));
  assert.equal(metadata.output.records[0].socialProfiles[0].url, 'https://instagram.com/fixture');
  assert.equal(metadata.output.records[0].feeds[0].url, origin + '/feed.xml');
  // Sitemap/feed/profile links are stored references, never fetched here.
  for (const kind of ['throws', 'throwsBody', 'stallsFetch', 'stallsBody', 'lateBody', 'lateFetch', 'http', 'mime']) {
    const route = kind === 'http' ? {status: 503} : kind === 'mime' ? {contentType: 'application/json'} : {[kind]: kind === 'throws' ? 'TypeError' : true};
    const tail = origin + '/healthy';
    const suspended = ['stallsFetch','lateFetch'].includes(kind);
    const result = await run({name: `HTML ${kind} failure releases same-host queue`, venues: [venue(), venue(1, tail)],
      routes: {[home]: route, [tail]: {body: '<html>Tail</html>'}}, expectedRequests: [robotsUrl, home, ...(suspended ? [] : [tail])], refreshed: suspended ? [] : ['fixture-1'],
      failures: [kind === 'http' ? 'http_503' : kind === 'mime' ? 'not_html' : kind === 'throws' ? 'fixture network failure' : kind === 'throwsBody' ? 'fixture body failure' : 'timeout', ...(suspended ? ['source_access_hold'] : [])],
      settleMs: kind.startsWith('late') ? 110 : 0, pipeline: true});
    assert.equal(result.output.records.find(row => row.restaurantId === 'fixture-0').contentHash, oldHash);
  }
  await run({name: 'late content redirect cannot revive expired request', routes: {[home]: {lateFetch: true, status: 302, location: '/forbidden-late'}},
    expectedRequests: [robotsUrl, home], failures: ['timeout'], settleMs: 110});
  for (const [name, location, body, failure] of [
    ['query', '/about?private=1', 'User-agent: *\nDisallow: /about?private=1', 'robots_disallow'],
    ['wildcard', '/about/private/a', 'User-agent: *\nDisallow: /about/private/*', 'robots_disallow'],
    ['cross-host', 'https://other.example/about', '', 'quarantined_cross_entity_redirect'],
    ['quarantine', 'https://glitterbeancafe.com./about', '', 'quarantined_cross_entity_redirect'],
    ['missing', null, '', 'redirect_without_location'],
    ['loop', '/menu', '', 'redirect_limit']
  ]) {
    await run({name: `HTML redirect ${name}`, policy: {body}, routes: {[home]: {status: 302, ...(location ? {location} : {})}},
      expectedRequests: [robotsUrl, ...Array(name === 'loop' ? 4 : 1).fill(home)], failures: [failure]});
  }
  const finalHome = origin + '/landing/';
  const finalAbout = finalHome + 'about';
  const redirected = await run({name: 'allowed same-host redirects retain final URLs and relative-link bases',
    routes: {[home]: {status: 302, location: '/landing/'}, [finalHome]: {body: '<html><a href="about">About</a></html>'},
      [finalAbout]: {body: '<a href="https://instagram.com/finalfixture">Instagram</a>'}},
    expectedRequests: [robotsUrl, home, finalHome, finalAbout], refreshed: ['fixture-0']});
  assert.equal(redirected.output.records[0].resolvedUrl, finalHome);
  assert.equal(redirected.output.records[0].socialProfiles[0].discoveredFrom, finalAbout);
  await run({name: 'owned page retains discovery-specific Sitemap group denial',
    policy: {body: legacyBody.replace('Disallow: /menu', 'Disallow: /about')},
    routes: {[home]: {body: '<html><a href="/about">About</a></html>'}},
    expectedRequests: [robotsUrl, home], refreshed: ['fixture-0']});
  await run({name: 'owned-page redirect checks query policy before transport',
    policy: {body: 'User-agent: *\nDisallow: /about?private=1'},
    routes: {[home]: {body: '<html><a href="/about">About</a></html>'}, [origin + '/about']: {status: 302, location: '/about?private=1'}},
    expectedRequests: [robotsUrl, home, origin + '/about'], refreshed: ['fixture-0']});
  for (const policy of [{status: 503}, {stallsBody: true}]) {
    await run({name: `unavailable hub policy is cached across linked hubs: ${JSON.stringify(policy)}`,
      policies: {'https://linktr.ee': policy}, routes: {[home]: {body: '<html><a href="https://linktr.ee/one">Links</a><a href="https://linktr.ee/two">Links</a></html>'}},
      expectedRequests: [robotsUrl, home, 'https://linktr.ee/robots.txt'], refreshed: ['fixture-0'],
      failures: ['link_hub_robots_disallow', 'link_hub_robots_disallow']});
  }
  await run({name: 'linked hub redirect obeys destination policy and never fetches social HTML',
    policies: {'https://linktr.ee': {body: 'User-agent: *\nDisallow: /blocked'}},
    routes: {[home]: {body: '<html><a href="https://linktr.ee/fixture">Links</a></html>'},
      'https://linktr.ee/fixture': {status: 302, location: '/blocked'}},
    expectedRequests: [robotsUrl, home, 'https://linktr.ee/robots.txt', 'https://linktr.ee/fixture'],
    refreshed: ['fixture-0'], failures: ['link_hub_robots_disallow']});
  const old = priorRecord(venue());
  old.socialProfiles = [{platform: 'instagram', platformKind: 'social', handle: 'oldfixture', url: 'https://instagram.com/oldfixture',
    profileUrl: 'https://instagram.com/oldfixture', label: 'Instagram', locationSpecific: false, sharedBrandProfile: false,
    discoveredFrom: origin + '/about', associationBasis: 'linked_from_official_website', observedAt: oldAt, lastVerifiedAt: oldAt,
    reviewState: 'verified_link', confidence: 'authoritative', status: 'active'}];
  old.relatedLinks = [{kind: 'menu', url: origin + '/old-menu.pdf', label: 'Menu', discoveredFrom: origin + '/about',
    associationBasis: 'linked_from_official_website', observedAt: oldAt, lastVerifiedAt: oldAt,
    reviewState: 'verified_link', confidence: 'authoritative', status: 'active', rightsState: 'public_reference_not_media_licence'}];
  old.feeds = [{url: origin + '/old-feed.xml', type: 'application/rss+xml', title: 'Old feed', discoveredFrom: origin + '/about',
    observedAt: oldAt, lastVerifiedAt: oldAt, reviewState: 'verified_link', rightsState: 'public_reference_not_media_licence'}];
  for (const variant of ['denied', 'HTTP failure', 'zero targets']) {
    await run({name: `actual history pipeline: ${variant}`, previous: [old], pipeline: true,
      policy: {status: variant === 'denied' ? 503 : 200}, routes: {[home]: {status: 503}},
      expectedRequests: variant === 'zero targets' ? [] : [robotsUrl, ...(variant === 'HTTP failure' ? [home] : [])],
      failures: variant === 'zero targets' ? [] : [variant === 'denied' ? 'robots_disallow' : 'http_503'],
      env: variant === 'zero targets' ? {FIRST_PARTY_SOURCE_LIMIT: '0'} : {}});
  }
  // Preserve genuinely old historical evidence too; do not silently turn this
  // transport migration into the separately required association-expiry repair.
  const historical = JSON.parse(JSON.stringify(old).replaceAll(oldAt, '2020-01-02T03:04:05.000Z'));
  await run({name: 'old history remains byte-exact through denial and actual merge/sanitize', previous: [historical],
    pipeline: true, policy: {status: 403}, expectedRequests: [robotsUrl], failures: ['robots_disallow']});
  const hub = 'https://linktr.ee/fixture';
  for (const variant of ['owned denied', 'owned body stalled', 'hub denied', 'hub body stalled']) {
    const isHub = variant.startsWith('hub');
    const html = `<html><a href="${isHub ? hub : '/about'}">${isHub ? 'Links' : 'About'}</a></html>`;
    const partial = await run({name: `partial ${variant} retains genuine old link clocks through merge`, previous: [old], pipeline: true,
      policy: {body: variant === 'owned denied' ? 'User-agent: *\nDisallow: /about' : ''},
      policies: isHub ? {'https://linktr.ee': {body: variant === 'hub denied' ? 'User-agent: *\nDisallow: /fixture' : ''}} : {},
      routes: {[home]: {body: html}, [isHub ? hub : origin + '/about']: {stallsBody: true}},
      expectedRequests: [robotsUrl, home, ...(isHub ? ['https://linktr.ee/robots.txt'] : []), ...(variant.endsWith('stalled') ? [isHub ? hub : origin + '/about'] : [])],
      refreshed: ['fixture-0'], failures: isHub ? [variant === 'hub denied' ? 'link_hub_robots_disallow' : 'link_hub_timeout'] : []});
    for (const kind of ['socialProfiles', 'relatedLinks', 'feeds']) {
      const retained = partial.merged.records[0][kind][0];
      assert.equal(retained.observedAt, oldAt, variant + ': old link observation survives actual merge');
      assert.equal(retained.lastVerifiedAt, oldAt);
      assert.equal(retained.reviewState, old[kind][0].reviewState);
      assert.equal(retained.rightsState, old[kind][0].rightsState);
      assert.equal(retained.refreshState, 'carried_forward_previous_verification');
    }
  }
  const boundedHtml = '<html>' + Array.from({length: 8}, (_, index) => `<a href="/about-${index}">About</a>`).join('')
    + Array.from({length: 6}, (_, index) => `<a href="https://linktr.ee/fixture-${index}">Links</a>`).join('') + '</html>';
  const bounded = await run({name: 'existing upper owned-page and linked-hub bounds, no social destination fetch',
    env: {FIRST_PARTY_OWNED_PAGE_LIMIT: '99', FIRST_PARTY_LINK_HUB_LIMIT: '99', FIRST_PARTY_SOURCE_CONCURRENCY: '99'},
    policies: {'https://linktr.ee': {body: ''}}, routes: {[home]: {body: boundedHtml},
      ...Object.fromEntries(Array.from({length: 4}, (_, index) => [origin + `/about-${index}`, {body: '<html>About</html>'}])),
      ...Object.fromEntries(Array.from({length: 4}, (_, index) => [`https://linktr.ee/fixture-${index}`, {body: `<a href="https://instagram.com/fixture-${index}">Instagram</a>`}]))},
    expectedRequests: [robotsUrl, home, ...Array.from({length: 4}, (_, index) => origin + `/about-${index}`), 'https://linktr.ee/robots.txt',
      ...Array.from({length: 4}, (_, index) => `https://linktr.ee/fixture-${index}`)], refreshed: ['fixture-0']});
  assert.equal(bounded.output.ownedPageLimit, 5); assert.equal(bounded.output.linkHubLimit, 4); assert.equal(bounded.output.concurrency, 16);
  assert.equal(bounded.output.records[0].socialProfiles.length, 4); assert.equal(bounded.output.records[0].linkHubs.length, 6);
  const minimum = await run({name: 'owned/hub lower bounds do not admit extra pages',
    env: {FIRST_PARTY_OWNED_PAGE_LIMIT: '0', FIRST_PARTY_LINK_HUB_LIMIT: '0', FIRST_PARTY_SOURCE_CONCURRENCY: '0'},
    routes: {[home]: {body: boundedHtml}}, expectedRequests: [robotsUrl, home], refreshed: ['fixture-0']});
  assert.equal(minimum.output.ownedPageLimit, 1); assert.equal(minimum.output.linkHubLimit, 0); assert.equal(minimum.output.concurrency, 1);
  const discoveredVenue = venue(1, origin + '/discovered');
  const combined = await run({name: 'reviewed discovered targets append while canonical duplicate ID wins',
    discovered: [venue(0, 'https://never.example/duplicate'), discoveredVenue],
    routes: {[home]: {body: '<html>Canonical</html>'}, [discoveredVenue.website]: {body: '<html>Discovered</html>'}},
    expectedRequests: [robotsUrl, home, discoveredVenue.website], refreshed: ['fixture-0', 'fixture-1']});
  assert.equal(combined.output.records.length, 2);
  for (const env of [{FIRST_PARTY_SOURCE_LIMIT: '1'}, {FIRST_PARTY_SOURCE_IDS: 'fixture-0'}]) {
    const selected = await run({name: 'selected/limited target retains other prior records', venues: [venue(), venue(1, origin + '/unattempted')],
      env, routes: {[home]: {body: '<html>Selected</html>'}}, expectedRequests: [robotsUrl, home], refreshed: ['fixture-0'], pipeline: true});
    assert.equal(selected.output.checkedWebsites, 1);
  }
  await run({name: 'quarantined initial website never requests policy or content', venues: [venue(0, 'https://glitterbeancafe.com./')],
    previous: [], failures: ['quarantined_source']});
  await run({name: 'invalid initial website never requests policy or content', venues: [venue(0, 'not a url')],
    previous: [], failures: ['invalid_url']});
  const missing = await run({name: 'unknown selected ID stops before transport or writes', env: {FIRST_PARTY_SOURCE_IDS: 'missing'}, expectedExit: 1});
  assert.match(missing.stderr, /Unknown FIRST_PARTY_SOURCE_IDS: missing/);
  const empty = await run({name: 'successful empty discovery is not a failure', routes: {[home]: {body: '<html>No relationships</html>'}},
    expectedRequests: [robotsUrl, home], refreshed: ['fixture-0'], previous: [old]});
  assert.deepEqual(empty.output.records[0].socialProfiles, []);
  return count;
}
