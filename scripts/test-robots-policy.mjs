import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRobotsAllows, createRobotsPolicy, parseRobotsPolicy, robotsPolicyAllows } from './lib/robots-policy.mjs';

const base = 'https://fixture.example';
const allows = (body, path) => robotsPolicyAllows(parseRobotsPolicy(body), base + path);
const wildcard = rule => `User-agent: *\nDisallow: ${rule}`;
const matching = [
  [wildcard('/menu?format=json'), '/menu?format=json', false],
  [wildcard('/menu?format=json'), '/menu?format=html', true],
  [wildcard('/*?format=json'), '/menu?format=json', false],
  [wildcard('/private/*'), '/private/menu', false],
  [wildcard('/a*b*c$'), '/a-b-b-c', false],
  [wildcard('/a*b*c$'), '/a-b-c-d', true],
  [wildcard('/a*b*c$'), '/a-c-b', true],
  [wildcard('/a**b*'), '/ab', false],
  [wildcard('/a*' + 'a*'.repeat(80) + 'b$'), '/' + 'a'.repeat(1000) + 'c', true],
  [wildcard('/menu$'), '/menu', false],
  [wildcard('/menu$'), '/menu?open=1', true],
  [wildcard('/menu$'), '/menu/child', true],
  [wildcard('/menu$'), '/menu$legacy', false],
  [wildcard('/a.b+(c)[d]{e}^|'), '/a.b+(c)[d]{e}^|/menu', false],
  [wildcard('/a.b'), '/axb', true],
  [wildcard('/%6denu'), '/menu', false],
  [wildcard('/menu'), '/%6Denu', false],
  [wildcard('/%7euser'), '/~user', false],
  [wildcard('/café'), '/caf%C3%A9', false],
  [wildcard('/caf%c3%a9'), '/café', false],
  [wildcard('/餐厅'), '/%E9%A4%90%E5%8E%85', false],
  [wildcard('/a%2fb'), '/a%2Fb', false],
  [wildcard('/a%2Fb'), '/a/b', true],
  [wildcard('/a/b'), '/a%2Fb', true],
  [wildcard('/literal%2A'), '/literal%2a', false],
  [wildcard('/literal%2A'), '/literal-anything', true],
  [wildcard('/money%24'), '/money%24', false],
  [wildcard('/money$inside'), '/money$inside', false],
  [wildcard('/menu?x=%7E'), '/menu?x=~', false],
  [wildcard('/menu?x=%2F'), '/menu?x=/', true],
  ['User-agent: hAlIfAxSoUrCeD\nDisallow: /menu', '/menu', false],
  ['User-agent: HalifaxSourced\nDisallow: /other\nUser-agent: HalifaxSourced\nDisallow: /menu', '/menu', false],
  ['User-agent: *\nDisallow: /other\nUser-agent: *\nDisallow: /menu', '/menu', false],
  ['User-agent: NotHalifaxSourced\nDisallow: /other\nUser-agent: *\nDisallow: /menu', '/menu', false],
  ['User-agent: NotHalifaxSourced\nDisallow: /legacy\nUser-agent: *\nDisallow: /menu', '/legacy', false],
  ['User-agent: HalifaxSourcedBot\nDisallow: /other\nUser-agent: *\nDisallow: /menu', '/menu', false],
  ['User-agent: HalifaxSourced\nDisallow: /private\nUser-agent: *\nDisallow: /', '/menu', true],
  ['User-agent: Other\nDisallow: /\nUser-agent: *\nDisallow:', '/menu', true],
  ['User-agent: Other\nUser-agent: HalifaxSourced\nDisallow: /menu', '/menu', false],
  ['User-agent: HalifaxSourced\nSitemap: https://fixture.example/sitemap.xml\nUser-agent: Other\nDisallow: /menu', '/menu', false],
  ['User-agent: *\rDisallow: /menu', '/menu', false],
  ['\uFEFFUser-agent: *\r\nDisallow: /menu # comment', '/menu', false],
  [wildcard('/') + '\nAllow: /menu', '/menu', false],
  [wildcard(''), '/menu', true],
  ['', '/menu', true],
  ['# comments only\n  # still empty', '/menu', true],
  ['Sitemap: https://fixture.example/sitemap.xml', '/menu', true],
  ['User-agent: *\nCrawl-delay: 2\nDisallow: /private', '/menu', true],
  ['<!doctype html><html><title>Just a moment...</title><body>Verify you are human</body></html>', '/menu', false],
  ['<?xml version="1.0"?><error>Denied</error>', '/menu', false],
  ['{"error": "temporarily unavailable"}', '/menu', false],
  ['Service temporarily unavailable', '/menu', false],
  ['Error: service unavailable', '/menu', false],
  ['Unknown: extension only', '/menu', false],
  ['Disallow: /private', '/menu', false],
  ['User-agent: *\nDisallow: Service temporarily unavailable', '/menu', false],
  ['User-agent: *\nDisallow: https://fixture.example/menu', '/menu', false],
  ['User-agent: *\nAllow: malformed policy', '/menu', false],
  ['User-agent: *\n\u0000', '/menu', false],
  ['User-agent: *\n#' + 'a'.repeat(512 * 1024), '/menu', false]
];
for (const [body, path, expected] of matching) assert.equal(allows(body, path), expected, JSON.stringify({body, path}));

// Independent frozen legacy implementation for the tightening-only invariant.
function oldAllows(text, path, discovery = false) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (discovery && key === 'sitemap' && value) continue;
    if (key === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    current.hasRules = true;
    if (key === 'disallow' && value) current.disallow.push(value);
  }
  const specific = groups.find(group => group.agents.some(agent => agent.includes('halifaxsourced')));
  const fallback = groups.find(group => group.agents.includes('*'));
  return !(specific || fallback)?.disallow.some(prefix => prefix === '/' || new URL(base + path).pathname.startsWith(prefix));
}
const paths = [...new Set(matching.map(([, path]) => path).concat(['/menu$', '/private/*literal', '/legacy/child', '/other', '/unrelated', '/']))];
const bodies = [...new Set(matching.map(([body]) => body).filter(body => body.length < 1024).concat([
  'User-agent: NotHalifaxSourced\nDisallow: /\nUser-agent: HalifaxSourced\nDisallow: /unrelated',
  'User-agent: *\nDisallow: /private/*\nDisallow: /menu$\nAllow: /private/*',
  'User-agent: *\nDisallow: /legacy\nUnknown: value\nUser-agent: HalifaxSourced\nDisallow: /other'
]))];
for (const body of bodies) for (const path of paths) {
  assert(!allows(body, path) || oldAllows(body, path), `Reopened legacy denial: ${JSON.stringify({body, path})}`);
}
assert.equal(oldAllows(wildcard('/menu$'), '/menu$legacy'), false);
assert.equal(oldAllows('User-agent: NotHalifaxSourced\nDisallow: /\nUser-agent: HalifaxSourced\nDisallow: /unrelated', '/legacy'), false);

// Discovery's additional legacy projection is opt-in; the existing shared API
// stays unchanged while the migrated adapter can only tighten either policy.
const discoveryBody = 'User-agent: NotHalifaxSourced\nSitemap: https://fixture.example/sitemap.xml\nUser-agent: Other\nDisallow: /menu\nUser-agent: *\nDisallow: /else';
assert.equal(allows(discoveryBody, '/menu'), true, 'Counterexample distinguishes the old shared policy');
assert.equal(oldAllows(discoveryBody, '/menu', true), false);
const discoveryBodies = [...bodies, discoveryBody];
for (const agent of ['*', 'HalifaxSourced', 'NotHalifaxSourced', 'Other']) {
  for (const middle of ['Sitemap: https://fixture.example/map.xml', 'Sitemap:', 'Sitemap: invalid', 'Unknown: value']) {
    discoveryBodies.push(`User-agent: ${agent}\n${middle}\nUser-agent: Other\nDisallow: /menu\nUser-agent: *\nDisallow: /legacy`);
  }
}
for (const body of discoveryBodies) for (const path of paths) {
  const result = robotsPolicyAllows(parseRobotsPolicy(body), base + path, { preserveDiscoveryDenials: true });
  assert(!result || oldAllows(body, path, true), `Reopened discovery denial: ${JSON.stringify({body, path})}`);
  assert(!result || allows(body, path), 'Discovery also preserves every shared-policy denial');
}

// Keep dynamic holds and diagnostics inside a disposable process. This is a
// test-only entrypoint split, not a production policy switch or registry reset.
if (!process.argv.includes('--isolated-access-fixture')) {
  const root = await mkdtemp(join(tmpdir(),'halifax-robots-policy-'));
  try {
    for (const file of ['scripts/test-robots-policy.mjs','scripts/lib/robots-policy.mjs','scripts/lib/fetch-public-source.mjs','scripts/lib/source-access-state.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/deny-source-network.mjs','data/source-link-access-holds.json','source-integrity.js']) {
      await mkdir(dirname(join(root,file)),{recursive:true});
      await copyFile(new URL('../'+file,import.meta.url),join(root,file));
    }
    const child=spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'scripts/test-robots-policy.mjs'),'--isolated-access-fixture'],{cwd:root,env:process.env,encoding:'utf8',timeout:30000});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);
    assert.equal(child.status,1,'Actual denial cases intentionally make this isolated run nonpublishable: '+child.stderr);
    assert.match(child.stdout,/Robots policy passed offline:/,'Assertions must finish, not merely exit1');
    const diagnostics=child.stderr.split('\n').filter(line=>line.startsWith('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ')).map(line=>JSON.parse(line.slice('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC '.length)));
    assert.deepEqual(diagnostics.filter(item=>item.kind==='http_restriction').map(item=>item.evidence.receipt.status).sort((a,b)=>a-b),[401,403,429]);
    assert.equal(diagnostics.filter(item=>item.kind==='unsettled_transport').length,1);
    assert.equal(diagnostics.length,4,'No unexpected access diagnostics');
    process.stdout.write(child.stdout);
  } finally { await rm(root,{recursive:true,force:true}); }
} else {
const originalFetch = globalThis.fetch;
try {
  for (const status of [200, 201, 204, 206, 300, 304, 400, 401, 403, 404, 405, 408, 410, 418, 429, 500, 502, 503, 504, 599]) {
    const base = `https://status-${status}.fixture.example`;
    const requests = [];
    globalThis.fetch = async input => { requests.push(String(input)); return new Response([204, 304].includes(status) ? null : '', { status }); };
    const check = createRobotsAllows({ userAgent: 'HalifaxSourced/fixture' });
    const expected = [200, 404, 410].includes(status);
    assert.deepEqual(await Promise.all([check(base + '/menu'), check(base + '/events')]), [expected, expected], `HTTP ${status}`);
    assert.equal(await check(base + '/tail'), expected);
    assert.deepEqual(requests, [base + '/robots.txt'], 'One request per origin, including failures');
  }
  for (const [contentType, body, expected] of [
    ['text/plain; charset=UTF-8', '', true],
    ['text/plain', '# valid empty policy', true],
    ['text/plain', 'Sitemap: https://fixture.example/sitemap.xml', true],
    ['', 'User-agent: *\nDisallow: /private', true],
    ['text/html', '<!doctype html><html>Verify you are human</html>', false],
    ['text/plain', '<html>Challenge with a misleading media type</html>', false],
    ['application/xml', '<error>Unavailable</error>', false],
    ['application/json', '{"error":"Unavailable"}', false],
    ['application/octet-stream', 'User-agent: *\nDisallow:', false]
  ]) {
    globalThis.fetch = async () => new Response(body, {headers: {'content-type': contentType}});
    assert.equal(await createRobotsAllows({userAgent: 'HalifaxSourced/fixture'})(base + '/menu'), expected, contentType + ' content qualification');
  }
  globalThis.fetch = async () => ({status: 200, headers: new Headers({'content-length': '999999'}), text: () => { throw new Error('Oversized body must not be read'); }});
  assert.equal(await createRobotsAllows({userAgent: 'HalifaxSourced/fixture'})(base + '/menu'), false);
  for (const kind of ['network', 'fetch-stall', 'body-error', 'body-stall']) {
    const base = `https://${kind}.fixture.example`;
    let calls = 0;
    let signal;
    globalThis.fetch = async (_input, options) => {
      calls++;
      signal = options.signal;
      if (kind === 'network') throw new TypeError('offline fixture failure');
      if (kind === 'fetch-stall') return new Promise(() => {});
      return { status: 200, text: async () => {
        if (kind === 'body-error') throw new TypeError('body failure');
        return new Promise(() => {});
      } };
    };
    const check = createRobotsAllows({ userAgent: 'HalifaxSourced/fixture', timeoutMs: 20 });
    assert.equal(await check(base + '/menu'), false, kind);
    if (kind.endsWith('stall')) assert.equal(signal.aborted, true, 'Complete fetch/body deadline aborts transport');
    globalThis.fetch = async () => { calls++; return new Response(''); };
    assert.equal(await check(base + '/events'), false, 'Failure must not retry or turn into empty policy');
    assert.equal(calls, 1);
  }
  for (const location of [null, 'http://[', 'https://other.example/robots.txt', 'https://glitterbeancafe.com./robots.txt', '/robots.txt']) {
    const requests = [];
    globalThis.fetch = async input => {
      requests.push(String(input));
      return new Response(null, { status: 302, headers: location ? { location } : {} });
    };
    const check = createRobotsAllows({ userAgent: 'HalifaxSourced/fixture' });
    assert.equal(await check(base + '/menu'), false, String(location));
    assert.equal(await check(base + '/events'), false);
    assert.equal(requests.length, location === '/robots.txt' ? 4 : 1);
    assert(requests.every(url => url === base + '/robots.txt'));
  }
  // Permission and sitemap consumers share one qualified in-flight origin result.
  for (const policy of [
    { status: 200, body: 'Sitemap: https://fixture.example/map.xml\nSitemap: https://fixture.example/map.xml\nSitemap: https://other.example/map.xml', expected: [base + '/map.xml', 'https://other.example/map.xml'] },
    { status: 404 }, { status: 410 }, { status: 206 }, { status: 503 },
    { body: 'Sitemap: https://fixture.example/map.xml\n<html>Challenge</html>' },
    { body: 'Sitemap: https://fixture.example/map.xml', contentType: 'text/html' },
    { body: 'Sitemap: https://fixture.example/map.xml', bodyError: true },
    { body: 'Sitemap: https://fixture.example/map.xml', bodyStall: true }
  ]) {
    const calls = [];
    globalThis.fetch = async (input, options) => {
      calls.push(String(input));
      assert.deepEqual(Object.keys(options.headers), ['User-Agent'], 'Robots receives no content/API headers');
      if (policy.bodyError || policy.bodyStall) return {status: 200, text: async () => {
        if (policy.bodyError) throw new Error('fixture body failure');
        return new Promise(() => {});
      }};
      return new Response(policy.body || 'Sitemap: https://fixture.example/map.xml', {
        status: policy.status || 200, headers: {'content-type': policy.contentType || 'text/plain'}
      });
    };
    const get = createRobotsPolicy({userAgent: 'HalifaxSourced/fixture', timeoutMs: 20});
    const [metadata, permission] = await Promise.all([get(base + '/one'), get(base + '/two').then(value => robotsPolicyAllows(value, base + '/two'))]);
    assert.deepEqual(metadata.sitemaps || [], policy.expected || [], 'Only complete qualified text yields metadata');
    assert.equal(permission, Boolean(policy.expected) || [404, 410].includes(policy.status));
    assert.strictEqual(await get(base + '/again'), metadata, 'Same cached policy result, including failures');
    assert.deepEqual(calls, [base + '/robots.txt']);
  }
  const requests = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    return url.endsWith('/robots.txt') ? new Response(null, { status: 302, headers: { location: '/policy' } }) : new Response(wildcard('/private'));
  };
  const check = createRobotsAllows({ userAgent: 'HalifaxSourced/fixture' });
  assert.equal(await check(base + '/menu'), true);
  assert.equal(await check(base + '/private'), false);
  assert.deepEqual(requests, [base + '/robots.txt', base + '/policy']);
  assert.equal(await check('https://second.example/menu'), true);
  assert.equal(requests.length, 4, 'Distinct origins get distinct policy caches');
  assert.equal(await check('https://glitterbeancafe.com./menu'), false);
  assert.equal(await check('https://nogginsfarm.ca/menu'), false, 'Reviewed robots URL hold suppresses the Noggins host before transport');
  assert.equal(await check('file:///menu'), false);
  assert.equal(await check('not a url'), false);
  assert.equal(requests.length, 4, 'Unsafe sources never request robots');
} finally { globalThis.fetch = originalFetch; }
console.log(`Robots policy passed offline: ${matching.length} semantic cases, ${bodies.length * paths.length} shared and ${discoveryBodies.length * paths.length} discovery tightening-only pairs, failure/cache/deadline/redirect controls.`);

}
