import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { preservePublishedEventIds, dedupeCanonicalEvents } from './lib/canonical-event-dedupe.mjs';
import { reconcileFutureEventLosses } from './lib/event-refresh-safety.mjs';

// A missing optional ticket URL must not become the library's general calendar URL.
const supplementalImporter = await readFile(new URL('./import-supplemental-city-events.mjs',import.meta.url),'utf8');
const hashIdFunction = supplementalImporter.match(/^function hashId\([^\n]+\n/m)?.[0];
const supplementalEventIdFunction = supplementalImporter.match(/^function supplementalEventId\([\s\S]*?^\}/m)?.[0];
assert.ok(hashIdFunction && supplementalEventIdFunction, 'Supplemental event identity helpers must exist');
const identityContext = vm.createContext({ createHash: (await import('node:crypto')).createHash });
vm.runInContext(`${hashIdFunction}\n${supplementalEventIdFunction}`, identityContext);
const librarySource = { id: 'halifax-public-libraries' };
const libraryOccurrence = { title: 'Sharing Dance with Older Adults', startAt: '2026-11-03T14:00:00.000Z', venueName: 'Central Library' };
const olderDetail = 'https://halifax.bibliocommons.com/v2/events/6a73843fe700090faa68b99a';
const newerDetail = 'https://halifax.bibliocommons.com/v2/events/6ad90e29fee2d21deb24d6a9';
const legacyId = vm.runInContext('supplementalEventId(source, raw, eventUrl)', vm.createContext({ ...identityContext, source: librarySource, raw: libraryOccurrence, eventUrl: olderDetail }));
const olderId = vm.runInContext('supplementalEventId(source, raw, eventUrl)', vm.createContext({ ...identityContext, source: librarySource, raw: { ...libraryOccurrence, identityKey: olderDetail }, eventUrl: olderDetail }));
const newerId = vm.runInContext('supplementalEventId(source, raw, eventUrl)', vm.createContext({ ...identityContext, source: librarySource, raw: { ...libraryOccurrence, identityKey: newerDetail }, eventUrl: newerDetail }));
assert.notEqual(olderId, newerId, 'Distinct official library detail records cannot receive the same new ID');
assert.notEqual(olderId, legacyId, 'Library detail identity must disambiguate the legacy title/time seed');
assert.equal(vm.runInContext('supplementalEventId(source, raw, eventUrl)', vm.createContext({ ...identityContext, source: librarySource, raw: { ...libraryOccurrence, identityKey: olderDetail }, eventUrl: olderDetail })), olderId, 'Library detail IDs remain deterministic');
const absoluteUrlFunction = supplementalImporter.match(/^function absoluteUrl\(value, base\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(absoluteUrlFunction, 'Supplemental URL normalization function must exist');
const urlContext = vm.createContext({URL});
vm.runInContext(absoluteUrlFunction,urlContext);
for (const missing of ['undefined', 'null', '\'\'', '\'   \'']) {
  assert.equal(vm.runInContext(`absoluteUrl(${missing}, 'https://halifax.bibliocommons.com/v2/events')`,urlContext), null, 'Absent ticket link must remain unknown');
}
assert.equal(vm.runInContext("absoluteUrl('/tickets', 'https://example.org/calendar')",urlContext), 'https://example.org/tickets', 'Genuine relative ticket URLs still resolve');
assert.equal(vm.runInContext("absoluteUrl('https://tickets.example.org/show', 'https://example.org/calendar')",urlContext), 'https://tickets.example.org/show', 'Genuine absolute ticket URLs survive');
assert.equal(vm.runInContext("absoluteUrl('javascript:alert(1)', 'https://example.org/calendar')",urlContext), null, 'Non-web ticket protocols remain denied');

// The primary importer likewise must not fabricate ticket links when no offer exists.
const primaryImporter = await readFile(new URL('./import-city-events.mjs',import.meta.url),'utf8');
const primarySafeUrl = primaryImporter.match(/^function safeUrl\(value, base\) \{[\s\S]*?^\}/m)?.[0];
const primaryTicketExpression = primaryImporter.match(/^    ticketUrl: (\(raw\.ticketUrl[^\n]+),$/m)?.[1];
assert.ok(primarySafeUrl && primaryTicketExpression, 'Primary event normalization and ticket expression must exist');
const primaryUrlContext = vm.createContext({URL, source:{url:'https://www.halifaxpubliclibraries.ca/locations/bedford-public-library/'}, raw:{ticketUrl:null,website:null}});
vm.runInContext(primarySafeUrl,primaryUrlContext);
assert.equal(vm.runInContext(primaryTicketExpression,primaryUrlContext),null,'Missing library ticket must not become generic venue calendar');
primaryUrlContext.raw = {ticketUrl:'/register',website:null};
assert.equal(vm.runInContext(primaryTicketExpression,primaryUrlContext),'https://www.halifaxpubliclibraries.ca/register','Explicit primary-source ticket link remains valid');

const old = {id:'published', title:'Meet Juno Meet Juno', sourceKind:'official_library_location_calendar', sourceId:'library', eventUrl:'https://halifax.bibliocommons.com/events/6a8ddc4657c264087ad3ac1b', sourceUrl:'https://halifax.bibliocommons.com/events/6a8ddc4657c264087ad3ac1b', startAt:'2026-10-21T21:30:00Z', endAt:'2026-10-21T22:30:00Z', observedAt:'2026-10-20T12:00:00Z', duplicateEventIds:['historical-alias']};
const fresh = {...old, id:'new-title-hash',title:'Meet Juno', observedAt:'2026-10-21T12:00:00Z',duplicateEventIds:[]};
const untouchedOld = structuredClone(old), untouchedFresh = structuredClone(fresh);
for (const records of [[fresh], [fresh,{...fresh,id:'second-source'}], [{...fresh,id:'second-source'},fresh]]) {
  const result = preservePublishedEventIds(records,[old]);
  assert.equal(result.length,1);
  assert.equal(result[0].id,old.id);
  assert.equal(result[0].title,fresh.title);
  assert.equal(result[0].observedAt,fresh.observedAt,'Never replace fresh evidence clock');
  assert(result[0].duplicateEventIds.includes('new-title-hash'));
  assert(result[0].duplicateEventIds.includes('historical-alias'));
  assert(!result[0].duplicateEventIds.includes(old.id));
  assert.deepEqual(preservePublishedEventIds(result,[old]),result,'Repeated refresh is idempotent');
  assert.deepEqual(dedupeCanonicalEvents(result),result,'Release sanitation keeps ID');
}
assert.deepEqual(old,untouchedOld);assert.deepEqual(fresh,untouchedFresh);
for (const distinct of [{...fresh,startAt:'2026-10-22T21:30:00Z'}, {...fresh,eventUrl:'https://halifax.bibliocommons.com/events/abcdef'}, {...fresh,eventUrl:'https://halifax.bibliocommons.com/events'}, {...fresh,sourceKind:'unqualified'}]) {
  assert.equal(preservePublishedEventIds([distinct],[old])[0].id,distinct.id,'Distinct/unqualified events never borrow identity');
}
assert.throws(()=>preservePublishedEventIds([fresh],[old,{...old,id:'ambiguous'}]),/Ambiguous/);
assert.throws(()=>preservePublishedEventIds([fresh,{id:'other',duplicateEventIds:['published']}],[old]),/Conflicting/);
const sports = {id:'published-game',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-22T22:00:00Z',venueId:'scotiabank-centre-halifax'};
assert.equal(preservePublishedEventIds([{...sports,id:'fresh-game',title:'Halifax Mooseheads vs Rouyn-Noranda Huskies'}],[sports])[0].id,sports.id);
assert.equal(preservePublishedEventIds([{...sports,id:'other-venue',venueId:'different'}],[sports])[0].id,'other-venue');
const reconciled = reconcileFutureEventLosses({events:[fresh],sourceStats:[]},{events:[old]}, {now:Date.parse('2026-10-21T23:00:00Z')});
assert.equal(reconciled.payload.events[0].id,old.id,'Actual refresh path preserves ID even after occurrence ends');
assert.equal(reconcileFutureEventLosses({events:[],sourceStats:[]},{events:[old]}, {now:Date.parse('2026-10-21T23:00:00Z')}).payload.events.length,0,'No expired resurrection');

// Retained failed-source rows must not collide with fresh rows after reconciliation.
const futureOld = {...old, id:'prior-owner',duplicateEventIds:['collision'],startAt:'2026-10-22T21:30:00Z',endAt:'2026-10-22T22:30:00Z'};
assert.throws(()=>reconcileFutureEventLosses({events:[{...fresh,id:'collision',eventUrl:'https://halifax.bibliocommons.com/events/abcdef'}],sourceStats:[{sourceId:'library',status:'failed'}]},{events:[futureOld]}, {now:Date.parse('2026-10-21T23:00:00Z')}),/Conflicting event identity/);

// Exercise the exact browser helpers with disposable localStorage and events.
const source = await readFile(new URL('../app-event-pagination.js',import.meta.url),'utf8');
const helperSource = source.slice(source.indexOf('function readSavedCityEvents()'),source.indexOf('function persistSavedCityEvents()'));
let stored = JSON.stringify(['historical-alias','published','missing','ambiguous']);
const context = vm.createContext({cityEvents:[{id:'published',duplicateEventIds:['historical-alias','ambiguous']},{id:'other',duplicateEventIds:['ambiguous']},{id:'historical-alias-canonical',duplicateEventIds:['published']}],CITY_EVENT_SAVED_KEY:'test',localStorage:{getItem(){return stored;},setItem(){throw Error('Read must not write');}}});
vm.runInContext(helperSource,context);
assert.deepEqual([...vm.runInContext('readSavedCityEvents()',context)],['published','missing','ambiguous'],'Unique aliases resolve once; canonical precedence and ambiguous/unknown saves survive');
stored='{';assert.equal(vm.runInContext('readSavedCityEvents().size',context),0);
stored='null';assert.equal(vm.runInContext('readSavedCityEvents().size',context),0);
stored=JSON.stringify(['historical-alias']);
vm.runInContext('const saved = readSavedCityEvents(); saved.delete("published");',context);
assert.equal(vm.runInContext('saved.size',context),0,'Unsave canonical ID removes migrated alias save');

const workflow = await readFile(new URL('../.github/workflows/city-events-preview.yml',import.meta.url),'utf8');
// Inspect the actual job boundaries, not a matching phrase elsewhere in the file.
function assertCityWorkflow(text) {
  const prJob = text.match(/^  validate-pr:\n([\s\S]*?)(?=^  refresh-events:)/m)?.[1];
  const refreshJob = text.match(/^  refresh-events:\n([\s\S]*)$/m)?.[1];
  assert(prJob && refreshJob, 'Both validation and producer jobs must remain');
  const condition = job => job.match(/^    if: \$\{\{ (.*?) \}\}$/m)?.[1];
  assert.equal(condition(prJob), "github.event_name == 'pull_request' || github.event_name == 'push'");
  assert.equal(condition(refreshJob), "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");
  for (const event_name of ['pull_request', 'push', 'schedule', 'workflow_dispatch', 'workflow_run', 'pull_request_target', '', 'unknown']) {
    const github = { event_name };
    assert.equal(vm.runInNewContext(condition(prJob), { github }), ['pull_request', 'push'].includes(event_name));
    assert.equal(vm.runInNewContext(condition(refreshJob), { github }), ['schedule', 'workflow_dispatch'].includes(event_name));
  }
  assert.match(prJob, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(prJob, /import-city-events|import-supplemental|upload-artifact|promote-|coordinate-preview|dispatch|permissions:|\bwrite\b|ref: main/,
    'Validation must not collect, upload, promote, dispatch, or acquire write permissions');
  const tests = ['reviewed-event-locations', 'event-identity-continuity', 'event-refresh-safety', 'reviewed-event-quarantine', 'event-refresh-dedupe', 'canonical-event-dedupe', 'library-event-boundaries', 'event-title-categories', 'robots-policy', 'robots-policy-adapters', 'preview-coordinator'];
  const steps = prJob.split(/^      - /m).slice(1);
  const runSteps = steps.filter(step => /^        run:/m.test(step));
  assert.equal(runSteps.length, 1, 'All validation commands share one transport-denied step');
  assert.match(runSteps[0], /env:\n          NODE_OPTIONS: --import \$\{\{ github.workspace \}\}\/scripts\/lib\/deny-source-network.mjs\n        run: \|/);
  assert.deepEqual(runSteps[0].split('        run: |\n')[1].trim().split('\n').map(line => line.trim()),
    tests.map(name => `node scripts/test-${name}.mjs`), 'No unguarded commands or missing validation suites');
  const paths = ['scripts/lib/robots-policy.mjs', 'scripts/lib/fetch-public-source.mjs', 'source-integrity.js', 'scripts/lib/deny-source-network.mjs', 'scripts/test-robots-policy.mjs', 'scripts/test-robots-policy-adapters.mjs', '.github/workflows/promote-preview-artifacts.yml', 'scripts/test-preview-coordinator.mjs', 'scripts/lib/preview-coordinator.mjs'];
  for (const trigger of ['push', 'pull_request']) {
    const block = text.match(new RegExp(`^  ${trigger}:\\n([\\s\\S]*?)(?=^  \\w|^permissions:)`, 'm'))?.[1];
    assert(block, `${trigger} trigger exists`);
    for (const path of paths) assert(block.includes(`      - ${path}\n`), `${trigger} covers ${path}`);
  }
  assert(text.includes('cron: "23 */6 * * *"'));
  for (const bound of ['timeout-minutes: 30', 'CITY_EVENT_TIMEOUT_MS: 15000', 'SUPPLEMENTAL_EVENT_TIMEOUT_MS: 15000', 'LIBRARY_EVENT_PAGE_LIMIT: 150', 'LIBRARY_EVENT_DELAY_MS: 100', 'CITY_EVENT_ANOMALY_MIN_PRIOR_COUNT: 20', 'CITY_EVENT_ANOMALY_MAX_SNAPSHOT_AGE_DAYS: 3', 'CITY_EVENT_ANOMALY_CARRY_DAYS: 7']) assert(refreshJob.includes(bound), `Preserve producer bound ${bound}`);
  assert.match(refreshJob, /name: Checkout\n        uses: actions\/checkout@v6\n\n/);
  assert(refreshJob.indexOf('Verify saved-event continuity before preview upload') >= 0);
  assert(refreshJob.indexOf('Verify saved-event continuity before preview upload') < refreshJob.indexOf('Upload city event preview'));
  assert(refreshJob.includes('node scripts/check-event-identity-continuity.mjs /tmp/city-events.previous.json'));
  assert.match(refreshJob, /name: city-events-preview\n/);
  assert.match(refreshJob, /name: Preserve event refresh diagnostics\n        if: always\(\)\n        uses: actions\/upload-artifact@v4\n        with:\n          name: city-events-refresh-diagnostics/);
  assert.equal((refreshJob.match(/uses: actions\/upload-artifact@v4/g) || []).length, 2);
}
assertCityWorkflow(workflow);
// Negative controls prove these assertions reject the former push-collection route,
// moving-head validation and loss of transport denial without editing real files.
for (const [label, from, to] of [
  ['push collects', "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'", "github.event_name != 'pull_request'"],
  ['push unvalidated', "github.event_name == 'pull_request' || github.event_name == 'push'", "github.event_name == 'pull_request'"],
  ['moving head', 'github.event.pull_request.head.sha || github.sha', "'main'"],
  ['transport denial removed', 'NODE_OPTIONS: --import', 'DISABLED_NODE_OPTIONS: --import'],
  ['adapter suite removed', '          node scripts/test-robots-policy-adapters.mjs\n', ''],
  ['unexpected collection command', '          node scripts/test-robots-policy.mjs', '          node scripts/import-city-events.mjs']
]) {
  assert(workflow.includes(from), `Mutation target exists: ${label}`);
  assert.throws(() => assertCityWorkflow(workflow.replace(from, to)), undefined, `Mutation rejected: ${label}`);
}
console.log('Event identity continuity passed: source/title ordering, repeated refresh, unique occurrence matching, collision hold, saved alias migration, expiry and offline PR/push/producer gates.');
