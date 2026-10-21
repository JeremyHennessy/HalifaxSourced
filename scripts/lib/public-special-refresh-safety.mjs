import { readFile } from "node:fs/promises";

export async function readPreviousPublicSpecialRecords(path) {
  let text;
  try { text = await readFile(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const payload = JSON.parse(text);
  if (!Array.isArray(payload.records) || payload.records.some(record => !record?.sourceRecordId || !record?.sourceId)) {
    throw new Error("Invalid previous public-special snapshot; refusing to discard evidence");
  }
  return payload.records;
}

// A failed source is not evidence that its prior listings were withdrawn.
// Retain the entire prior source atomically, including original evidence clocks.
export function retainFailedPublicSpecialSources(incomingRecords, previousRecords, failures = []) {
  const failed = new Map(failures.filter(item => item?.sourceId).map(item => [item.sourceId, item]));
  const records = incomingRecords.filter(record => !failed.has(record.sourceId));
  const seen = new Set(records.map(record => record.sourceRecordId));
  for (const record of previousRecords) {
    const failure = failed.get(record.sourceId);
    if (!failure || !record.sourceRecordId || seen.has(record.sourceRecordId)) continue;
    seen.add(record.sourceRecordId);
    records.push({
      ...record,
      refreshState: 'retained_after_failure',
      sourceFailure: {
        reason: failure.reason || 'source_failed',
        lastAttemptAt: failure.observedAt || null,
        sourceUrl: failure.sourceUrl || null
      }
    });
  }
  return records;
}
