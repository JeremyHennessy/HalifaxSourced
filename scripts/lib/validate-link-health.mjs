import assert from 'node:assert/strict';
import integrity from '../../source-integrity.js';
import { accessHost, accessStatuses, createAccessHolds, digest, holdForObservation, matchesHold, parseRetryAfter, policyObservations, validateAccessPolicy, validateObservation } from './link-access-policy.mjs';
import { lifecycleCandidates, linkCounts, resultStates, validateLifecycleContentReceipt } from './link-health-report.mjs';
import { linkHealthUrls } from './link-health-urls.mjs';
const redirects = [301,302,303,307,308];
export function validateLinkHealth(report, inputs, policy, expectedSha, now = Date.now()) {
  validateAccessPolicy(policy, now);
  const recent = value => integrity.publicationState(value, now, 1).isRecent;
  assert(recent(report.generatedAt), 'Release link audit timestamp is missing, invalid, future or stale');
  assert(report.version === 3 && expectedSha && report.sourceCommitSha === expectedSha && report.complete === true && report.scope === 'active_catalog_official_social_menu_actions', 'Missing, partial or wrong-SHA release link-health evidence');
  assert.equal(report.accessPolicySha256, digest(policy), 'Link audit policy digest mismatch');
  const universe = linkHealthUrls(inputs, true);
  assert.equal(report.totalCatalogRecords, inputs.catalog.restaurants.length, 'Link audit catalog count mismatch');
  assert.equal(report.activeCatalogRecords, universe.activeCatalogRecords, 'Link audit active count mismatch');
  assert.equal(report.totalUniqueUrls, universe.urls.length, 'Link audit URL count mismatch');
  assert(Array.isArray(report.results) && report.results.length === universe.urls.length, 'Link audit missing/full coverage');
  assert.equal(new Set(report.results.map(row => row.url)).size, report.results.length, 'Link audit duplicate URL');
  assert(typeof report.lifecycleExtraction === 'boolean', 'Missing lifecycle extraction policy');
  assert(Array.isArray(report.pendingAccessHolds) && Array.isArray(report.pendingTransportReviews) && Array.isArray(report.lateRestrictionReceipts), 'Missing pending restriction/transport receipts');
  const runtimeProvenance=requestId=>({kind:'current_run',sourceCommitSha:expectedSha,sourceWorkflowRunId:report.sourceWorkflowRunId,sourceWorkflowRunAttempt:report.sourceWorkflowRunAttempt,accessPolicySha256:report.accessPolicySha256,requestId});
  const requestIds=new Set();
  const policyHolds = createAccessHolds(policy);
  const runtimeHolds = [];
  for (const [index,row] of report.results.entries()) {
    const expected = universe.urls[index];
    for (const key of ['url','kinds','entityIds','officialEntityIds']) assert.deepEqual(row[key], expected[key], `Link audit ${key} coverage mismatch`);
    assert(recent(row.assessedAt) && Date.parse(row.assessedAt) <= Date.parse(report.generatedAt), 'Link audit assessment timestamp invalid');
    assert(resultStates.includes(row.state) && typeof row.attempted === 'boolean' && typeof row.confirmedBroken === 'boolean' && Array.isArray(row.lifecycle) && Array.isArray(row.receipts), 'Malformed link decision');
    const reused = row.reusedObservation === true;
    if (reused) {
      assert(row.state === 'ok' && row.attempted === false && row.attemptedAt === null && row.attempt === 0 && row.lifecycle.length === 0 && !row.confirmedBroken, 'Reused observation invents current request');
      assert(row.reusedFrom?.sourceCommitSha === expectedSha && row.reusedFrom?.accessPolicySha256 === digest(policy) && /^[a-f0-9]{64}$/.test(row.reusedFrom?.reportSha256 || '') && integrity.publicationState(row.reusedFrom?.generatedAt,now,1/24).isRecent && integrity.publicationState(row.observedAt,now,1/24).isRecent && recent(row.observationAttemptedAt), 'Invalid cached observation provenance');
      assert(Date.parse(row.observedAt) <= Date.parse(row.reusedFrom.generatedAt), 'Cache receipt postdates source report');
      if (row.priorContentReceipt) validateLifecycleContentReceipt({...row,attempted:true,attemptedAt:row.observationAttemptedAt,attempt:row.observationAttempt,reusedObservation:false,contentReceipt:row.priorContentReceipt},now);
    } else assert(!row.reusedFrom && !row.observationAttemptedAt && !row.observationAttempt && !row.priorContentReceipt, 'Unexpected cache provenance');
    if (row.attempted) assert(recent(row.attemptedAt) && Date.parse(row.attemptedAt) <= Date.parse(row.assessedAt), 'Link attempt timestamp invalid');
    else assert(row.attemptedAt === null && (reused || row.receipts.length === 0) && row.attempt === 0, 'Unattempted row manufactures a request');
    assert(Number.isInteger(row.attempt) && row.attempt >= (row.attempted ? 1 : 0) && row.attempt <= 2, 'Link confirmation attempt invalid');
    assert(row.attempted || reused || ['held','quarantined'].includes(row.state), 'Unattempted decision has no access-policy basis');
    if (integrity.safeSource(row.url) && policyHolds.find(row.url)) assert(row.state === 'held' && row.attempted === false, 'Known access hold was replaced with an unproven attempt');
    if (row.attempt === 2) assert([404,410].includes(row.receipts.filter(receipt => receipt.attempt === 1).at(-1)?.status), 'Second attempt lacks first hard404/410 receipt');
    for (const attempt of [1,2]) assert(row.receipts.filter(receipt=>receipt.attempt===attempt).length<=4,'HTTP chain exceeds four-request bound');
    assert(row.receipts.every(receipt=>receipt.attempt <= (reused ? row.observationAttempt : row.attempt)), 'Receipt exceeds declared attempt');
    let prior = null;
    for (const receipt of row.receipts) {
      assert((row.attempted || reused) && recent(receipt.observedAt) && Date.parse(receipt.observedAt) >= Date.parse(reused ? row.observationAttemptedAt : row.attemptedAt) && Date.parse(receipt.observedAt) <= Date.parse(row.assessedAt), 'Link receipt timestamp invalid');
      assert(/^\d+$/.test(receipt.requestId || '') && recent(receipt.attemptedAt) && Date.parse(receipt.attemptedAt)<=Date.parse(receipt.observedAt), 'Missing actual request receipt');
      if (!reused) { assert(!requestIds.has(receipt.requestId),'Duplicate actual request receipt'); requestIds.add(receipt.requestId); }
      assert(Number.isInteger(receipt.status) && receipt.status >= 100 && receipt.status <= 599 && [1,2].includes(receipt.attempt), 'Invalid HTTP receipt');
      assert(accessHost(receipt.url) === accessHost(row.url) && integrity.safeSource(receipt.url), 'Receipt violates redirect/source boundary');
      if (!prior || receipt.attempt !== prior.attempt) {
        assert(receipt.url === row.url && receipt.attempt === (prior ? 2 : 1), 'Invalid request/confirmation origin');
        if (prior) assert([404,410].includes(prior.status), 'Only hard 404/410 may be retried');
      } else assert(redirects.includes(prior.status) && receipt.url === prior.redirectUrl, 'Invalid HTTP redirect receipt chain');
      assert(!prior || Date.parse(receipt.observedAt) >= Date.parse(prior.observedAt), 'HTTP receipts out of time order');
      assert(!policyHolds.find(receipt.url), 'Known held target was requested');
      if (Object.hasOwn(receipt,'retryAfter')) assert.equal(receipt.retryNotBefore, parseRetryAfter(receipt.retryAfter,receipt.observedAt), 'Invalid Retry-After receipt');
      else assert(!Object.hasOwn(receipt,'retryNotBefore'), 'Invented Retry-After');
      if (accessStatuses.has(receipt.status)) runtimeHolds.push(holdForObservation({url:row.url, finalUrl:receipt.url, status:receipt.status, observedAt:receipt.observedAt}, runtimeProvenance(receipt.requestId)));
      prior = receipt;
    }
    if (row.state === 'held') {
      assert(row.status === null && row.observedAt === null && row.finalUrl === null && !row.confirmedBroken && row.lifecycle.length === 0, 'Held decision fabricates current evidence');
      assert(row.accessHold && matchesHold(row.accessHold, row.holdTarget), 'Mismatched access hold target');
      if (row.attempted) { assert(prior && redirects.includes(prior.status) && prior.redirectUrl === row.holdTarget, 'Held redirect lacks transport receipt'); assert.equal(row.attempt,prior.attempt,'Held redirect attempt mismatch'); }
      else assert.equal(row.holdTarget,row.url,'Unattempted hold target mismatch');
      assert.deepEqual(row.priorObservation, policyObservations(policy).find(item => item.url === row.url) || null, 'Held prior observation changed');
    } else if (row.status !== null) {
      assert((row.attempted || reused) && prior && !redirects.includes(prior.status), 'Observed result lacks actual final response');
      assert(recent(row.observedAt), 'Release link audit observation timestamp invalid or stale');
      assert.equal(reused ? row.observationAttempt : row.attempt,prior.attempt,'Observed attempt differs from actual response');
      assert.equal(row.observedAt,prior.observedAt,'Observation differs from actual response clock');
      assert.equal(row.status,prior.status,'Observation status differs from response');
      assert.equal(row.finalUrl,prior.url,'Observation URL differs from response');
      const state = row.status >= 200 && row.status < 300 ? 'ok' : [404,410].includes(row.status) ? 'broken' : [401,403].includes(row.status) ? 'restricted' : [408,425,429,500,502,503,504].includes(row.status) ? 'transient' : 'http_error';
      assert.equal(row.state,state,'HTTP observation classification mismatch');
      if (row.state === 'broken') assert(row.attempt === 2 && [404,410].includes(row.receipts.filter(item => item.attempt === 1).at(-1)?.status), 'Terminal hard404/410 lacks actual confirmation response');
      assert.equal(row.confirmedBroken, row.state === 'broken' && row.attempt === 2 && [404,410].includes(row.receipts.filter(item => item.attempt === 1).at(-1)?.status), 'Invalid hard404/410 confirmation');
    } else {
      assert(row.observedAt === null && row.finalUrl === null && ['transient','quarantined'].includes(row.state) && typeof row.error === 'string' && row.error && row.lifecycle.length === 0 && !row.confirmedBroken, 'Unobserved result invents success');
    }
    if (row.state === 'quarantined') {
      assert(!row.attempted ? !integrity.safeSource(row.url) : prior && redirects.includes(prior.status) && (!integrity.safeSource(prior.redirectUrl) || accessHost(prior.redirectUrl) !== accessHost(row.url)), 'Unsupported quarantine bypass');
    }
    if (row.contentReceipt) validateLifecycleContentReceipt(row,now);
    if (row.state !== 'ok' || !report.lifecycleExtraction) assert.equal(row.lifecycle.length,0,'Non-success/PR cannot provide lifecycle');
  }
  for (const hold of report.pendingTransportReviews) {
    const e=hold.evidence, p=hold.provenance;
    assert(hold.reason==='transport_unresolved' && hold.scope==='host' && hold.resume==='reviewed_evidence_required' && hold.target===accessHost(e.finalUrl), 'Invalid unresolved transport hold');
    assert(e.status===null && e.observedAt===null && recent(e.attemptedAt) && recent(e.assessedAt) && Date.parse(e.attemptedAt)<=Date.parse(e.assessedAt) && Date.parse(e.assessedAt)<=Date.parse(report.generatedAt), 'Unknown transport invents HTTP evidence');
    assert(accessHost(e.url)===accessHost(e.finalUrl) && report.results.some(row=>row.url===e.url && row.attempted && row.error==='timeout'), 'Unresolved transport lacks timed-out source attempt');
    assert.deepEqual(p,{...runtimeProvenance(p.requestId),kind:'unsettled_transport'},'Unresolved transport provenance mismatch');
    assert.equal(hold.id,digest({evidence:e,provenance:p}),'Unresolved transport identity mismatch');
  }
  for (const receipt of report.lateRestrictionReceipts) {
    const suspension=report.pendingTransportReviews.find(hold=>hold.id===receipt.suspensionId);
    let earliest=receipt.attemptedAt;
    if (suspension) {
      assert(receipt.sourceUrl===suspension.evidence.url && receipt.url===suspension.evidence.finalUrl && receipt.requestId===suspension.provenance.requestId && receipt.attemptedAt===suspension.evidence.attemptedAt, 'Late restriction lacks original unresolved request');
      earliest=suspension.evidence.assessedAt;
    } else {
      // A genuine denial may settle during the one-turn abort drain, before
      // uncertainty is declared. It remains expired evidence, never success.
      const row=report.results.find(item=>item.url===receipt.sourceUrl), prior=row?.receipts.at(-1);
      const expectedTarget=prior?.attempt===row?.attempt?prior.redirectUrl:row?.url;
      assert(receipt.suspensionId===null && row?.attempted && row.error==='timeout' && row.status===null && expectedTarget===receipt.url && recent(receipt.attemptedAt) && Date.parse(receipt.attemptedAt)>=Date.parse(row.attemptedAt), 'Late restriction lacks expired source request');
    }
    assert(/^\d+$/.test(receipt.requestId || '') && recent(receipt.observedAt) && Date.parse(receipt.observedAt)>=Date.parse(earliest) && Date.parse(receipt.observedAt)<=Date.parse(report.generatedAt), 'Late response clock invalid');
    const observation={url:receipt.sourceUrl,finalUrl:receipt.url,status:receipt.status,observedAt:receipt.observedAt}; validateObservation(observation,now);
    assert(!requestIds.has(receipt.requestId),'Duplicate late response receipt'); requestIds.add(receipt.requestId);
    runtimeHolds.push(holdForObservation(observation,runtimeProvenance(receipt.requestId)));
  }
  // Reconstruct runtime holds from actual response receipts, never trust an
  // arbitrary hold asserted by the report. Ordering in the report is URL order,
  // not concurrent request order; compare by content rather than insertion order.
  const sort = rows => [...rows].sort((a,b) => a.id.localeCompare(b.id));
  assert.deepEqual(sort(report.pendingAccessHolds),sort(runtimeHolds),'Pending restriction receipts mismatch');
  for (const row of report.results.filter(row => row.state === 'held')) {
    const known = [...policyHolds.holds,...runtimeHolds,...report.pendingTransportReviews].find(hold => hold.id === row.accessHold.id);
    assert(known, 'Unsupported access hold'); assert.deepEqual(row.accessHold,known,'Access hold evidence changed');
    assert(Date.parse(known.evidence.observedAt || known.evidence.assessedAt) <= Date.parse(row.assessedAt),'Hold used before observation');
  }
  for (const row of report.results) for (const receipt of row.receipts) for (const hold of runtimeHolds) {
    assert(!(matchesHold(hold,receipt.url) && Date.parse(hold.evidence.observedAt) < Date.parse(receipt.observedAt)), 'Known run restriction was retried');
  }
  assert.deepEqual(report.counts,linkCounts(report.results),'Link state/coverage count mismatch');
  for (const [field,predicate] of [['broken',row=>row.confirmedBroken],['restricted',row=>row.state==='restricted'],['transient',row=>row.state==='transient'],['held',row=>row.state==='held']]) assert.deepEqual(report[field],report.results.filter(predicate),`Link ${field} summary mismatch`);
  assert.deepEqual(report.lifecycleCandidates,lifecycleCandidates(report.results,report.lifecycleExtraction,now),'Lifecycle candidates lack genuine successful receipts');
  assert.equal(report.pendingTransportReviews.length,0,'Unresolved transport requires review before another hosted batch; no automatic retry or publication');
  assert.equal(report.pendingAccessHolds.length,0,'New access restrictions require a reviewed policy update before another hosted batch; no automatic retry or publication');
  return report;
}
