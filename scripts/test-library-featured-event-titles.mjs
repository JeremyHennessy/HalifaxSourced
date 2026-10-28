import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preservePublishedEventIds } from './lib/canonical-event-dedupe.mjs';

const root = await mkdtemp(join(tmpdir(), 'halifax-library-featured-titles-'));
const title = 'An Afternoon of Creature Connections with the Evergreen Writers Group';
const rawTitle = `${title} Featured Event. ${title}`;
const observedAt = '2026-10-24T11:11:15.996Z';
const refreshedAt = '2026-10-25T14:00:00.000Z';
const published = {
  id: 'halifax-public-libraries-8a7fdff7c67b162a', title: rawTitle,
  startAt: '2026-10-25T17:00:00.000Z', endAt: '2026-10-25T18:30:00.000Z',
  venueName: 'Central Library', city: 'Halifax', sourceId: 'halifax-public-libraries',
  sourceKind: 'public_library_calendar', eventUrl: 'https://halifax.bibliocommons.com/v2/events/6abe6719e06996003a8073b8', observedAt,
};
try {
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'data/build'), { recursive: true });
  await copyFile(new URL('./import-supplemental-city-events.mjs', import.meta.url), join(root, 'scripts/import-supplemental-city-events.mjs'));
  await copyFile(new URL('./lib/canonical-event-dedupe.mjs', import.meta.url), join(root, 'scripts/lib/canonical-event-dedupe.mjs'));
  const headings = [
    ['6abe6719e06996003a8073b8', `<span>${title}</span><span>Featured Event. ${title}</span>`, title],
    ['6abe6719e06996003a8073b9', 'Featured Event. How Curators Choose Programmes', 'How Curators Choose Programmes'],
    ['6abe6719e06996003a8073be', 'Featured Event. Meet Juno', 'Meet Juno'],
    ['6abe6719e06996003a8073bf', 'Featured Event. Meet Nori Featured Event. Meet Nori', 'Meet Nori'],
    ['6abe6719e06996003a8073ba', 'Planning a Featured Event. A Practical Workshop', 'Planning a Featured Event. A Practical Workshop'],
    ['6abe6719e06996003a8073bb', 'Choir! Choir! Choir! presents Landslide', 'Choir! Choir! Choir! presents Landslide'],
    ['6abe6719e06996003a8073bc', 'A Full Workshop Featured Event. A Different Workshop', 'A Full Workshop Featured Event. A Different Workshop'],
    ['6abe6719e06996003a8073bd', 'Meet Juno Therapy Dog Meet Juno Therapy Dog', 'Meet Juno Therapy Dog'],
  ];
  const html = headings.map(([id, heading]) => `<li class="cp-events-search-result"><h3><a href="/v2/events/${id}">${heading}</a></h3><p>Sunday, October 25 on October 25, 2026, 2:00pm – 3:30pm</p><div>Central Library</div><p>Authors &amp; Writing</p></li>`).join('\n');
  const sourceURL = 'https://halifax.bibliocommons.com/v2/events';
  await writeFile(join(root, 'scripts/lib/fetch-public-source.mjs'), `
    import { appendFile } from 'node:fs/promises';
    export async function fetchGuardedSource(url) {
      await appendFile(${JSON.stringify(join(root, 'requests.log'))}, String(url)+'\\n');
      if (url !== ${JSON.stringify(sourceURL + '?page=1')}) throw new Error('Unexpected mock source request');
      return new Response(${JSON.stringify(html)}, { headers: { 'content-type': 'text/html' } });
    }
  `);
  await writeFile(join(root, 'data/event-source-supplements.json'), JSON.stringify({ sources: [
    { id: 'halifax-public-libraries', name: 'Halifax Public Libraries', kind: 'public_library_calendar', mode: 'bibliocommons_events', url: sourceURL, allowedLocations: { 'Central Library': 'Halifax' } },
    { id: 'blocked-library', name: 'Held library source', kind: 'public_library_calendar', mode: 'bibliocommons_events', url: 'https://blocked.example/events', enabled: false, disabledReason: 'http_403', accessReview: { lastAttemptAt: observedAt } },
  ] }));
  const unrelated = { ...published, id: 'unrelated', title: 'Untouched event', sourceId: 'other-source', eventUrl: 'https://example.test/other' };
  const held = { ...published, id: 'held-source-event', title: 'Retained accepted event', sourceId: 'blocked-library', eventUrl: 'https://blocked.example/events/retained' };
  await writeFile(join(root, 'data/build/city-events.json'), JSON.stringify({
    generatedAt: observedAt, range: { start: '2026-10-25T00:00:00.000Z', end: '2026-11-25T00:00:00.000Z' },
    events: [published, unrelated, held], sourceStats: [{ sourceId: 'blocked-library', status: 'blocked', observedAt }], failures: [],
  }));
  await writeFile(join(root, 'runner.mjs'), `
    const NativeDate = Date;
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [${JSON.stringify(refreshedAt)}])); }
      static now() { return NativeDate.parse(${JSON.stringify(refreshedAt)}); }
    };
    await import('./scripts/import-supplemental-city-events.mjs');
  `);
  let first;
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = spawnSync(process.execPath, [join(root, 'runner.mjs')], { cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, LIBRARY_EVENT_DELAY_MS: '0' } });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const output = JSON.parse(await readFile(join(root, 'data/build/city-events.json'), 'utf8'));
    assert.equal(output.events.length, headings.length + 2);
    const repaired = output.events.find(event => event.eventUrl === published.eventUrl);
    assert.equal(repaired.title, title);
    assert.equal(repaired.id, published.id, 'Display cleanup must not change the legacy title hash used by the published saved-event ID');
    assert.equal(repaired.startAt, published.startAt);
    assert.equal(repaired.endAt, published.endAt);
    assert.equal(repaired.observedAt, refreshedAt, 'Only genuinely mocked refreshed source evidence receives the fixture observation clock');
    for (const [id, , expected] of headings) assert.equal(output.events.find(event => event.eventUrl === `${sourceURL}/${id}`).title, expected);
    assert.deepEqual(output.events.find(event => event.id === unrelated.id), unrelated);
    assert.deepEqual(output.events.find(event => event.id === held.id), held, 'Held source evidence and original clocks survive unchanged');
    const durable = { ...published, id: 'older-canonical-saved-id', duplicateEventIds: ['older-saved-alias'] };
    const [reconciled] = preservePublishedEventIds([repaired], [durable]);
    assert.equal(reconciled.id, durable.id, 'Existing strict occurrence reconciliation preserves prior canonical IDs too');
    assert.deepEqual(new Set(reconciled.duplicateEventIds), new Set(['older-saved-alias', published.id]));
    assert.equal(reconciled.observedAt, refreshedAt, 'Identity reconciliation cannot restore the older source clock');
    assert.equal(preservePublishedEventIds([reconciled], [durable])[0].id, durable.id);
    const json = JSON.stringify(output);
    if (attempt === 0) first = json;
    else assert.equal(json, first, 'Repeated mocked imports are byte-stable under the same fixture clock');
    assert.deepEqual((await readFile(join(root, 'requests.log'), 'utf8')).trim().split('\n'), Array(attempt + 1).fill(sourceURL + '?page=1'), 'Only the approved mocked source is requested; held sources never run');
  }
  console.log('Library featured-title regression passed: actual importer, clean headings, durable IDs/aliases, unrelated and held evidence, and idempotent offline reruns.');
} finally { await rm(root, { recursive: true, force: true }); }
