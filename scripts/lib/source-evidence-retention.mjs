function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function retainFailedSourceRecords({ previousRecords = [], currentRecords = [], failures = [], protectedRecordIds = [] } = {}) {
  const failedSourceIds = new Set(failures.map((failure) => failure?.sourceId).filter(Boolean));
  const protectedIds = new Set(protectedRecordIds.filter(Boolean));
  const currentIds = new Set(currentRecords.map((record) => record?.id).filter(Boolean));
  const retained = previousRecords.filter((record) =>
    record?.id && !currentIds.has(record.id) && (failedSourceIds.has(record.sourceId) || protectedIds.has(record.id))
  );
  const retentions = [...failedSourceIds].sort().map((sourceId) => {
    const records = retained.filter((record) => record.sourceId === sourceId);
    const observed = records.map((record) => timestamp(record.observedAt)).filter(Number.isFinite);
    return {
      sourceId,
      retainedCount: records.length,
      latestRetainedObservation: observed.length ? new Date(Math.max(...observed)).toISOString() : null,
      reasons: [...new Set(failures.filter((failure) => failure?.sourceId === sourceId).map((failure) => failure.reason).filter(Boolean))].sort()
    };
  });
  return {
    records: [...currentRecords, ...retained],
    retained,
    retainedReviewedCount: retained.filter((record) => protectedIds.has(record.id)).length,
    retentions
  };
}

export function retainOpeningLeadsWithinLookback({ previousLeads = [], currentLeads = [], cutoff } = {}) {
  if (!Number.isFinite(cutoff)) throw new Error("Opening-lead retention requires a finite cutoff");
  const currentIds = new Set(currentLeads.map((lead) => lead?.id).filter(Boolean));
  const retained = previousLeads.filter((lead) => {
    if (!lead?.id || currentIds.has(lead.id)) return false;
    const evidenceTime = timestamp(lead.publishedAt) ?? timestamp(lead.observedAt);
    return evidenceTime !== null && evidenceTime >= cutoff;
  });
  return { leads: [...currentLeads, ...retained], retained };
}
