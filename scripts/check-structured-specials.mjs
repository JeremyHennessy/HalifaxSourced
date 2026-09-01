import { mkdir, readFile, writeFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../data/build/structured-specials.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const verifiedPages = JSON.parse(await readFile(new URL("../data/build/verified-source-pages.json", import.meta.url), "utf8"));
const discoveryOverrides = JSON.parse(await readFile(new URL("../data/discovery-overrides.json", import.meta.url), "utf8").catch(() => "{\"approved\":[]}"));
function normalizeName(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]+/g, ""); }
const catalogByName = new Map((catalog.restaurants || []).map((restaurant) => [normalizeName(restaurant.name), restaurant.id]));
const discoveredIds = (discoveryOverrides.approved || []).map((restaurant) => catalogByName.get(normalizeName(restaurant.name)) || restaurant.id);
const ids = new Set([...(catalog.restaurants || []).map((restaurant) => restaurant.id), ...discoveredIds]);
const verifiedSpecialUrls = new Set((verifiedPages.specialSources || []).map((source) => source.url));
const errors = [];
const warnings = [];
const seen = new Set();
const now = Date.now();
const currentVerifyDays = Number(payload.currentVerificationMaxAgeDays || 30);

function validUrl(value) { try { return ["http:", "https:"].includes(new URL(String(value || "")).protocol); } catch { return false; } }
function validTime(value) { return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)); }
function validDate(value) { return value === null || Number.isFinite(Date.parse(String(value || ""))); }
function ageDays(value) { const stamp = Date.parse(String(value || "")); return Number.isFinite(stamp) ? (now - stamp) / 86400000 : null; }

for (const record of payload.records || []) {
  if (!record.specialId || seen.has(record.specialId)) errors.push(`invalid_or_duplicate_id:${record.specialId}`);
  seen.add(record.specialId);
  if (!ids.has(record.restaurantId)) errors.push(`unknown_restaurant:${record.specialId}`);
  if (!record.title || !record.specialType || !validUrl(record.sourceUrl) || !["verified_current", "likely_recurring_verify", "source_lead", "expired", "stale"].includes(record.status)) errors.push(`invalid_record:${record.specialId}`);
  if (!validTime(record.startTime) || !validTime(record.endTime) || !validDate(record.validFrom) || !validDate(record.validTo)) errors.push(`invalid_time_or_date:${record.specialId}`);
  if ((record.startTime && !record.endTime) || (!record.startTime && record.endTime)) errors.push(`partial_time_window:${record.specialId}`);
  if (record.price !== null && (!Number.isFinite(Number(record.price)) || Number(record.price) < 0)) errors.push(`invalid_price:${record.specialId}`);
  if (record.price !== null && !record.currency) errors.push(`priced_record_without_currency:${record.specialId}`);
  if (record.sourceType === "reviewed_restaurant_owned_source") {
    if (!verifiedSpecialUrls.has(record.sourceUrl)) errors.push(`reviewed_source_not_in_verified_registry:${record.specialId}`);
    if (!record.description && record.price === null) errors.push(`reviewed_record_without_specific_detail:${record.specialId}`);
  }

  if (record.status === "verified_current") {
    const age = ageDays(record.verifiedAt);
    if (age === null) errors.push(`verified_without_date:${record.specialId}`);
    else if (age < -1 || age > currentVerifyDays) errors.push(`verified_current_outside_freshness_window:${record.specialId}:${age.toFixed(1)}d`);
    const validTo = Date.parse(String(record.validTo || ""));
    if (Number.isFinite(validTo) && validTo < now) errors.push(`verified_current_expired:${record.specialId}`);
  }
  if (record.status === "expired") {
    const validTo = Date.parse(String(record.validTo || ""));
    if (!Number.isFinite(validTo) || validTo >= now) errors.push(`expired_without_past_valid_to:${record.specialId}`);
  }
}

for (const orphan of payload.orphanSources || []) {
  const unresolvedPublicLead = !orphan.restaurantId && orphan.sourceType === "public_directory_special_lead" && orphan.sourceRecordId && orphan.candidateName && orphan.reason === "restaurant_id_not_in_canonical_catalog";
  if (!unresolvedPublicLead && (!orphan.restaurantId || ids.has(orphan.restaurantId) || !orphan.title || !validUrl(orphan.sourceUrl) || orphan.reason !== "restaurant_id_not_in_canonical_catalog")) {
    errors.push(`invalid_orphan_source:${orphan.restaurantId || "missing"}:${orphan.sourceUrl || "missing"}`);
  }
}
if ((payload.orphanSources || []).length !== Number(payload.orphanSourceCount || 0)) errors.push(`orphan_count_mismatch:${payload.orphanSourceCount || 0}:${(payload.orphanSources || []).length}`);
if ((payload.orphanSources || []).length) warnings.push(`orphan_special_sources_need_entity_review:${payload.orphanSources.length}`);
if (!(payload.records || []).length) warnings.push("zero_structured_special_records");
const reviewedCurrent = (payload.records || []).filter((record) => record.sourceType === "reviewed_restaurant_owned_source" && record.status === "verified_current").length;
if (reviewedCurrent < 30) errors.push(`reviewed_current_specials_below_target:${reviewedCurrent}:30`);

const report = {
  generatedAt: new Date().toISOString(),
  count: payload.count || 0,
  verifiedCurrent: payload.verifiedCurrent || 0,
  reviewedCurrent,
  recurringVerify: payload.recurringVerify || 0,
  sourceLeads: payload.sourceLeads || 0,
  stale: payload.stale || 0,
  expired: payload.expired || 0,
  orphanSourceCount: payload.orphanSourceCount || 0,
  currentVerificationMaxAgeDays: currentVerifyDays,
  errors,
  warnings
};
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/structured-specials-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
