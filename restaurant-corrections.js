/* Reviewed, location-specific corrections survive subsequent source refreshes. */
(function (root) {
  function apply(records, payload, makeRecord = value => value) {
    for (const addition of payload.additions || []) {
      if (!records.some(record => record.id === addition.id)) records.push(makeRecord(JSON.parse(JSON.stringify(addition))));
    }
    for (const alias of payload.aliases || []) {
      const source = records.find(record => record.id === alias.from);
      const target = records.find(record => record.id === alias.to);
      if (!source || !target) continue;
      target.aliasIds = [...new Set([...(target.aliasIds || []), source.id])];
      target.sources = [...new Map([...(target.sources || []), ...(source.sources || [])].map(item => [`${item.type}|${item.url}`, item])).values()];
      // Preserve the duplicate's evidence, without promoting conflicting fields.
      target.mergedIdentityEvidence = [...(target.mergedIdentityEvidence || []).filter(item => item.id !== source.id), { id: source.id, address: source.address, coordinates: source.coordinates, phone: source.phone, sources: source.sources, reviewedAt: alias.reviewedAt, reason: alias.reason }];
      records.splice(records.indexOf(source), 1);
    }
    for (const correction of payload.records || []) {
      const record = records.find(item => item.id === correction.restaurantId);
      if (!record) continue;
      Object.assign(record, correction.fields);
      record.reviewedCorrection = correction;
      record.sources ||= [];
      const evidence = { type: 'official_reviewed_correction', label: correction.claim, url: correction.sourceUrl, observedAt: correction.observedAt, reviewedAt: correction.reviewedAt, status: 'verified' };
      record.sources = record.sources.filter(item => item.type !== evidence.type || item.url !== evidence.url);
      record.sources.push(evidence);
      if (correction.fields.operatingStatus) record.operatingStatusEvidence = { ...evidence, sourceUrl: correction.sourceUrl, claim: correction.claim, location: record.address || correction.location, reviewState: 'verified', effectiveDate: correction.effectiveDate || null };
    }
    for (const record of records) if (['permanently_closed', 'temporarily_closed', 'moved', 'replaced'].includes(record.operatingStatus)) record.openingHours = null;
    return records;
  }
  // A rejected source field is held until an explicit location review removes
  // the rule. Apply to both retained and freshly collected observations, not
  // merely to the current generated snapshot.
  function applyFactFieldRejections(records, payload) {
    const allowed = new Set(['address', 'phone', 'email', 'hours']);
    return records.map(record => {
      const rules = (payload.factFieldRejections || []).filter(rule =>
        rule.restaurantId === record.restaurantId && rule.reviewState === 'rejected');
      if (!rules.length) return record;
      const result = { ...record };
      const rejected = new Map((record.rejectedFactFields || []).map(item => [item.field, item]));
      for (const rule of rules) for (const field of rule.fields || []) {
        if (!allowed.has(field)) continue;
        result[field] = null;
        rejected.set(field, { field, reviewId: rule.id, reason: rule.reason, reviewedAt: rule.reviewedAt });
      }
      if (rejected.size) result.rejectedFactFields = [...rejected.values()];
      return result;
    });
  }
  const api = { apply, applyFactFieldRejections };
  root.HalifaxRestaurantCorrections = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
