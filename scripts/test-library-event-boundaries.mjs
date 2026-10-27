import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Load the production pure parser, without running collection or touching data.
const source = await readFile(new URL('./import-supplemental-city-events.mjs', import.meta.url), 'utf8');
const ctx = vm.createContext({ URL });
vm.runInContext(source.slice(source.indexOf('function clean('), source.indexOf('function normalized(')), ctx);
vm.runInContext(source.slice(source.indexOf('function libraryEventCards('), source.indexOf('const libraryParserDiagnostics')), ctx);
const page = 'https://halifax.bibliocommons.com/v2/events?page=1';
const id = '6abe6719e06996003a8073b8';
const second = '6abe6719e06996003a8073b9';
const heading = (url, title = 'Real event') => `<h3><a href="${url}">${title}</a></h3>`;
const details = '<div>Sunday, October 25 on October 25, 2026, 2:00pm – 3:30pm</div><div>Central Library</div>';
const card = (content) => `<li class="cp-events-search-result">${content}</li>`;
const parse = html => ctx.libraryEventCards(html, page);
const navigation = heading('https://www.halifaxpubliclibraries.ca/library-store/', 'Library Store');
let result = parse(navigation + card(details + heading(`/v2/events/${id}`)));
assert.equal(result.cards.length, 1, 'Navigation must never borrow a real card’s preceding metadata');
assert.equal(result.counts.nonDetailLinks, 1);
assert.equal(result.cards[0].url, new URL(`/v2/events/${id}`, page).href);
assert(result.cards[0].html.includes(details), 'Metadata preceding the title belongs to its own card');
result = parse(card(heading(`/events/${id}`, 'Missing fields')) + card(details + heading(`/v2/events/${second}`)));
assert.equal(result.cards.length, 2);
assert(!result.cards[0].html.includes('October'), 'Missing date cannot borrow the adjacent card date');
assert(!result.cards[0].html.includes('Central Library'), 'Missing venue cannot borrow adjacent location');
assert(result.cards[1].html.includes(details));
for (const path of [`/events/${id}`, `/v2/events/${id}`]) {
  result = parse(`<article><h3 data-note="a > b"><a\n data-label='a "quote"'\n href = '${path}?q=one&amp;two=2'><span>Quoted &quot;title&quot;</span></a></h3>${details}</article>`);
  assert.equal(result.cards.length, 1, 'Multiline attributes and either quote form are supported');
  assert(result.cards[0].url.endsWith('?q=one&two=2'));
  assert.equal(ctx.libraryDisplayTitle(result.cards[0].titleHtml), 'Quoted "title"');
}
for (const bad of ['/events', '/v2/events', '/v2/events?locations=BED', '/events/library-store', `/v2/events/${id}/register`, `https://evil.example/events/${id}`, `https://halifax.bibliocommons.com.evil.example/events/${id}`, `javascript:alert(1)`, `https://user:pass@halifax.bibliocommons.com/events/${id}`]) {
  assert.equal(parse(card(heading(bad) + details)).cards.length, 0, bad);
}
assert.equal(parse(heading(`/events/${id}`) + details).cards.length, 0, 'Unknown/unbounded markup fails closed');
assert.equal(parse(`<li>${heading(`/events/${id}`)}${details}`).cards.length, 0, 'Unclosed card fails closed');
assert.equal(parse(card(heading(`/events/${id}`) + heading(`/events/${second}`) + details)).cards.length, 0, 'Ambiguous card fails closed');
assert.equal(parse(`<script>${card(heading(`/events/${id}`) + details)}</script>`).cards.length, 0, 'Embedded script markup is not evidence');
assert.equal(parse(`<!-- ${card(heading(`/events/${id}`) + details)} -->`).cards.length, 0);
assert.equal(parse(card('<h3>Unlinked heading</h3>' + details)).cards.length, 0);
assert(!parse(card(heading(`/events/${id}`)) + details).cards[0].html.includes('October'), 'Footer date and venue cannot fill the last incomplete card');
console.log('Library card boundaries: navigation, adjacent/pre-title metadata, URL identities, quotes, malformed/ambiguous cards and missing fields passed.');

// Exercise the actual importer, including repeated pages and incomplete cards.
const { copyFile, mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises');
const { spawnSync } = await import('node:child_process');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const root = await mkdtemp(join(tmpdir(), 'halifax-library-boundaries-'));
try {
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  await copyFile(new URL('./import-supplemental-city-events.mjs', import.meta.url), join(root, 'scripts/import-supplemental-city-events.mjs'));
  const fixture = '<p>1 to 20 of 40 items</p>' + navigation
    + card(heading(`/events/${second}`, 'Missing date') + '<div>Central Library</div>')
    + card(details + heading(`/v2/events/${id}`))
    + card(heading('/events/6abe6719e06996003a8073ba', 'Missing venue') + '<p>on October 25, 2026, 2:00pm</p>');
  await writeFile(join(root, 'scripts/lib/fetch-public-source.mjs'), `
    import { appendFile } from 'node:fs/promises';
    export async function fetchGuardedSource(url) {
      if (!/^https:\\/\\/halifax\\.bibliocommons\\.com\\/v2\\/events\\?page=[12]$/.test(url)) throw new Error('Unexpected mock request');
      await appendFile(${JSON.stringify(join(root, 'requests.log'))}, url+'\\n');
      return new Response(${JSON.stringify(fixture)}, { headers: { 'content-type': 'text/html' } });
    }`);
  await writeFile(join(root, 'data/event-source-supplements.json'), JSON.stringify({sources: [{ id: 'library', name: 'Library', mode: 'bibliocommons_events', url: page.split('?')[0], allowedLocations: { 'Central Library': 'Halifax' } }]}));
  await writeFile(join(root, 'data/build/city-events.json'), JSON.stringify({events: [], range: { start: '2026-10-01', end: '2026-11-01' }}));
  const run = spawnSync(process.execPath, [join(root, 'scripts/import-supplemental-city-events.mjs')], { encoding: 'utf8', env: { ...process.env, LIBRARY_EVENT_DELAY_MS: '0' } });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(await readFile(join(root, 'data/build/city-events.json'), 'utf8'));
  assert.equal(output.events.length, 1, 'Repeated pages dedupe, missing fields and navigation do not become events');
  assert.equal(output.events[0].title, 'Real event');
  assert.equal(output.events[0].startAt, '2026-10-25T17:00:00.000Z');
  assert.equal(output.events[0].endAt, '2026-10-25T18:30:00.000Z');
  const diagnostic = await readFile(join(root, 'artifacts/library-event-parser-report.json'), 'utf8');
  assert(!diagnostic.includes('<') && !diagnostic.includes('Real event'), 'Diagnostics must not retain scraped content');
  for (const summary of JSON.parse(diagnostic).pages) {
    assert.equal(summary.nonDetailLinks, 1);
    assert.equal(summary.missingOccurrence, 1);
    assert.equal(summary.missingLocation, 1);
  }
  assert.deepEqual((await readFile(join(root, 'requests.log'), 'utf8')).trim().split('\n'), [page, page.replace('page=1', 'page=2')]);
  console.log('Library importer offline regression: repeated pages, explicit occurrence metadata, incomplete cards and content-free diagnostics passed.');
} finally { await rm(root, { recursive: true, force: true }); }
