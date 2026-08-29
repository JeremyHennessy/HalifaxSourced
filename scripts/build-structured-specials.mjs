import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const firstParty = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8"));
const verifiedPages = JSON.parse(await readFile(new URL("../data/build/verified-source-pages.json", import.meta.url), "utf8").catch(() => "{}"));
const catalogIds = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const now = new Date().toISOString();
const nowStamp = Date.parse(now);
const CURRENT_VERIFY_DAYS = Number(process.env.STRUCTURED_SPECIAL_CURRENT_VERIFY_DAYS || 30);

function safeUrl(value) { try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
function slug(value) { return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function specialId(restaurantId, title, sourceUrl) {
  const digest = createHash("sha256").update(`${restaurantId}|${String(title || "").toLowerCase()}|${sourceUrl}`).digest("hex").slice(0, 10);
  return `${restaurantId}-${slug(title || "special")}-${digest}`;
}
function to24(hour, minute, ampm) { let h = Number(hour) % 12; if (String(ampm).toLowerCase() === "pm") h += 12; return `${String(h).padStart(2, "0")}:${String(minute || "00").padStart(2, "0")}`; }
function parsedStamp(value) { const stamp = Date.parse(String(value || "")); return Number.isFinite(stamp) ? stamp : null; }
function recentlyVerified(value) { const stamp = parsedStamp(value); return stamp !== null && stamp <= nowStamp + 86400000 && nowStamp - stamp <= CURRENT_VERIFY_DAYS * 86400000; }
function numericPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const dayNames = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
function parseCadence(value) {
  const text = String(value || "").trim();
  if (!text) return { dayOfWeek: null, startTime: null, endTime: null, recurrence: null };
  const match = text.match(/(?:(daily)|((?:mon|tue|wed|thu|fri|sat|sun)(?:\s*[-–]\s*(?:mon|tue|wed|thu|fri|sat|sun))?))?.*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return { dayOfWeek: null, startTime: null, endTime: null, recurrence: text };
  let days = null;
  if (match[1]) days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  else if (match[2]) {
    const parts = match[2].toLowerCase().split(/\s*[-–]\s*/);
    const keys = Object.keys(dayNames);
    const start = keys.indexOf(parts[0]);
    const end = keys.indexOf(parts[1] || parts[0]);
    if (start >= 0 && end >= 0) {
      days = [];
      let index = start;
      for (let count = 0; count < 7; count += 1) {
        days.push(dayNames[keys[index]]);
        if (index === end) break;
        index = (index + 1) % 7;
      }
    }
  }
  return { dayOfWeek: days, startTime: to24(match[3], match[4], match[5]), endTime: to24(match[6], match[7], match[8]), recurrence: text };
}
function typeFor(title) {
  const text = String(title || "").toLowerCase();
  if (/happy hour/.test(text)) return "happy_hour";
  if (/wing/.test(text)) return "wing_night";
  if (/taco/.test(text)) return "taco_night";
  if (/oyster/.test(text)) return "oyster_special";
  if (/wine/.test(text)) return "wine_special";
  if (/brunch/.test(text)) return "brunch";
  if (/prix|fixed|fixe/.test(text)) return "prix_fixe";
  if (/tasting/.test(text)) return "tasting_menu";
  if (/lunch/.test(text)) return "lunch_special";
  return "daily_or_promotional_special";
}
function statusFor({ sourceVerified, verifiedAt, validFrom, validTo, recurrence }) {
  const from = parsedStamp(validFrom);
  const to = parsedStamp(validTo);
  if (to !== null && to < nowStamp) return "expired";
  if (from !== null && from > nowStamp) return "source_lead";
  if (sourceVerified && recentlyVerified(verifiedAt)) return "verified_current";
  if (sourceVerified) return "stale";
  if (recurrence) return "likely_recurring_verify";
  return "source_lead";
}

const records = [];
const seen = new Set();
function push(record) {
  const key = `${record.restaurantId}|${record.sourceUrl}|${record.title}`.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  records.push(record);
}

for (const place of catalog.restaurants || []) {
  for (const special of place.specials || []) {
    const sourceUrl = safeUrl(special.sourceUrl) || safeUrl(special.url) || (place.sources || []).map((source) => safeUrl(source.url)).find(Boolean);
    if (!sourceUrl) continue;
    const title = special.title || "Restaurant special";
    const cadence = parseCadence(special.cadence || special.timing || "");
    const verifiedAt = special.verifiedAt || special.observedAt || null;
    const sourceVerified = special.sourceStatus === "verified" || special.status === "verified";
    const record = {
      specialId: specialId(place.id, title, sourceUrl),
      restaurantId: place.id,
      title,
      specialType: typeFor(title),
      description: special.description || null,
      dayOfWeek: cadence.dayOfWeek,
      startTime: cadence.startTime,
      endTime: cadence.endTime,
      validFrom: special.validFrom || null,
      validTo: special.validTo || null,
      price: numericPrice(special.price),
      currency: special.currency || null,
      recurrence: cadence.recurrence,
      sourceUrl,
      sourceType: special.sourceType || "restaurant_owned_or_reviewed_source",
      observedAt: special.observedAt || place.freshnessDate || now,
      verifiedAt,
      status: null
    };
    record.status = statusFor({ sourceVerified, verifiedAt, validFrom: record.validFrom, validTo: record.validTo, recurrence: record.recurrence });
    push(record);
  }
}

const verifiedRecords = Array.isArray(verifiedPages.records) ? verifiedPages.records : Array.isArray(verifiedPages.pages) ? verifiedPages.pages : [];
for (const page of verifiedRecords) {
  const url = safeUrl(page.url || page.sourceUrl);
  const haystack = `${page.label || ""} ${page.kind || page.type || ""} ${url || ""}`;
  if (!url || !/special|happy.?hour|promo|offer|feature/i.test(haystack)) continue;
  const title = page.label || "Specials source";
  push({
    specialId: specialId(page.restaurantId, title, url),
    restaurantId: page.restaurantId,
    title,
    specialType: typeFor(title),
    description: null,
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    validFrom: null,
    validTo: null,
    price: null,
    currency: null,
    recurrence: null,
    sourceUrl: url,
    sourceType: "verified_restaurant_owned_page",
    observedAt: page.observedAt || page.verifiedAt || now,
    verifiedAt: page.verifiedAt || page.observedAt || now,
    status: "source_lead"
  });
}
for (const record of firstParty.records || []) {
  for (const link of record.relatedLinks || []) {
    const url = safeUrl(link.url);
    if (!url || !/special|happy.?hour|promo|feature|deal/i.test(`${link.label || ""} ${url}`)) continue;
    const title = link.label || "Specials source";
    push({
      specialId: specialId(record.restaurantId, title, url),
      restaurantId: record.restaurantId,
      title,
      specialType: typeFor(title),
      description: null,
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      validFrom: null,
      validTo: null,
      price: null,
      currency: null,
      recurrence: null,
      sourceUrl: url,
      sourceType: "official_website_link",
      observedAt: link.observedAt || now,
      verifiedAt: link.lastVerifiedAt || link.observedAt || now,
      status: "source_lead"
    });
  }
}

const canonicalRecords = [];
const orphanSources = [];
for (const record of records) {
  if (catalogIds.has(record.restaurantId)) {
    canonicalRecords.push(record);
    continue;
  }
  orphanSources.push({
    restaurantId: record.restaurantId || null,
    title: record.title,
    sourceUrl: record.sourceUrl,
    sourceType: record.sourceType,
    observedAt: record.observedAt || null,
    verifiedAt: record.verifiedAt || null,
    reason: "restaurant_id_not_in_canonical_catalog"
  });
}

const payload = {
  version: 3,
  generatedAt: now,
  currentVerificationMaxAgeDays: CURRENT_VERIFY_DAYS,
  count: canonicalRecords.length,
  verifiedCurrent: canonicalRecords.filter((record) => record.status === "verified_current").length,
  recurringVerify: canonicalRecords.filter((record) => record.status === "likely_recurring_verify").length,
  sourceLeads: canonicalRecords.filter((record) => record.status === "source_lead").length,
  stale: canonicalRecords.filter((record) => record.status === "stale").length,
  expired: canonicalRecords.filter((record) => record.status === "expired").length,
  orphanSourceCount: orphanSources.length,
  orphanSources,
  records: canonicalRecords
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/structured-specials.json", import.meta.url), JSON.stringify(payload, null, 2) + "\n");
await writeFile(new URL("../data/structured-specials.js", import.meta.url), `window.HALIFAX_STRUCTURED_SPECIALS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(JSON.stringify({ count: payload.count, verifiedCurrent: payload.verifiedCurrent, recurringVerify: payload.recurringVerify, sourceLeads: payload.sourceLeads, stale: payload.stale, expired: payload.expired, orphanSourceCount: payload.orphanSourceCount }, null, 2));
