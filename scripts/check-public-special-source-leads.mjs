import { mkdir, readFile, writeFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../data/build/public-special-source-leads.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const ids = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const allowedSourceIds = new Set(["halifax-events-happy-hour", "discover-halifax-dine-around-2026", "downtown-dartmouth-food-crawl-spring-2026"]);
const errors = [];
const warnings = [];
const seen = new Set();

function validUrl(value) {
  try { return ["http:", "https:"].includes(new URL(String(value || "")).protocol); }
  catch { return false; }
}

function validTime(value) {
  return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function validDate(value) {
  return value === null || Number.isFinite(Date.parse(String(value || "")));
}

for (const record of payload.records || []) {
  if (!record.sourceRecordId || seen.has(record.sourceRecordId)) errors.push(`invalid_or_duplicate_id:${record.sourceRecordId || "missing"}`);
  seen.add(record.sourceRecordId);
  if (!allowedSourceIds.has(record.sourceId || "")) errors.push(`invalid_source_id:${record.sourceRecordId}`);
  if (!record.venueName || !record.title || !record.sourceUrl || !validUrl(record.sourceUrl)) errors.push(`invalid_record:${record.sourceRecordId}`);
  if (record.sourcePageUrl && !validUrl(record.sourcePageUrl)) errors.push(`invalid_source_page_url:${record.sourceRecordId}`);
  if (record.sourceImageUrl && !validUrl(record.sourceImageUrl)) errors.push(`invalid_source_image_url:${record.sourceRecordId}`);
  if (record.sourceImageUrl && record.rightsState !== "requires_rights_review") errors.push(`image_without_rights_review:${record.sourceRecordId}`);
  if (record.restaurantId && !ids.has(record.restaurantId)) errors.push(`unknown_restaurant:${record.sourceRecordId}:${record.restaurantId}`);
  if (!["high", "probable", "needs_review"].includes(record.matchConfidence || "")) errors.push(`invalid_match_confidence:${record.sourceRecordId}`);
  if (!["exact_name", "street_address", "unique_website_host", "website_host_name", "fuzzy_name", "unresolved", "conflict"].includes(record.matchMethod || "")) errors.push(`invalid_match_method:${record.sourceRecordId}`);
  if (!validTime(record.startTime) || !validTime(record.endTime) || !validTime(record.secondStartTime) || !validTime(record.secondEndTime)) errors.push(`invalid_time:${record.sourceRecordId}`);
  if (!validDate(record.validFrom) || !validDate(record.validTo) || !validDate(record.lastVerifiedAt) || !validDate(record.sourceUpdatedAt) || !validDate(record.observedAt)) errors.push(`invalid_date:${record.sourceRecordId}`);
  if ((record.startTime && !record.endTime) || (!record.startTime && record.endTime)) errors.push(`partial_time_window:${record.sourceRecordId}`);
  if ((record.secondStartTime && !record.secondEndTime) || (!record.secondStartTime && record.secondEndTime)) errors.push(`partial_second_time_window:${record.sourceRecordId}`);
  if (record.price !== null && (!Number.isFinite(Number(record.price)) || Number(record.price) < 0)) errors.push(`invalid_price:${record.sourceRecordId}`);
  if (record.price !== null && record.currency !== "CAD") errors.push(`invalid_currency:${record.sourceRecordId}`);
}

const unresolved = (payload.records || []).filter((record) => !record.restaurantId);
if (unresolved.length) warnings.push(`public_special_leads_need_place_review:${unresolved.length}`);
if ((payload.records || []).length !== Number(payload.counts?.total || 0)) errors.push(`count_mismatch:${payload.counts?.total || 0}:${(payload.records || []).length}`);
if ((payload.failures || []).length) warnings.push(`public_special_source_failures:${payload.failures.length}`);

const report = {
  generatedAt: new Date().toISOString(),
  count: payload.records?.length || 0,
  resolved: payload.counts?.resolved || 0,
  unresolved: payload.counts?.unresolved || 0,
  conflicts: payload.counts?.conflicts || 0,
  happyHour: payload.counts?.happyHour || 0,
  seasonalCampaign: payload.counts?.seasonalCampaign || 0,
  foodCrawl: payload.counts?.foodCrawl || 0,
  failures: payload.failures || [],
  errors,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/public-special-source-leads-report.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
