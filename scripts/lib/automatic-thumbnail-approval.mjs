import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import corrections from '../../restaurant-corrections.js';
import { mediaPermitted } from './media-rights-contract.mjs';

export const AUTOMATIC_THUMBNAIL_POLICY = 'verified-thumbnail-v1';
const key = record => `${record.restaurantId}|${String(record.url || record.thumbnailUrl).replace(/^\.\//, '')}`;
const text = value => typeof value === 'string' && value.trim().length > 0;
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const dated = value => text(value) && Number.isFinite(Date.parse(value));
const token = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export function explicitThumbnailHold(candidate) {
  return Boolean((candidate.qualityFlags || []).some(flag => token(flag).startsWith('reviewed_rejected_') || token(flag) === 'reviewed_needs_source_check') || candidate.quarantined || candidate.renderable === false ||
    ['reviewState', 'reviewStatus'].some(field => ['rejected', 'reject_candidate', 'reject_thumbnail', 'denied', 'source_check', 'needs_source_check'].includes(token(candidate[field]))) ||
    ['rightsStatus', 'rightsState', 'permission', 'usageRights', 'rights', 'license', 'licence'].some(field => ['denied', 'restricted', 'quarantined', 'rejected'].includes(token(candidate[field]))));
}


// Header dimensions are a second check, not a substitute for viewing decoded
// pixels. Inspection evidence is bound to the SHA256 of the entire local JPEG.
export function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

export async function assessThumbnail(candidate, evidence, restaurant, root) {
  const reasons = [];
  if (!restaurant || !corrections.isActive(restaurant)) reasons.push('not_active_exact_location');
  if (candidate.recordKind === 'source_reference' || candidate.sourceKind === 'retained_media_reference') reasons.push('historical_reference_only');
  if (explicitThumbnailHold(candidate)) reasons.push('rejected_or_source_check');
  if ((candidate.qualityFlags || []).length) reasons.push('candidate_quality_flags');
  if (!evidence) return { reasons: [...reasons, 'missing_verified_assessment'] };
  if (evidence.candidateId !== candidate.id || evidence.restaurantId !== candidate.restaurantId || evidence.thumbnailUrl !== candidate.thumbnailUrl || evidence.sourceUrl !== candidate.sourceUrl) reasons.push('assessment_identity_mismatch');
  if (!dated(evidence.assessedAt) || Date.parse(evidence.assessedAt) > Date.now() || !text(evidence.assessedBy)) reasons.push('missing_assessment_provenance');
  const location = evidence.location;
  if (location?.verified !== true || location.operatingStatus !== 'active' || location.restaurantId !== restaurant?.id || !text(restaurant?.address) || location.address !== restaurant?.address || !https(location.sourceUrl) || !text(location.notes)) reasons.push('location_not_verified');
  const visual = evidence.visual;
  if (visual?.inspected !== true || visual.verdict !== 'usable' || !text(visual.notes) || !/^[a-f0-9]{64}$/.test(visual.sha256 || '')) reasons.push('visual_not_verified');
  const rights = evidence.rights;
  if (rights?.verified !== true || rights.permissionConfirmed !== true || rights.localReproductionPermitted !== true || rights.conditionsSatisfied !== true || !https(rights.evidenceUrl) || !dated(rights.verifiedAt) || Date.parse(rights.verifiedAt) > Date.parse(evidence.assessedAt) || !text(rights.notes) || !text(rights.usageConditions) || (rights.expiresAt != null && (!dated(rights.expiresAt) || Date.parse(rights.expiresAt) <= Date.now()))) reasons.push('rights_not_verified');
  const assetPath = evidence.assetPath;
  if (!/^assets\/restaurants\/[a-z0-9-]+\.jpg$/.test(assetPath || '')) reasons.push('immutable_local_asset_required');
  else {
    try {
      const path = resolve(root, assetPath);
      const assetRoot = await realpath(resolve(root, 'assets/restaurants'));
      if (assetRoot !== resolve(root, 'assets/restaurants') || (await lstat(path)).isSymbolicLink() || !(await realpath(path)).startsWith(`${assetRoot}${sep}`)) throw Error('asset escapes directory');
      const bytes = await readFile(path);
      const dimensions = jpegDimensions(bytes);
      if (createHash('sha256').update(bytes).digest('hex') !== visual?.sha256) reasons.push('inspected_bytes_changed');
      if (!dimensions || dimensions.width < 300 || dimensions.height < 160 || dimensions.width / dimensions.height < 0.5 || dimensions.width / dimensions.height > 2.8 || dimensions.width !== visual?.width || dimensions.height !== visual?.height) reasons.push('decoded_quality_mismatch');
    } catch { reasons.push('asset_unavailable'); }
  }
  const media = {
    restaurantId: candidate.restaurantId, url: assetPath, alt: evidence.alt,
    sourceUrl: candidate.sourceUrl, sourceType: rights?.sourceType,
    rightsBasis: rights?.rightsBasis, permission: rights?.permission,
    permissionConfirmed: rights?.permissionConfirmed === true,
    creator: rights?.creator, license: rights?.license, attribution: rights?.attribution,
    reviewState: 'approved', approvalMethod: AUTOMATIC_THUMBNAIL_POLICY,
    assessmentId: evidence.candidateId, assessedAt: evidence.assessedAt,
    assetSha256: visual?.sha256, rightsEvidenceUrl: rights?.evidenceUrl,
    usageConditions: rights?.usageConditions, rightsVerificationNotes: rights?.notes,
    rightsExpiresAt: rights?.expiresAt || null
  };
  if (!mediaPermitted(media)) reasons.push('incomplete_media_contract');
  return { reasons: [...new Set(reasons)], media };
}

export async function approveEligibleThumbnails({ candidates, assessments, restaurants, media, root, decisions = [], rejections = [] }) {
  const restaurantById = new Map(restaurants.map(row => [row.id, row]));
  const evidenceById = new Map();
  for (const row of assessments) {
    if (!text(row.candidateId) || evidenceById.has(row.candidateId)) throw Error('Assessment IDs must be present and unique');
    evidenceById.set(row.candidateId, row);
  }
  // Preserve separately reviewed media byte-for-byte. Only this program's own
  // generated records may be withdrawn when evidence is removed or invalidated.
  const preserved = media.filter(row => row.approvalMethod !== AUTOMATIC_THUMBNAIL_POLICY);
  if (preserved.some(row => !mediaPermitted(row))) throw Error('Existing approved manifest is invalid');
  const approvedKeys = new Set(preserved.map(key));
  const vetoDecisions = decisions.filter(row => ['reject_thumbnail', 'reject_candidate', 'needs_source_check'].includes(token(row.decision)));
  const blockedKeys = new Set([...candidates.filter(explicitThumbnailHold), ...rejections, ...vetoDecisions].filter(row => row.url || row.thumbnailUrl).map(key));
  const blockedIds = new Set(vetoDecisions.map(row => row.id));
  const records = [...preserved];
  const dispositions = [];
  const reasonCounts = {};
  for (const candidate of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    if (approvedKeys.has(key(candidate))) {
      dispositions.push({ candidateId: candidate.id, restaurantId: candidate.restaurantId, state: 'already_approved', reasons: [] });
      continue;
    }
    const evidence = evidenceById.get(candidate.id);
    const result = await assessThumbnail(candidate, evidence, restaurantById.get(candidate.restaurantId), root);
    if (blockedIds.has(candidate.id) || blockedKeys.has(key(candidate)) || (evidence?.assetPath && blockedKeys.has(key({ restaurantId: candidate.restaurantId, url: evidence.assetPath })))) result.reasons.push('image_rejected_in_related_candidate');
    const state = result.reasons.length ? 'held' : 'automatically_approved';
    dispositions.push({ candidateId: candidate.id, restaurantId: candidate.restaurantId, state, reasons: result.reasons });
    for (const reason of result.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if (!result.reasons.length && !approvedKeys.has(key(result.media))) { records.push(result.media); approvedKeys.add(key(result.media)); }
  }
  const candidateIds = new Set(candidates.map(row => row.id));
  const staleAssessmentIds = assessments.filter(row => !candidateIds.has(row.candidateId)).map(row => row.candidateId).sort();
  return { records, report: { version: 1, policy: AUTOMATIC_THUMBNAIL_POLICY, counts: {
    candidates: candidates.length, alreadyApproved: dispositions.filter(row => row.state === 'already_approved').length,
    automaticallyApproved: dispositions.filter(row => row.state === 'automatically_approved').length,
    held: dispositions.filter(row => row.state === 'held').length,
    preservedMedia: preserved.length, automaticMedia: records.length - preserved.length,
    withdrawnAutomaticMedia: media.filter(row => row.approvalMethod === AUTOMATIC_THUMBNAIL_POLICY && !records.some(next => key(row) === key(next))).length,
    staleAssessments: staleAssessmentIds.length
  }, reasonCounts, staleAssessmentIds, dispositions } };
}

export function reconcileAutomaticMediaPriority(priority, media, restaurants) {
  const names = new Map(restaurants.map(row => [row.id, row.name]));
  const automaticIds = new Set(media.filter(row => row.approvalMethod === AUTOMATIC_THUMBNAIL_POLICY).map(row => row.restaurantId));
  const records = [];
  for (const row of priority.records) {
    const owned = row.automaticApprovalPolicy === AUTOMATIC_THUMBNAIL_POLICY;
    const original = owned ? row.previousPriorityRecord : row;
    if (automaticIds.has(row.restaurantId)) {
      records.push({ ...(original || { restaurantId: row.restaurantId, name: names.get(row.restaurantId) }), status: 'approved', automaticApprovalPolicy: AUTOMATIC_THUMBNAIL_POLICY, previousPriorityRecord: original || null });
      automaticIds.delete(row.restaurantId);
    } else if (original) records.push(original);
  }
  for (const restaurantId of [...automaticIds].sort()) records.push({ restaurantId, name: names.get(restaurantId), status: 'approved', automaticApprovalPolicy: AUTOMATIC_THUMBNAIL_POLICY, previousPriorityRecord: null });
  return { ...priority, targetCount: records.length, records };
}
