import { createHash } from "node:crypto";

// Offline research helper only. It accepts already observed, bounded field values;
// it performs no I/O, fetching, scheduling, registry lookup, or event promotion.
const MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7],
  ["july", 7], ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["nov", 11], ["november", 11], ["dec", 12], ["december", 12]
]);
const MAX_RECORDS = 250;
const MAX_LENGTH = { title: 200, dateText: 80, timeText: 80, recurrenceText: 100, statusText: 80, sourceUrl: 2048, cost: 80, address: 180 };
const MAX_LOCATIONS = 8;
const MAX_LOCATION_LENGTH = 120;
const CLOCK_PATTERN = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)`;
const STATUS_MAP = new Map([
  ["cancelled", "cancelled"], ["canceled", "cancelled"],
  ["rescheduled", "rescheduled"],
  ["scheduled", "scheduled"], ["confirmed", "scheduled"], ["upcoming", "scheduled"]
]);

function clean(value) {
  return String(value ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "").trim();
}

function comparisonText(value) {
  return clean(value).normalize("NFKC").toLowerCase();
}

function parseDate(value) {
  const text = clean(value);
  let match = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  let parts;
  if (match) parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  else {
    match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(20\d{2})$/);
    if (!match || !MONTHS.has(match[1].toLowerCase())) return null;
    parts = { year: Number(match[3]), month: MONTHS.get(match[1].toLowerCase()), day: Number(match[2]) };
  }
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) return null;
  return parts;
}

function parseClock(value) {
  const match = clean(value).match(new RegExp(`^${CLOCK_PATTERN}$`, "i"));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3].toLowerCase().replaceAll(".", "");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function resolveZonedInstant({ year, month, day, hour, minute }, timeZone) {
  const requested = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set();
  // Sample both sides of a possible transition so folds yield two candidate offsets.
  for (let hours = -36; hours <= 36; hours += 3) {
    const sample = requested + hours * 60 * 60 * 1000;
    const actual = zonedParts(new Date(sample), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    offsets.add(represented - Math.floor(sample / 1000) * 1000);
  }
  const candidates = [...offsets].map(offset => requested - offset).filter(candidate => {
    const resolved = zonedParts(new Date(candidate), timeZone);
    return resolved.year === year && resolved.month === month && resolved.day === day
      && resolved.hour === hour && resolved.minute === minute;
  }).sort((a, b) => a - b);
  if (candidates.length !== 1) return { value: null, reason: candidates.length ? "ambiguous_local_time" : "nonexistent_local_time" };
  return { value: new Date(candidates[0]).toISOString(), reason: null };
}

function parseTimes(value) {
  const text = clean(value);
  const one = String.raw`\d{1,2}(?::\d{2})?\s*a\.?m\.?|\d{1,2}(?::\d{2})?\s*p\.?m\.?`;
  const range = text.match(new RegExp(`^(${one})\\s*(?:[-–—]|\\bto\\b)\\s*(${one})$`, "i"));
  if (range) {
    const start = parseClock(range[1]);
    const end = parseClock(range[2]);
    return start && end ? { start, end } : null;
  }
  const single = parseClock(text);
  return single ? { start: single, end: null } : null;
}

function validOfficialUrl(value) {
  if (typeof value !== "string" || value.length > MAX_LENGTH.sourceUrl) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["pier21.ca", "www.pier21.ca"].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_[a-z0-9_]+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function statusFrom(value) {
  const label = clean(value);
  const key = label.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return { status: STATUS_MAP.get(key) || "unknown", statusLabel: label || null };
}

function rejectReason(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) return "invalid_record";
  for (const [field, limit] of Object.entries(MAX_LENGTH)) {
    if (record[field] !== undefined && (typeof record[field] !== "string" || record[field].length > limit)) return "invalid_" + field;
  }
  if (record.locationNames !== undefined && (!Array.isArray(record.locationNames) || record.locationNames.length > MAX_LOCATIONS
    || record.locationNames.some(name => typeof name !== "string" || name.length > MAX_LOCATION_LENGTH))) return "invalid_location_names";
  if (record.addressExplicit !== undefined && typeof record.addressExplicit !== "boolean") return "invalid_address_explicit";
  const date = clean(record?.dateText);
  if (!date) return /\b(year[- ]round|twice monthly|monthly|weekly|daily|recurring)\b/i.test(clean(record?.recurrenceText))
    ? "undated_recurrence" : "missing_date";
  if (!parseDate(date)) return "ambiguous_or_unsupported_date";
  if (!parseTimes(record?.timeText)) return "missing_or_ambiguous_time";
  if (!validOfficialUrl(record?.sourceUrl)) return "invalid_official_source_url";
  if (!clean(record?.title)) return "missing_title";
  if (!normalized(record.title)) return "empty_normalized_title";
  return null;
}

export function parsePier21Records(records, { timeZone = "America/Halifax" } = {}) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  if (records.length > MAX_RECORDS) throw new RangeError(`records must contain at most ${MAX_RECORDS} items`);
  if (typeof timeZone !== "string" || timeZone.length > 100) throw new TypeError("timeZone must be a short IANA timezone string");
  // Fail early for unsupported zone names; no machine-local timezone fallback.
  new Intl.DateTimeFormat("en", { timeZone });
  const candidates = [];
  const rejected = [];
  for (const record of records) {
    const reason = rejectReason(record);
    if (reason) { rejected.push({ sourceUrl: validOfficialUrl(record?.sourceUrl), reason }); continue; }
    const date = parseDate(record.dateText);
    const times = parseTimes(record.timeText);
    const start = resolveZonedInstant({ ...date, ...times.start }, timeZone);
    const end = times.end ? resolveZonedInstant({ ...date, ...times.end }, timeZone) : { value: null, reason: null };
    if (!start.value || end.reason || (end.value && Date.parse(end.value) <= Date.parse(start.value))) {
      rejected.push({ sourceUrl: validOfficialUrl(record.sourceUrl), reason: start.reason || end.reason || "invalid_local_time" });
      continue;
    }
    const locationByKey = new Map();
    for (const supplied of record.locationNames || []) {
      const display = clean(supplied);
      const key = normalized(display);
      if (!key) continue;
      const existing = locationByKey.get(key);
      if (!existing || display < existing) locationByKey.set(key, display);
    }
    const locations = [...locationByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, display]) => display);
    const title = clean(record.title);
    const sourceUrl = validOfficialUrl(record.sourceUrl);
    const identityMaterial = [normalized(title), start.value, sourceUrl, ...[...locationByKey.keys()].sort()].join("|");
    const identity = `pier21-${createHash("sha256").update(identityMaterial).digest("hex").slice(0, 20)}`;
    const observedStatus = statusFrom(record.statusText);
    const event = {
      id: identity,
      title,
      startAt: start.value,
      endAt: end.value,
      timeZone,
      status: observedStatus.status,
      statusLabel: observedStatus.statusLabel,
      locationNames: locations,
      venueName: locations.length === 1 ? locations[0] : null,
      address: locations.length === 1 && record.addressExplicit === true ? clean(record.address) || null : null,
      cost: clean(record.cost) || null,
      sourceUrl,
      provenance: {
        sourceName: "Canadian Museum of Immigration at Pier 21",
        observedFields: ["title", "dateText", "timeText", "sourceUrl",
          ...(locations.length ? ["locationNames"] : []), ...(record.addressExplicit === true && clean(record.address) ? ["address"] : []),
          ...(clean(record.cost) ? ["cost"] : []), ...(observedStatus.statusLabel ? ["statusText"] : [])]
      }
    };
    candidates.push(event);
  }
  const groups = new Map();
  for (const event of candidates) groups.set(event.id, [...(groups.get(event.id) || []), event]);
  const events = [];
  for (const group of groups.values()) {
    const signatures = new Set(group.map(event => JSON.stringify({
      endAt: event.endAt, status: event.status, statusLabel: comparisonText(event.statusLabel),
      cost: comparisonText(event.cost), address: comparisonText(event.address)
    })));
    if (signatures.size > 1) {
      for (const event of group) rejected.push({ sourceUrl: event.sourceUrl, reason: "conflicting_duplicate_identity" });
      continue;
    }
    const sourceUrls = [...new Set(group.map(event => event.sourceUrl))].sort();
    events.push({ ...group[0], sourceUrl: sourceUrls[0], sourceUrls });
    for (const event of group.slice(1)) rejected.push({ sourceUrl: event.sourceUrl, reason: "duplicate_identity" });
  }
  events.sort((a, b) => a.id.localeCompare(b.id));
  const occurrenceGroups = new Map();
  for (const event of events) {
    const key = `${event.sourceUrl}|${normalized(event.title)}`;
    occurrenceGroups.set(key, [...(occurrenceGroups.get(key) || []), event]);
  }
  const warnings = [];
  for (const group of occurrenceGroups.values()) {
    if (new Set(group.map(event => event.id)).size > 1) {
      warnings.push({
        sourceUrl: group[0].sourceUrl,
        titleKey: normalized(group[0].title),
        eventIds: group.map(event => event.id).sort(),
        reason: "same_source_occurrence_relationship_unresolved"
      });
    }
  }
  return { events, rejected, warnings };
}
