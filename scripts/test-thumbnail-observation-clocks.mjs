import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repository = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "halifax-thumbnail-clocks-"));
const clocks = ["2026-10-23T12:00:00.000Z", "2026-11-01T12:00:00.000Z"];
const oldObservation = "2020-01-02T03:04:05Z"; // Preserve the actual spelling, not just the instant.
const json = async (directory, file) => JSON.parse(await readFile(join(directory, file), "utf8"));
const put = (directory, file, value) => writeFile(join(directory, file), JSON.stringify(value, null, 2));
const plain = value => JSON.parse(JSON.stringify(value));
async function windowPayload(directory, file, name) {
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(directory, file), "utf8"), context, { timeout: 20_000 });
  return plain(context.window[name]);
}
async function copyRuntime(directory, full = false) {
  await mkdir(directory, { recursive: true });
  await cp(join(repository, "scripts"), join(directory, "scripts"), { recursive: true });
  if (full) {
    for (const folder of ["data", "assets"]) await cp(join(repository, folder), join(directory, folder), { recursive: true });
    for (const file of await readdir(repository)) if (file.endsWith(".js")) await cp(join(repository, file), join(directory, file));
  } else {
    for (const file of ["app-media.js", "source-integrity.js"]) await cp(join(repository, file), join(directory, file));
  }
  for (const folder of ["data/build", "docs", "artifacts"]) await mkdir(join(directory, folder), { recursive: true });
  if (!full) await cp(join(repository, "data/source-link-access-holds.json"), join(directory, "data/source-link-access-holds.json"));
}
const guard = join(root, "clock-and-transport-guard.mjs");
function run(directory, script, clock, extraEnv = {}, expected = 0) {
  const result = spawnSync(process.execPath, ["--import", join(directory, "scripts/lib/deny-source-network.mjs"), "--import", guard, script], {
    cwd: directory, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "", TZ: "UTC", THUMBNAIL_TEST_CLOCK: clock,
      THUMBNAIL_DISCOVERY_FETCH: "0", THUMBNAIL_IMAGE_PROBE: "0", THUMBNAIL_PROMOTION_APPLY: "0", ...extraEnv }
  });
  assert.equal(result.status, expected, `${script}: ${result.error || ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}
async function build(directory, clock, script = "scripts/build-thumbnail-candidates.mjs", env = {}) {
  run(directory, script, clock, env);
  const payload = await json(directory, "data/build/thumbnail-candidates.json");
  assert.equal(payload.generatedAt, clock, "The build receipt must still advance.");
  assert.deepEqual(await windowPayload(directory, "data/thumbnail-candidates.js", "HALIFAX_THUMBNAIL_CANDIDATES"), payload,
    "Actual browser JS and JSON must contain the same nullable observations.");
  return payload;
}
function withoutBuildReceipt({ generatedAt, ...payload }) { return payload; }
async function sqliteRows(directory, payload) {
  const imported = spawnSync("python3", ["scripts/import-thumbnail-candidates-to-sqlite.py"], { cwd: directory, encoding: "utf8", timeout: 60_000 });
  assert.equal(imported.status, 0, imported.stdout + imported.stderr);
  const queried = spawnSync("python3", ["-c", `import json, sqlite3
c = sqlite3.connect('file:data/build/halifax_sourced.sqlite?mode=ro', uri=True)
c.execute('pragma query_only=on')
c.row_factory = sqlite3.Row
print(json.dumps({'columns': [dict(r) for r in c.execute('pragma table_info(thumbnail_candidates)')], 'rows': [dict(r) for r in c.execute('select * from thumbnail_candidates order by id')]}))`], { cwd: directory, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(queried.status, 0, queried.stderr);
  const output = JSON.parse(queried.stdout);
  assert.equal(output.columns.length, 22);
  assert.equal(output.columns.find(column => column.name === "observed_at").notnull, 0);
  assert.equal(output.rows.length, payload.candidates.length);
  for (const row of output.rows) {
    assert.equal(row.observed_at, payload.candidates.find(candidate => candidate.id === row.id).observedAt, row.id);
  }
  return output.rows;
}
async function checkDownstream(directory, payload, clock) {
  for (const script of ["check-thumbnail-candidates.mjs", "build-thumbnail-coverage-report.mjs"]) run(directory, `scripts/${script}`, clock);
  const coverage = await json(directory, "data/build/thumbnail-coverage-report.json");
  for (const candidate of coverage.queues.reviewCandidates) {
    assert.equal(candidate.observedAt, payload.candidates.find(row => row.id === candidate.id).observedAt);
  }
  return coverage;
}
async function homeResult(payload, restaurants, obsoleteRenderer = null) {
  let rendered = "";
  const context = vm.createContext({ window: { HALIFAX_THUMBNAIL_CANDIDATES: payload, addEventListener() {} },
    activeRestaurants: restaurants.map(({ id, name }) => ({ id, name })),
    renderHome() { rendered = ""; }, recentOfficialPosts: [], currentStructuredSpecial: () => false,
    restaurantCard: restaurant => `<article>${restaurant.id}</article>`,
    appView: { insertAdjacentHTML(position, markup) { assert.equal(position, "beforeend"); rendered += markup; } },
    bindCommonActions() {}, structuredEvents: [], globalSearch: null, searchForm: null,
    localStorage: { getItem() { return "[]"; }, setItem() { assert.fail("Home rendering must not write saved decisions."); } }
  });
  // Exercise actual scripts in document order, including the later home override.
  // Peripheral browser hooks are inert; renderer and date helpers are not copied.
  const runtimeFiles = ["app-home-rich.js", "app-events.js", "app-event-pagination.js", "app-event-date-fixes.js", "app-event-local-sort-fixes.js"];
  const document = await readFile(join(repository, "index.html"), "utf8");
  const documentScripts = [...document.matchAll(/<script\b[^>]*\bsrc="\.\/([^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
  assert.deepEqual(documentScripts.filter(file => runtimeFiles.includes(file)), runtimeFiles,
    "The regression must follow the actual home/event override load order.");
  let selected, baseRenderer;
  for (const file of runtimeFiles) {
    let source = await readFile(join(repository, file), "utf8");
    if (file === obsoleteRenderer) {
      const mutated = source.replace(">Approved restaurant photos<", ">New thumbnails added<");
      assert.notEqual(mutated, source, "Heading mutation target must exist: " + file);
      source = mutated;
    }
    vm.runInContext(source, context, { filename: file, timeout: 20_000 });
    if (file === "app-home-rich.js") baseRenderer = context.homeRichSections;
    if (file === "app-event-date-fixes.js") assert.notEqual(context.homeRichSections, baseRenderer, "The actual later renderer must be installed.");
    if (!["app-home-rich.js", "app-event-date-fixes.js", "app-event-local-sort-fixes.js"].includes(file)) continue;
    const currentSelection = plain(context.approvedThumbnailRestaurants(100)).map(restaurant => restaurant.id);
    if (selected) assert.deepEqual(currentSelection, selected, "Runtime overrides must preserve thumbnail selection.");
    else selected = currentSelection;
    const markup = context.homeRichSections();
    assert(!markup.includes("New thumbnails added"), `${file}: Observation date is not photo addition date.`);
    if (selected.length) {
      assert(markup.includes("Approved restaurant photos"), file + ": Accurate photo label must render.");
      assert(markup.includes("Restaurants with approved images"));
      for (const id of selected.slice(0, 4)) assert(markup.includes(`<article>${id}</article>`), file + ": Photo cards must remain selected.");
    }
    context.renderHome();
    assert.equal(rendered, markup, file + ": The renderHome wrapper must use the current runtime renderer.");
  }
  return selected;
}
async function assertDecisionClock(payload) {
  const RealDate = Date;
  const context = { window: {}, URL, safeImageUrl: value => value, safeUrl: value => value,
    Date: class extends RealDate { constructor(...args) { super(...(args.length ? args : [clocks[1]])); } } };
  vm.runInNewContext(await readFile(join(repository, "app-admin.js"), "utf8"), context);
  for (const candidate of payload.candidates) {
    const decision = context.thumbnailDecisionPayload(candidate, "reject_thumbnail");
    assert.equal(decision.observedAt, candidate.observedAt);
    assert.equal(decision.decidedAt, clocks[1], "Decision time is separate from observation time.");
  }
}
async function protectedInputHashes(directory) {
  const output = {};
  async function walk(relative) {
    for (const item of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = join(relative, item.name);
      if (item.isDirectory()) await walk(path);
      else if (!["data/build/thumbnail-candidates.json", "data/thumbnail-candidates.js", "data/build/halifax_sourced.sqlite",
        "data/build/thumbnail-coverage-report.json", "data/build/thumbnail-source-check-queue.csv", "data/build/thumbnail-source-check-queue.json",
        "data/build/owner-media-outreach.csv", "data/build/owner-media-outreach.json"].includes(path)) {
        output[path] = createHash("sha256").update(await readFile(join(directory, path))).digest("hex");
      }
    }
  }
  for (const folder of ["data", "assets"]) await walk(folder);
  return output;
}

try {
  // The shared preload blocks fetch/http/https/net and fails even when a caller
  // swallows the error. Also close TLS, UDP, DNS, WebSocket and child-process exits.
  await writeFile(guard, `import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
const deny = () => { attempts++; throw Error('thumbnail_fixture_transport_denied'); };
globalThis.WebSocket = deny;
for (const [target, names] of [[tls,['connect']], [dgram,['createSocket']],
  [dns,['lookup','resolve','resolve4','resolve6','reverse']], [dns.promises,['lookup','resolve','resolve4','resolve6','reverse']],
  [childProcess,['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork']]]) {
  for (const name of names) target[name] = deny;
}
syncBuiltinESMExports();
process.on('exit', () => { if (attempts) process.exitCode = 1; });
const RealDate = Date, now = RealDate.parse(process.env.THUMBNAIL_TEST_CLOCK);
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
`);
  const fixture = join(root, "families");
  await copyRuntime(fixture);
  await writeFile(join(fixture, "deny-probe.mjs"), 'try { await fetch("https://fixture.example/unexpected"); } catch {}');
  run(fixture, "deny-probe.mjs", clocks[0], {}, 1);
  const media = await windowPayload(repository, "data/restaurant-media.js", "HALIFAX_RESTAURANT_MEDIA");
  const references = await windowPayload(repository, "data/restaurant-media-references.js", "HALIFAX_MEDIA_SOURCE_REFERENCES");
  const inputs = { approved: [], recent: [], feed: [], api: [], specials: [], directory: [], resolutions: [], owners: [], references: [], retained: [] };
  const expected = new Map();
  const restaurants = [];
  const variants = [{ name: "missing" }, { name: "null", observedAt: null }, { name: "empty", observedAt: "" }, { name: "old", observedAt: oldObservation }];
  const unrelated = { generatedAt: clocks[0], publishedAt: clocks[0], sourceUpdatedAt: clocks[0], reviewedAt: clocks[0], assessedAt: clocks[0], captureDate: "2019-05-06" };
  for (const family of ["approved", "recent", "feed", "api", "special", "failed-special", "directory", "owner", "reference", "retained", "research"]) {
    for (const { name, ...observation } of variants) {
      const id = `${family}-${name}`;
      const sourceUrl = `https://fixture.example/${id}`;
      const image = `https://fixture.example/${id}.jpg`;
      const record = { ...unrelated, ...observation, restaurantId: id, restaurantName: id, sourceUrl,
        ...(!["approved", "reference"].includes(family) ? { rights: { verifiedAt: clocks[0] } } : {}) };
      restaurants.push({ id, name: id, website: "https://fixture.example/" });
      expected.set(id, observation.observedAt || null);
      if (family === "approved") inputs.approved.push({ ...media.records[0], ...record, url: `assets/restaurants/${id}.jpg` });
      if (["recent", "feed", "api"].includes(family)) inputs[family].push({ ...record, postUrl: sourceUrl, thumbnailUrl: image,
        platform: family === "api" ? "facebook" : family === "recent" ? "official_page" : "rss",
        sourceFamily: family === "api" ? "social_api" : family === "recent" ? "website_page" : "website_feed" });
      if (family === "special" || family === "failed-special") inputs.specials.push({ ...record, sourceImageUrl: image,
        ...(family === "failed-special" ? { refreshState: "retained_after_failure", sourceFailure: { reason: "http_503", observedAt: clocks[0] } } : {}) });
      if (family === "directory") {
        inputs.directory.push({ ...record, id, name: id, sourceImageUrl: image });
        inputs.resolutions.push({ candidateId: id, state: "resolved_exact", matchedRestaurantId: id });
      }
      if (family === "owner") inputs.owners.push({ ...record, name: id, images: [{ url: image, sourceUrl, permissionConfirmed: false }] });
      if (family === "reference") inputs.references.push({ ...references.records[0], ...record, url: image });
      if (family === "retained" || family === "research") inputs.retained.push({ ...record, thumbnailUrl: image,
        sourceKind: family === "research" ? "verified_open_license_research" : "official_page_thumbnail_candidate",
        extractionMethod: "retained_fixture", reviewState: name === "empty" ? "rejected" : name === "null" ? "source_check" : "candidate_review",
        rightsStatus: name === "empty" ? "rejected" : "requires_rights_review", confidence: "fixture" });
    }
  }
  // Approved/reference manifests prohibit rights objects as conflicting aliases.
  // Their separate assessment clocks must not be joined into observations either.
  await put(fixture, "data/thumbnail-assessments.json", { assessments: restaurants.map(restaurant => ({ restaurantId: restaurant.id, assessedAt: clocks[0], rights: { verifiedAt: clocks[0] } })) });
  await put(fixture, "data/build/catalog.json", { restaurants });
  for (const [name, value] of [
    ["recent-social-posts", { records: inputs.recent }], ["website-feed-signals", { posts: inputs.feed }], ["social-signals", { posts: inputs.api }],
    ["public-special-source-leads", { records: inputs.specials }], ["directory-restaurant-leads", { records: inputs.directory }],
    ["place-source-resolutions", { resolutions: inputs.resolutions }], ["owner-submissions.normalized", { submissions: inputs.owners }],
    ["thumbnail-candidates", { candidates: inputs.retained, failures: [] }]
  ]) await put(fixture, `data/build/${name}.json`, value);
  await writeFile(join(fixture, "data/restaurant-media.js"), `window.HALIFAX_RESTAURANT_MEDIA = ${JSON.stringify({ records: inputs.approved })};`);
  await writeFile(join(fixture, "data/restaurant-media-references.js"), `window.HALIFAX_MEDIA_SOURCE_REFERENCES = ${JSON.stringify({ records: inputs.references })};`);
  let first, firstSql, firstCoverage, firstHome;
  for (const clock of clocks) {
    const payload = await build(fixture, clock);
    assert.equal(payload.candidates.length, expected.size, "Every projection family and clock variant must reach actual output.");
    for (const candidate of payload.candidates) {
      assert.equal(candidate.observedAt, expected.get(candidate.restaurantId), candidate.restaurantId);
      if (candidate.restaurantId.startsWith("failed-special")) {
        assert.equal(candidate.refreshState, "retained_after_failure");
        assert.deepEqual(candidate.sourceFailure, { reason: "http_503", observedAt: clocks[0] });
      }
    }
    const sql = await sqliteRows(fixture, payload);
    const coverage = await checkDownstream(fixture, payload, clock);
    const home = await homeResult(payload, restaurants);
    if (first) {
      assert.deepEqual(withoutBuildReceipt(payload), withoutBuildReceipt(first), "No candidate field may drift between offline clocks.");
      assert.deepEqual(sql, firstSql, "All 22 SQLite columns, including observed_at, must be stable.");
      assert.deepEqual(withoutBuildReceipt(coverage), withoutBuildReceipt(firstCoverage));
      assert.deepEqual(home, firstHome);
    } else { first = payload; firstSql = sql; firstCoverage = coverage; firstHome = home; }
    assert.equal(home[0], "approved-old", "Known source observations still sort ahead of unknown clocks.");
    assert.deepEqual(home.slice(1), ["approved-empty", "approved-missing", "approved-null"], "Unknown clocks preserve stable input order.");
  }
  for (const renderer of ["app-home-rich.js", "app-event-date-fixes.js"]) {
    await assert.rejects(homeResult(first, restaurants, renderer), /Observation date is not photo addition date/,
      "Reverting either actual renderer label must fail the offline regression: " + renderer);
  }
  await assertDecisionClock(first);

  // Finite fake page responses still go through the production source guard and
  // entrypoint. Unknown URLs, duplicate requests and image requests fail the test.
  const live = join(root, "successful-fetch");
  await copyRuntime(live);
  const liveRestaurants = ["success", "duplicate", "http-failure", "body-failure", "fetch-failure"].map(id => ({ id, name: id, website: `https://${id}.fixture.example/` }));
  await put(live, "data/build/catalog.json", { restaurants: liveRestaurants });
  const retained = liveRestaurants.slice(1).map((restaurant, index) => ({ restaurantId: restaurant.id, restaurantName: restaurant.name,
    thumbnailUrl: `${restaurant.website}photo.jpg`, sourceUrl: restaurant.website, sourceKind: "official_page_thumbnail_candidate",
    extractionMethod: "retained_fixture", reviewState: "candidate_review", rightsStatus: "requires_rights_review", confidence: "fixture", observedAt: index % 2 ? null : oldObservation }));
  await put(live, "data/build/thumbnail-candidates.json", { candidates: retained, failures: [] });
  await writeFile(join(live, "mock-fetch.mjs"), `import assert from 'node:assert/strict';
const expected = ${JSON.stringify(liveRestaurants.map(row => row.website))};
const requests = [], unexpected = [];
globalThis.fetch = async input => {
  const url = String(input); requests.push(url);
  if (!expected.includes(url) || requests.filter(value => value === url).length !== 1) { unexpected.push(url); throw Error('unexpected fixture request'); }
  if (url.includes('fetch-failure')) throw Error('fixture_fetch_failure');
  if (url.includes('http-failure')) return new Response('Unavailable', {status:503});
  if (url.includes('body-failure')) return {ok:true, status:200, url, text:async()=>{throw Error('fixture_body_failure');}};
  return new Response('<meta property="og:image" content="' + url + 'photo.jpg">', {status:200});
};
try { await import('./scripts/build-thumbnail-candidates.mjs'); }
finally { assert.deepEqual(unexpected, []); assert.deepEqual(requests, expected); }
`);
  const liveBuild = await build(live, clocks[0], "mock-fetch.mjs", { THUMBNAIL_DISCOVERY_FETCH: "1", THUMBNAIL_IMAGE_PROBE: "0",
    THUMBNAIL_DISCOVERY_SCOPE: "all", THUMBNAIL_DISCOVERY_PAGE_LIMIT: "5", THUMBNAIL_DISCOVERY_PAGES_PER_RESTAURANT: "1", THUMBNAIL_DISCOVERY_SUBPAGE_LIMIT: "0", THUMBNAIL_DISCOVERY_DELAY_MS: "0" });
  assert.equal(liveBuild.candidates.length, 5);
  assert.equal(liveBuild.candidates.find(row => row.restaurantId === "success").observedAt, clocks[0]);
  for (const candidate of retained) assert.equal(liveBuild.candidates.find(row => row.restaurantId === candidate.restaurantId).observedAt, candidate.observedAt);
  assert.equal(liveBuild.candidates.filter(row => row.restaurantId === "duplicate").length, 1, "First-wins deduplication remains unchanged.");
  assert.deepEqual(liveBuild.failures.map(row => row.reason), ["http_503", "fixture_body_failure", "fixture_fetch_failure"]);
  const offlineBuild = await build(live, clocks[1]);
  assert.deepEqual(offlineBuild.candidates, liveBuild.candidates, "Later offline build preserves genuine successful observations and failed-source history.");
  assert.deepEqual(offlineBuild.failures, liveBuild.failures);

  // Use normal accepted-input prerequisites, not stale checked-in build outputs.
  const accepted = join(root, "accepted-inputs");
  await copyRuntime(accepted, true);
  for (const script of ["export-catalog.mjs", "resolve-place-candidates.mjs", "build-recent-social-posts.mjs", "build-reviewed-social-posts.mjs"])
    run(accepted, `scripts/${script}`, clocks[0]);
  const sourceHashes = await protectedInputHashes(accepted);
  const catalog = await json(accepted, "data/build/catalog.json");
  const beforeCandidates = await json(accepted, "data/build/thumbnail-candidates.json");
  const firstAccepted = await build(accepted, clocks[0]);
  const firstAcceptedSql = await sqliteRows(accepted, firstAccepted);
  const firstAcceptedCoverage = await checkDownstream(accepted, firstAccepted, clocks[0]);
  const secondAccepted = await build(accepted, clocks[1]);
  assert.deepEqual(withoutBuildReceipt(secondAccepted), withoutBuildReceipt(firstAccepted));
  assert.deepEqual(await sqliteRows(accepted, secondAccepted), firstAcceptedSql);
  assert.deepEqual(withoutBuildReceipt(await checkDownstream(accepted, secondAccepted, clocks[1])), withoutBuildReceipt(firstAcceptedCoverage));
  assert.deepEqual(await protectedInputHashes(accepted), sourceHashes, "Offline thumbnail work must not alter any accepted input, asset, permission or source clock.");
  const mediaById = new Map(media.records.map(record => [record.restaurantId, record]));
  for (const candidate of secondAccepted.candidates.filter(row => row.sourceKind === "approved_restaurant_media")) {
    assert.equal(candidate.observedAt, mediaById.get(candidate.restaurantId).observedAt || null, "Approved projections cannot borrow assessment/research clocks.");
  }
  const reviewedResearch = await json(accepted, "data/reviewed-photo-research-candidates.json");
  for (const candidate of [...beforeCandidates.candidates, ...reviewedResearch.candidates].filter(row => row.sourceKind === "verified_open_license_research")) {
    assert.deepEqual(secondAccepted.candidates.find(row => row.id === candidate.id), candidate, "Existing research evidence must remain byte-for-byte stable.");
  }
  assert.deepEqual(await homeResult(firstAccepted, catalog.restaurants), await homeResult(secondAccepted, catalog.restaurants));
  console.log(`Thumbnail observation clocks passed: ${expected.size} projection fixtures at two clocks; finite successful/duplicate/failed fetches; JSON/JS, SQLite, coverage, review decisions and actual home override rendering (both label mutation controls); ${secondAccepted.candidates.length} accepted candidates with unchanged source/rights inputs. No outbound source or image transport.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
