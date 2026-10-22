import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import integrity from '../../source-integrity.js';
export const policyPath = 'data/source-link-access-holds.json';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const accessStatuses = new Set([401,403,429]);
export const accessHost = integrity.sourceHost;
// Fragments never reach a server; only www/apex and trailing DNS dots are
// equivalent. Do not collapse arbitrary subdomains, query strings or paths.
export function accessUrl(value) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Error('Invalid access-policy URL');
  u.hash = ''; u.hostname = accessHost(u);
  return u.href;
}
export function validClock(value, now = Date.now()) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now && new Date(value).toISOString() === value;
}
export function validateObservation(row, now = Date.now()) {
  if (!row || !accessStatuses.has(row.status) || !validClock(row.observedAt, now)) throw Error('Invalid access-hold observation');
  for (const field of ['url','finalUrl']) { if (new URL(row[field]).href !== row[field]) throw Error('Noncanonical access-hold URL'); accessUrl(row[field]); }
  if (accessHost(row.url) !== accessHost(row.finalUrl)) throw Error('Access-hold receipt crosses source boundary');
  return row;
}
export const policyObservations = policy => [policy, ...(policy.historicalEvidence || [])].flatMap(group => group.observations);
const repository = 'JeremyHennessy/HalifaxSourced';
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const evidenceClock = validClock;
function requireEvidence(condition, message) { if (!condition) throw Error('Invalid reviewed workflow-log provenance: ' + message); }
function exactFields(value, required, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
// This validates an explicitly reviewed evidence bundle, not GitHub authenticity.
// A reviewer must independently retrieve the identified job metadata and full job
// log, verify logSha256 against those bytes, and locate the exact diagnostic.
function validateReviewedWorkflowLog(group, now) {
  const p = group.provenance, d = p.diagnostic;
  requireEvidence(exactFields(p, ['kind','repository','sourceCommitSha','workflowRunId','workflowRunAttempt','workflowJob','workflowJobId','accessPolicySha256','logSha256','diagnosticSha256','receiptSha256','loggedAt','diagnostic']), 'unsupported/missing fields');
  requireEvidence(p.repository === repository && typeof p.sourceCommitSha === 'string' && /^[a-f0-9]{40}$/.test(p.sourceCommitSha) && positiveId(p.workflowRunId) && positiveId(p.workflowRunAttempt), 'repository/run/SHA');
  requireEvidence(typeof p.workflowJob === 'string' && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(p.workflowJob) && Number.isSafeInteger(p.workflowJobId) && p.workflowJobId > 0, 'job identity');
  requireEvidence(['accessPolicySha256','logSha256','diagnosticSha256','receiptSha256'].every(key => sha256(p[key])) && evidenceClock(p.loggedAt,now), 'hashes/loggedAt');
  const context = {sourceCommitSha:p.sourceCommitSha,sourceWorkflowRunId:p.workflowRunId,sourceWorkflowRunAttempt:p.workflowRunAttempt,accessPolicySha256:p.accessPolicySha256};
  requireEvidence(exactFields(d, ['version','disposition','kind','repository','workflowJob','loggedAt',...Object.keys(context),'evidence']) && d.version === 1 && d.disposition === 'nonpublishable_requires_review' && ['http_restriction','late_http_restriction'].includes(d.kind), 'diagnostic kind/envelope');
  requireEvidence(d.repository === repository && d.workflowJob === p.workflowJob && d.loggedAt === p.loggedAt && Object.entries(context).every(([key,value]) => d[key] === value), 'diagnostic context');
  requireEvidence(digest(d) === p.diagnosticSha256, 'diagnostic hash');
  const e = d.evidence;
  requireEvidence(exactFields(e, ['hold','receipt','late','suspensionId']) && e.late === (d.kind === 'late_http_restriction') && (e.suspensionId === null || (e.late && sha256(e.suspensionId))), 'evidence envelope');
  const r = e.receipt, h = e.hold;
  requireEvidence(exactFields(r, ['requestId','url','status','observedAt','attemptedAt','mediaType'], ['retryAfter','retryNotBefore']) && positiveId(r.requestId) && typeof r.mediaType === 'string' && digest(r) === p.receiptSha256, 'receipt/hash');
  requireEvidence(evidenceClock(r.attemptedAt,now) && evidenceClock(r.observedAt,now) && Date.parse(r.attemptedAt) <= Date.parse(r.observedAt) && Date.parse(r.observedAt) <= Date.parse(p.loggedAt), 'receipt clock order');
  requireEvidence(Object.hasOwn(r,'retryAfter') === Object.hasOwn(r,'retryNotBefore') && (!Object.hasOwn(r,'retryAfter') || (typeof r.retryAfter === 'string' && r.retryNotBefore === parseRetryAfter(r.retryAfter,r.observedAt))), 'retry-after');
  requireEvidence(h && exactFields(h.evidence, ['url','finalUrl','status','observedAt']), 'hold observation');
  validateObservation(h.evidence,now);
  requireEvidence(r.url === h.evidence.finalUrl && r.status === h.evidence.status && r.observedAt === h.evidence.observedAt, 'receipt/hold mismatch');
  const expectedHold = holdForObservation(h.evidence,{kind:'current_run',...context,requestId:r.requestId});
  requireEvidence(isDeepStrictEqual(h,expectedHold), 'hold identity/provenance');
  requireEvidence(isDeepStrictEqual(group.observations,[h.evidence]), 'selected observations do not match diagnostic');
  return p.loggedAt;
}
export function validateAccessPolicy(value, now = Date.now()) {
  if (value?.version !== 1 || value.policy !== 'link_qa_access_holds' || value.resume !== 'reviewed_evidence_required' || (value.historicalEvidence !== undefined && !Array.isArray(value.historicalEvidence))) throw Error('Missing/malformed link access-hold policy');
  const seen = new Set();
  for (const group of [value,...(value.historicalEvidence || [])]) {
    const p = group.provenance;
    if (!p || !Array.isArray(group.observations) || !group.observations.length) throw Error('Missing/malformed link access-hold evidence');
    let evidenceCompletedAt;
    if (p.kind === 'reviewed_workflow_log') evidenceCompletedAt = validateReviewedWorkflowLog(group,now);
    else {
      if (Object.hasOwn(p,'kind')) throw Error('Unsupported access-hold provenance kind');
      if (!exactFields(p, ['repository','sourceCommitSha','workflowRunId','artifactId','artifactSha256','member','memberSha256','reportGeneratedAt']) || p.repository !== repository || typeof p.sourceCommitSha !== 'string' || !/^[a-f0-9]{40}$/.test(p.sourceCommitSha) || !positiveId(p.workflowRunId) || !positiveId(p.artifactId) || !sha256(p.artifactSha256) || !sha256(p.memberSha256) || p.member !== 'data/build/source-link-health-report.json' || !evidenceClock(p.reportGeneratedAt,now)) throw Error('Invalid access-hold provenance');
      evidenceCompletedAt = p.reportGeneratedAt;
    }
    for (const row of group.observations) {
      validateObservation(row, now);
      if (Date.parse(row.observedAt) > Date.parse(evidenceCompletedAt) || seen.has(row.url)) throw Error('Invalid/duplicate access-hold evidence');
      seen.add(row.url);
    }
    if (group !== value && Object.keys(group).some(key => !['provenance','observations'].includes(key))) throw Error('Unsupported historical policy override');
  }
  // There is deliberately no expiration/retry/release override. Removing a
  // persistent restriction needs a separately reviewed evidence/code change.
  const fields = ['version','policy','resume','provenance','observations','historicalEvidence'];
  if (Object.keys(value).some(key => !fields.includes(key))) throw Error('Unsupported access-policy override');
  return value;
}
export function parseRetryAfter(value, observedAt) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const at = /^\d+$/.test(text) ? Date.parse(observedAt) + Number(text) * 1000 : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(at) || at < Date.parse(observedAt) || at > 8640000000000000) return null;
  if (!/^\d+$/.test(text) && new Date(at).toUTCString() !== text) return null;
  return new Date(at).toISOString();
}
export function holdForObservation(row, provenance) {
  return {id:digest({row, provenance}), scope:row.status === 429 ? 'host' : 'url', target:row.status === 429 ? accessHost(row.finalUrl) : accessUrl(row.url), reason:row.status === 429 ? 'rate_limited' : 'access_restricted', resume:'reviewed_evidence_required', evidence:row, provenance};
}
export function matchesHold(hold, url) {
  return hold.scope === 'host' ? accessHost(url) === hold.target : [accessUrl(hold.evidence.url), accessUrl(hold.evidence.finalUrl)].includes(accessUrl(url));
}
export function createAccessHolds(policy) {
  const policySha256=digest(policy);
  const holds = policyObservations(policy).map(row => holdForObservation(row, {kind:'committed_policy', policySha256}));
  return {
    holds,
    find(url) { return holds.find(hold => matchesHold(hold, url)) || null; },
    observe(row, receipt) { if (accessStatuses.has(row.status)) { const hold = holdForObservation(row, {kind:'current_run', ...receipt}); holds.push(hold); return hold; } return null; }
  };
}
