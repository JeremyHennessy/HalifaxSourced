import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { accessHost, accessStatuses, createAccessHolds, digest, parseRetryAfter, policyPath, validateAccessPolicy } from './link-access-policy.mjs';

let registry;
// One fixed-path registry per process. No optional-empty policy or environment
// bypass: an absent/malformed policy prevents transport before any robots fetch.
export function sourceAccessState() {
  if (registry) return registry;
  let policy;
  try { policy=validateAccessPolicy(JSON.parse(readFileSync(new URL('../../' + policyPath, import.meta.url),'utf8'))); }
  catch (error) { process.exitCode ||= 1; console.error('HALIFAX_SOURCE_ACCESS_POLICY_ERROR '+JSON.stringify({sourceCommitSha:process.env.SOURCE_COMMIT_SHA||process.env.GITHUB_SHA||null,sourceWorkflowRunId:process.env.GITHUB_RUN_ID||null,policyPath,error:error.message})); throw error; }
  const access = createAccessHolds(policy), pendingTransportReviews = [], lateRestrictionReceipts = [];
  const context = {sourceCommitSha:process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null, sourceWorkflowRunId:process.env.GITHUB_RUN_ID || null, sourceWorkflowRunAttempt:process.env.GITHUB_RUN_ATTEMPT || null, accessPolicySha256:digest(policy)};
  let sequence = 0;
  const drains = new Set();
  function diagnostic(kind, evidence) {
    const receipt = {version:1, disposition:'nonpublishable_requires_review', kind, repository:'JeremyHennessy/HalifaxSourced', workflowJob:process.env.GITHUB_JOB || null, loggedAt:new Date().toISOString(), ...context, evidence};
    // Every newly discovered denial/uncertainty stops a subsequent workflow
    // command even where an existing collector catches the transport exception.
    process.exitCode ||= 1;
    console.error('HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ' + JSON.stringify(receipt));
    mkdirSync(new URL('../../artifacts/', import.meta.url), {recursive:true});
    appendFileSync(new URL('../../artifacts/source-access-diagnostics.jsonl', import.meta.url), JSON.stringify(receipt) + '\n');
  }
  registry = {
    policy, access, pendingTransportReviews, lateRestrictionReceipts,
    trackDrain(promise) { drains.add(promise); promise.finally(() => drains.delete(promise)); },
    async drainDecisions() { while (drains.size) await Promise.all([...drains]); },
    start(url, target) { return {requestId:String(++sequence), url:String(url), target:String(target), attemptedAt:new Date().toISOString(), settled:false}; },
    suspend(request) {
      if (request.settled || request.suspension) return request.suspension || null;
      const evidence = {url:request.url, finalUrl:request.target, status:null, observedAt:null, attemptedAt:request.attemptedAt, assessedAt:new Date().toISOString()};
      const provenance = {kind:'unsettled_transport', ...context, requestId:request.requestId};
      const hold = {id:digest({evidence,provenance}), scope:'host', target:accessHost(request.target), reason:'transport_unresolved', resume:'reviewed_evidence_required', evidence, provenance};
      request.suspension = hold; access.holds.push(hold); pendingTransportReviews.push(hold);
      diagnostic('unsettled_transport', hold);
      return hold;
    },
    response(request, response, late = false) {
      request.settled = true;
      const observedAt = new Date().toISOString();
      const receipt = {requestId:request.requestId, url:request.target, status:response.status, observedAt, attemptedAt:request.attemptedAt, mediaType:(response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase()};
      const retryAfter = response.headers?.get('retry-after');
      if (retryAfter !== null && retryAfter !== undefined) { receipt.retryAfter = retryAfter; receipt.retryNotBefore = parseRetryAfter(retryAfter,observedAt); }
      if (accessStatuses.has(response.status)) {
        const hold = access.observe({url:request.url, finalUrl:request.target, status:response.status, observedAt}, {...context, requestId:request.requestId});
        if (late) lateRestrictionReceipts.push({sourceUrl:request.url, ...receipt, suspensionId:request.suspension?.id || null});
        diagnostic(late ? 'late_http_restriction' : 'http_restriction', {hold, receipt, late, suspensionId:request.suspension?.id || null});
      }
      return receipt;
    },
    failed(request) { request.settled = true; },
    get pendingAccessHolds() { return access.holds.filter(hold => hold.provenance.kind === 'current_run'); }
  };
  return registry;
}

export class SourceAccessHoldError extends Error {
  constructor(hold, target, attempted = false) {
    super('source_access_hold');
    this.name = 'SourceAccessHoldError'; this.code = 'SOURCE_ACCESS_HOLD';
    this.accessHold = hold; this.holdTarget = String(target); this.attempted = attempted;
  }
}
