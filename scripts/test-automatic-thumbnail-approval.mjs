import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assessThumbnail, approveEligibleThumbnails, jpegDimensions, reconcileAutomaticMediaPriority } from './lib/automatic-thumbnail-approval.mjs';

const root = await mkdtemp(join(tmpdir(), 'thumbnail-test-'));
try {
  const assetPath = 'assets/restaurants/review-fixture.jpg';
  const bytes = await readFile(new URL('../assets/restaurants/your-fathers-moustache.jpg', import.meta.url));
  await mkdir(join(root, 'assets/restaurants'), { recursive: true });
  await writeFile(join(root, assetPath), bytes);
  const dimensions = jpegDimensions(bytes);
  assert.ok(dimensions?.width >= 300);
  const restaurant = { id: 'fixture-place', operatingStatus: 'active', address: '123 Fixture Street, Halifax' };
  const candidate = { id: 'fixture-candidate', restaurantId: restaurant.id, thumbnailUrl: 'https://example.test/photo.jpg', sourceUrl: 'https://example.test/location', reviewState: 'candidate_review', rightsStatus: 'requires_rights_review', permissionConfirmed: false, qualityFlags: [] };
  // Synthetic test evidence is never written to the production assessment file.
  const evidence = {
    candidateId: candidate.id, restaurantId: restaurant.id, thumbnailUrl: candidate.thumbnailUrl, sourceUrl: candidate.sourceUrl,
    assessedAt: '2026-10-20T12:00:00Z', assessedBy: 'Automated fixture assessor', assetPath,
    alt: 'Fixture restaurant exterior on Fixture Street in Halifax',
    location: { verified: true, operatingStatus: 'active', restaurantId: restaurant.id, address: restaurant.address, sourceUrl: candidate.sourceUrl, notes: 'Synthetic exact-location test evidence' },
    visual: { inspected: true, verdict: 'usable', sha256: createHash('sha256').update(bytes).digest('hex'), ...dimensions, notes: 'Synthetic decoded-image test evidence' },
    rights: { verified: true, permissionConfirmed: true, localReproductionPermitted: true, conditionsSatisfied: true, usageConditions: 'Fixture attribution and share-alike conditions satisfied.', evidenceUrl: 'https://example.test/license', verifiedAt: '2026-10-20T12:00:00Z', notes: 'Synthetic explicit licence test evidence', sourceType: 'licensed', permission: 'licensed', creator: 'Fixture photographer', license: 'CC BY-SA 2.0', rightsBasis: 'Fixture CC BY-SA 2.0 grant', attribution: 'Fixture photographer, CC BY-SA 2.0' }
  };
  const assess = (c = candidate, e = evidence, r = restaurant) => assessThumbnail(c, e, r, root);
  assert.deepEqual((await assess()).reasons, []);
  assert.ok((await assess(candidate, null)).reasons.includes('missing_verified_assessment'));
  for (const mutate of [
    e => { e.visual.inspected = false; }, e => { e.visual.sha256 = '0'.repeat(64); },
    e => { e.visual.width = 999; }, e => { e.visual.verdict = 'mismatch'; },
    e => { e.location.operatingStatus = 'unknown'; }, e => { e.location.address = 'Different branch'; }, e => { e.location.restaurantId = 'other'; },
    e => { e.rights.localReproductionPermitted = false; }, e => { e.rights.conditionsSatisfied = false; }, e => { e.rights.expiresAt = '2020-01-01'; }, e => { e.assessedAt = '2099-01-01'; },
    e => { e.rights.verified = false; }, e => { e.rights.permissionConfirmed = false; },
    e => { delete e.rights.sourceType; e.rights.permissionSource = 'licensed'; }, e => { delete e.rights.license; e.rights.licence = 'CC BY-SA 2.0'; }, e => { e.rights.reviewState = 'unverified'; },
    e => { e.rights.usageRights = 'denied'; }, e => { e.rights.ownerApproved = false; }, e => { e.rights.rightsState = 'unverified'; }, e => { e.rights.licence = 'restricted'; }, e => { e.rights.reviewState = 'REJECTED'; },
    e => { e.rights.attribution = ''; }, e => { e.rights.license = 'unknown'; },
    e => { e.sourceUrl = 'https://example.test/other'; }, e => { e.thumbnailUrl += '?changed'; },
    e => { e.assetPath = '../escape.jpg'; }, e => { e.assetPath = 'https://example.test/mutable.jpg'; }
  ]) { const changed = structuredClone(evidence); mutate(changed); assert.ok((await assess(candidate, changed)).reasons.length); }
  for (const change of [ { recordKind: 'source_reference' }, { reviewState: 'rejected' }, { reviewState: 'source_check' }, { qualityFlags: ['tiny_decoded_image'] }, { rightsStatus: ' denied ' }, { reviewStatus: 'rejected' }, { reviewState: 'REJECTED' }, { usageRights: 'denied' }, { license: 'restricted' }, { quarantined: true } ]) assert.ok((await assess({ ...candidate, ...change })).reasons.length);
  assert.ok((await assess(candidate, evidence, { ...restaurant, operatingStatus: 'permanently_closed' })).reasons.length);
  assert.ok((await assessThumbnail(candidate, evidence, null, root)).reasons.includes('not_active_exact_location'));
  const input = { candidates: [candidate], assessments: [evidence], restaurants: [restaurant], media: [], root };
  const approved = await approveEligibleThumbnails(input);
  assert.equal(approved.records.length, 1); assert.equal(approved.report.counts.automaticallyApproved, 1);
  assert.equal(approved.records[0].attribution, evidence.rights.attribution);
  const referenceQueue = { targetCount: 1, records: [{ restaurantId: restaurant.id, name: 'Fixture', status: 'rights_review_required', rightsState: 'unverified' }] };
  const reconciled = reconcileAutomaticMediaPriority(referenceQueue, approved.records, [restaurant]);
  assert.equal(reconciled.records[0].status, 'approved'); assert.equal(reconciled.records[0].rightsState, 'unverified');
  assert.deepEqual(reconcileAutomaticMediaPriority(reconciled, [], [restaurant]), referenceQueue);
  const emptyQueue = { targetCount: 0, records: [] };
  assert.deepEqual(reconcileAutomaticMediaPriority(reconcileAutomaticMediaPriority(emptyQueue, approved.records, [restaurant]), [], [restaurant]), emptyQueue);
  const rerun = await approveEligibleThumbnails({ ...input, media: approved.records });
  assert.deepEqual(rerun.records, approved.records);
  const rejectedCopy = { ...candidate, id: 'local-copy', thumbnailUrl: './' + assetPath, reviewState: 'rejected' };
  const relatedHold = await approveEligibleThumbnails({ ...input, candidates: [candidate, rejectedCopy], media: approved.records });
  assert.equal(relatedHold.records.length, 0);
  assert.equal((await approveEligibleThumbnails({ ...input, candidates: [candidate, { ...rejectedCopy, reviewState: 'approved', qualityFlags: ['reviewed_rejected_wrong_location'] }], media: approved.records })).records.length, 0);
  const withdrawn = await approveEligibleThumbnails({ ...input, assessments: [], media: approved.records });
  assert.equal(withdrawn.records.length, 0); assert.equal(withdrawn.report.counts.withdrawnAutomaticMedia, 1);
  const legacy = { ...approved.records[0] }; delete legacy.approvalMethod;
  const preserved = await approveEligibleThumbnails({ ...input, candidates: [], assessments: [], media: [legacy] });
  assert.deepEqual(preserved.records, [legacy]);
  await assert.rejects(approveEligibleThumbnails({ ...input, assessments: [evidence, evidence] }), /unique/);
  await writeFile(join(root, assetPath), Buffer.concat([bytes, Buffer.from('changed')]));
  assert.ok((await assess()).reasons.includes('inspected_bytes_changed'));
  assert.throws(() => execFileSync(process.execPath, ['scripts/plan-thumbnail-coverage-attack.mjs'], { env: { ...process.env, THUMBNAIL_PROMOTION_APPLY: '1' }, stdio: 'pipe' }), /Metadata-only thumbnail promotion is disabled/);

  // Exercise the real builder -> publisher -> builder -> existing validators,
  // including a place with a retained historical reference. No test evidence
  // or fixtures ever enter the source checkout or published manifest.
  const integration = join(root, 'integration');
  const repository = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(integration);
  for (const folder of ['scripts', 'data', 'assets']) await cp(join(repository, folder), join(integration, folder), { recursive: true });
  for (const file of await readdir(repository)) if (file.endsWith('.js')) await cp(join(repository, file), join(integration, file));
  const run = script => execFileSync(process.execPath, [script], { cwd: integration, env: { ...process.env, THUMBNAIL_DISCOVERY_FETCH: '0', THUMBNAIL_IMAGE_PROBE: '0', THUMBNAIL_PROMOTION_APPLY: '0' }, stdio: 'pipe' });
  const load = async (path, global) => { const context = { window: {} }; vm.runInNewContext(await readFile(join(integration, path), 'utf8'), context); return JSON.parse(JSON.stringify(context.window[global])); };
  run('scripts/export-catalog.mjs');
  const catalog = JSON.parse(await readFile(join(integration, 'data/build/catalog.json'), 'utf8'));
  const place = catalog.restaurants.find(row => row.id === '2-doors-down');
  assert.ok(place?.address);
  const payload = await load('data/thumbnail-candidates.js', 'HALIFAX_THUMBNAIL_CANDIDATES');
  const injected = { ...candidate, restaurantId: place.id, restaurantName: place.name, sourceKind: 'official_page_thumbnail_candidate', sourceHostValidation: 'first_party_image_host', confidence: 'same_host_official_page_image', alt: evidence.alt };
  injected.id = 'thumb-' + createHash('sha1').update([injected.restaurantId, injected.thumbnailUrl, injected.sourceKind].join('|')).digest('hex').slice(0, 18);
  payload.candidates.push(injected);
  await writeFile(join(integration, 'data/build/thumbnail-candidates.json'), JSON.stringify(payload));
  await writeFile(join(integration, 'data/thumbnail-candidates.js'), 'window.HALIFAX_THUMBNAIL_CANDIDATES = ' + JSON.stringify(payload) + ';\n');
  run('scripts/build-thumbnail-candidates.mjs');
  const rebuilt = JSON.parse(await readFile(join(integration, 'data/build/thumbnail-candidates.json'), 'utf8')).candidates.find(row => row.id === injected.id);
  assert.ok(rebuilt);
  const proof = { ...evidence, candidateId: rebuilt.id, restaurantId: place.id, thumbnailUrl: rebuilt.thumbnailUrl, sourceUrl: rebuilt.sourceUrl, location: { ...evidence.location, restaurantId: place.id, address: place.address } };
  await writeFile(join(integration, assetPath), bytes);
  const originalAssessments = JSON.parse(await readFile(join(integration, 'data/thumbnail-assessments.json'), 'utf8'));
  await writeFile(join(integration, 'data/thumbnail-assessments.json'), JSON.stringify({ ...originalAssessments, records: [...originalAssessments.records, proof] }));
  const originalManifest = await load('data/restaurant-media.js', 'HALIFAX_RESTAURANT_MEDIA');
  const originalPriority = await readFile(join(integration, 'data/restaurant-media-priority.json'), 'utf8');
  for (let iteration = 0; iteration < 2; iteration++) {
    run('scripts/approve-eligible-thumbnails.mjs');
    run('scripts/build-thumbnail-candidates.mjs');
    run('scripts/check-thumbnail-candidates.mjs');
    run('scripts/check-restaurant-media-rights.mjs');
    run('scripts/test-media-reference-contract.mjs');
    const published = await load('data/restaurant-media.js', 'HALIFAX_RESTAURANT_MEDIA');
    assert.equal(published.records.length, originalManifest.records.length + 1);
    assert.equal(published.records.filter(row => row.restaurantId === place.id && row.assessmentId === injected.id).length, 1);
  }
  const rejectionPath = join(integration, 'data/thumbnail-rejected-candidates.json');
  const rejections = JSON.parse(await readFile(rejectionPath, 'utf8'));
  rejections.records.push({ restaurantId: place.id, thumbnailUrl: './' + assetPath, reason: 'wrong_location' });
  await writeFile(rejectionPath, JSON.stringify(rejections));
  for (let iteration = 0; iteration < 2; iteration++) {
    run('scripts/build-thumbnail-candidates.mjs');
    run('scripts/approve-eligible-thumbnails.mjs');
    run('scripts/build-thumbnail-candidates.mjs');
    run('scripts/check-restaurant-media-rights.mjs');
    assert.deepEqual(await load('data/restaurant-media.js', 'HALIFAX_RESTAURANT_MEDIA'), originalManifest);
  }
  await writeFile(join(integration, 'data/thumbnail-assessments.json'), JSON.stringify(originalAssessments));
  run('scripts/approve-eligible-thumbnails.mjs');
  run('scripts/build-thumbnail-candidates.mjs');
  run('scripts/check-restaurant-media-rights.mjs');
  assert.deepEqual(await load('data/restaurant-media.js', 'HALIFAX_RESTAURANT_MEDIA'), originalManifest);
  assert.equal(await readFile(join(integration, 'data/restaurant-media-priority.json'), 'utf8'), originalPriority);
  console.log('Automatic thumbnail tests passed: exact location, real-byte binding, rights/attribution, denials, idempotency, revocation, preserved media and legacy bypass.');
} finally { await rm(root, { recursive: true, force: true }); }
