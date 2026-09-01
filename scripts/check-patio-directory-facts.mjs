import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

async function loadWindow(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}

function validDate(value) {
  return Number.isFinite(Date.parse(String(value ?? "")));
}

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const windowData = await loadWindow("data/patio-directory-facts.js");
const payload = windowData.HALIFAX_PATIO_DIRECTORY_FACTS || {};
const records = Array.isArray(payload.records) ? payload.records : [];
const restaurantIds = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const failures = [];
const warnings = [];
const seen = new Set();

if (payload.counts?.total !== records.length) failures.push({ type: "count_mismatch", expected: records.length, actual: payload.counts?.total });
if (!validDate(payload.generatedAt)) failures.push({ type: "invalid_generated_at", value: payload.generatedAt });

for (const [index, record] of records.entries()) {
  if (!record.sourceRecordId || seen.has(record.sourceRecordId)) failures.push({ type: "duplicate_or_missing_source_record_id", index, sourceRecordId: record.sourceRecordId });
  seen.add(record.sourceRecordId);
  if (!record.name || record.feature !== "patio" || record.sourceId !== "downtown-halifax-patios-2026") failures.push({ type: "invalid_core_fields", index, sourceRecordId: record.sourceRecordId });
  if (!validUrl(record.sourceUrl) || !validDate(record.observedAt)) failures.push({ type: "invalid_source_or_observed_at", index, sourceRecordId: record.sourceRecordId });
  if (record.website && !validUrl(record.website)) failures.push({ type: "invalid_website", index, website: record.website });
  if (record.sourceImageUrl && !validUrl(record.sourceImageUrl)) failures.push({ type: "invalid_source_image_url", index, sourceImageUrl: record.sourceImageUrl });
  if (record.sourceImageUrl && record.rightsState !== "requires_rights_review") failures.push({ type: "source_image_missing_rights_review", index, sourceRecordId: record.sourceRecordId });
  if (record.restaurantId && !restaurantIds.has(record.restaurantId)) failures.push({ type: "unknown_restaurant_id", index, restaurantId: record.restaurantId });
  if (!record.restaurantId && !["unresolved", "conflict"].includes(record.matchMethod)) failures.push({ type: "unresolved_record_missing_review_method", index, sourceRecordId: record.sourceRecordId, matchMethod: record.matchMethod });
  if (record.matchConfidence === "needs_review") warnings.push({ type: "patio_directory_match_needs_review", name: record.name, address: record.address, sourceRecordId: record.sourceRecordId });
}

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    total: records.length,
    resolved: records.filter((record) => record.restaurantId).length,
    unresolved: records.filter((record) => !record.restaurantId && record.matchMethod === "unresolved").length,
    conflicts: records.filter((record) => record.matchMethod === "conflict").length,
    dogFriendly: records.filter((record) => record.dogFriendly).length,
    withSourceImage: records.filter((record) => record.sourceImageUrl).length
  },
  failures,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/patio-directory-facts-report.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`Patio directory warnings: ${warnings.length} records need match review.`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 25), null, 2));
  process.exit(1);
}
