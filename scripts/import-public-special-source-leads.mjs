import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourceId = "halifax-events-happy-hour";
const sourceName = "HalifaxEvents.ca Happy Hour";
const sourceUrl = "https://halifaxevents.ca/happy-hour";
const timeoutMs = Number(process.env.PUBLIC_SPECIAL_LEAD_TIMEOUT_MS ?? 12000);
const limit = Number(process.env.PUBLIC_SPECIAL_LEAD_LIMIT ?? 500);
const userAgent = "HalifaxSourced/0.8 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const observedAt = new Date().toISOString();

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|restaurant|bar|cafe|café|pub|grill|kitchen|lounge|beach|house|public|shop)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function safeUrl(value, base = sourceUrl) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  try {
    const url = new URL(String(value ?? "").replaceAll("&amp;", "&"), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function canonicalHost(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function streetKey(value) {
  const text = String(value ?? "").toLowerCase()
    .replace(/\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|boulevard|blvd\.|place|pl\.|wharf|terrace|way)\b/g, (word) => {
      if (word.startsWith("st")) return "st";
      if (word.startsWith("rd") || word === "road") return "rd";
      if (word.startsWith("ave") || word === "avenue") return "ave";
      if (word.startsWith("dr") || word === "drive") return "dr";
      if (word.startsWith("blvd") || word === "boulevard") return "blvd";
      if (word.startsWith("ln") || word === "lane") return "ln";
      if (word.startsWith("pl") || word === "place") return "pl";
      return word;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/\b(\d{1,5})\s+([a-z][a-z ]{2,40})\b/);
  return match ? `${match[1]} ${match[2].trim()}` : "";
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.hasRules = true;
      if (key === "disallow" && value) current.disallow.push(value);
    }
  }
  const specific = groups.find((group) => group.agents.some((agent) => agent.includes("halifaxsourced")));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  return (specific || wildcard)?.disallow || [];
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  try {
    const response = await fetch(new URL("/robots.txt", parsed.origin), {
      headers: { "User-Agent": userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.min(8000, timeoutMs))
    });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return true;
    const disallow = parseRobots(await response.text());
    return !disallow.some((prefix) => prefix === "/" || (prefix && parsed.pathname.startsWith(prefix)));
  } catch { return true; }
}

async function fetchText(url, accept = "text/html,application/xhtml+xml") {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { text: await response.text(), resolvedUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
}

async function discoverPublicClient() {
  const { text: html, resolvedUrl } = await fetchText(sourceUrl);
  const scriptMatch = html.match(/<script\b[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["']([^"']+\.js)["'][^>]*>/i)
    || html.match(/<script\b[^>]*src\s*=\s*["']([^"']+assets\/[^"']+\.js)["'][^>]*>/i);
  if (!scriptMatch) throw new Error("client_bundle_not_found");
  const bundleUrl = safeUrl(scriptMatch[1], resolvedUrl);
  if (!bundleUrl) throw new Error("client_bundle_url_invalid");
  const { text: bundle } = await fetchText(bundleUrl, "text/javascript,application/javascript");
  const supabaseUrl = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/i)?.[0];
  const anonKey = bundle.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  if (!supabaseUrl || !anonKey) throw new Error("public_supabase_client_not_found");
  return { supabaseUrl, anonKey, bundleUrl };
}

async function fetchHappyHours(client) {
  const select = [
    "id", "slug", "venue_name", "special_title", "deal_type", "deal_details", "days_of_week",
    "start_time", "end_time", "second_start_time", "second_end_time", "venue_address",
    "neighbourhood", "price_from", "external_url", "image_url", "valid_from", "valid_until",
    "status", "verification_status", "last_verified", "is_active", "is_featured", "is_claimable",
    "created_at", "updated_at"
  ].join(",");
  const query = new URLSearchParams({
    select,
    status: "eq.approved",
    is_active: "eq.true",
    order: "updated_at.desc",
    limit: String(limit)
  });
  const apiUrl = `${client.supabaseUrl}/rest/v1/happy_hours?${query}`;
  const response = await fetch(apiUrl, {
    headers: {
      apikey: client.anonKey,
      authorization: `Bearer ${client.anonKey}`,
      accept: "application/json",
      "User-Agent": userAgent
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`api_http_${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function normalizeTime(value) {
  const match = String(value ?? "").match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function normalizeDays(days) {
  if (!Array.isArray(days)) return null;
  const mapped = days.map((day) => dayNames[Number(day)]).filter(Boolean);
  return mapped.length ? [...new Set(mapped)] : null;
}

function specialType(row) {
  const text = `${row.special_title || ""} ${row.deal_type || ""} ${row.deal_details || ""}`.toLowerCase();
  if (/happy hour/.test(text)) return "happy_hour";
  if (/oyster|shuck/.test(text)) return "oyster_special";
  if (/wing/.test(text)) return "wing_night";
  if (/taco/.test(text)) return "taco_night";
  if (/wine/.test(text)) return "wine_special";
  if (/brunch/.test(text)) return "brunch";
  if (/cocktail|beer|draught|draft|drink|bubbles/.test(text)) return "happy_hour";
  return "daily_or_promotional_special";
}

function buildRecurrence(row) {
  const days = normalizeDays(row.days_of_week);
  const start = normalizeTime(row.start_time);
  const end = normalizeTime(row.end_time);
  const secondStart = normalizeTime(row.second_start_time);
  const secondEnd = normalizeTime(row.second_end_time);
  const dayLabel = days?.length === 7 ? "Daily" : days?.map((day) => day.slice(0, 3)).join(", ");
  const windows = [start && end ? `${start}-${end}` : null, secondStart && secondEnd ? `${secondStart}-${secondEnd}` : null].filter(Boolean);
  return [dayLabel, windows.join(" and ")].filter(Boolean).join(" ") || null;
}

const catalogRecords = catalog.restaurants || [];
const byName = new Map();
for (const restaurant of catalogRecords) {
  const key = normalize(restaurant.name);
  if (!key) continue;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(restaurant);
}
const websiteRefs = [];
for (const restaurant of catalogRecords) {
  for (const url of [restaurant.website, ...(restaurant.sources || []).map((item) => item.url)].filter(Boolean)) {
    const host = canonicalHost(url);
    if (host) websiteRefs.push({ restaurant, host });
  }
}

function resolve(row) {
  const nameKey = normalize(row.venue_name);
  const exactName = byName.get(nameKey) || [];
  if (exactName.length === 1) return { restaurantId: exactName[0].id, matchMethod: "exact_name", matchConfidence: "high" };

  const candidateStreet = streetKey(row.venue_address);
  const addressMatches = candidateStreet
    ? catalogRecords.filter((restaurant) => streetKey(restaurant.address) === candidateStreet)
    : [];
  if (addressMatches.length === 1) return { restaurantId: addressMatches[0].id, matchMethod: "street_address", matchConfidence: "high" };

  const host = canonicalHost(row.external_url);
  if (host) {
    const hostMatches = websiteRefs.filter((ref) => ref.host === host);
    if (hostMatches.length === 1) return { restaurantId: hostMatches[0].restaurant.id, matchMethod: "unique_website_host", matchConfidence: "high" };
    const nameMatches = hostMatches.filter((ref) => {
      const key = normalize(ref.restaurant.name);
      const shorter = key.length < nameKey.length ? key : nameKey;
      const longer = key.length < nameKey.length ? nameKey : key;
      return shorter.length >= 5 && longer.includes(shorter);
    });
    const ids = [...new Set(nameMatches.map((item) => item.restaurant.id))];
    if (ids.length === 1) return { restaurantId: ids[0], matchMethod: "website_host_name", matchConfidence: "probable" };
  }

  const fuzzy = catalogRecords.filter((restaurant) => {
    const key = normalize(restaurant.name);
    if (!key || key.length < 4 || !nameKey) return false;
    const shorter = key.length < nameKey.length ? key : nameKey;
    const longer = key.length < nameKey.length ? nameKey : key;
    return shorter.length >= 5 && longer.includes(shorter) && shorter.length / longer.length >= 0.65;
  });
  const fuzzyIds = [...new Set(fuzzy.map((match) => match.id))];
  if (fuzzyIds.length === 1) return { restaurantId: fuzzyIds[0], matchMethod: "fuzzy_name", matchConfidence: "probable" };

  return {
    restaurantId: null,
    matchMethod: fuzzyIds.length > 1 || exactName.length > 1 || addressMatches.length > 1 ? "conflict" : "unresolved",
    matchConfidence: "needs_review",
    reviewCandidates: [...new Set([...exactName, ...addressMatches, ...fuzzy].map((item) => item.id))].slice(0, 12)
  };
}

function sourceImageUrl(row, client) {
  const raw = safeUrl(row.image_url);
  if (raw) return raw;
  const path = String(row.image_url ?? "").trim().replace(/^\/+/, "");
  return path ? safeUrl(`${client.supabaseUrl}/storage/v1/object/public/event-images/${path}`) : null;
}

const failures = [];
let sourceClient = null;
let rawRows = [];
try {
  sourceClient = await discoverPublicClient();
  rawRows = await fetchHappyHours(sourceClient);
} catch (error) {
  failures.push({ sourceId, sourceName, sourceUrl, reason: error.message, observedAt });
}

const records = rawRows.map((row) => {
  const sourceRecordId = `${sourceId}-${slug(row.slug || row.venue_name || "special")}-${hashId(row.id || JSON.stringify(row))}`;
  const startTime = normalizeTime(row.start_time);
  const endTime = normalizeTime(row.end_time);
  const validTo = row.valid_until || null;
  return {
    sourceRecordId,
    restaurantId: null,
    venueName: row.venue_name || null,
    title: row.special_title || "Happy hour",
    specialType: specialType(row),
    dealType: row.deal_type || null,
    description: row.deal_details || null,
    dayOfWeek: normalizeDays(row.days_of_week),
    startTime,
    endTime,
    secondStartTime: normalizeTime(row.second_start_time),
    secondEndTime: normalizeTime(row.second_end_time),
    recurrence: buildRecurrence(row),
    address: row.venue_address || null,
    neighborhood: row.neighbourhood || null,
    price: row.price_from === null || row.price_from === undefined ? null : Number(row.price_from),
    currency: row.price_from === null || row.price_from === undefined ? null : "CAD",
    validFrom: row.valid_from || null,
    validTo,
    sourceUrl: safeUrl(row.external_url) || sourceUrl,
    sourcePageUrl: sourceUrl,
    sourceId,
    sourceName,
    sourceKind: "public_happy_hour_directory",
    sourceType: "public_directory_special_lead",
    sourceStatus: row.verification_status || "Listed",
    observedAt,
    sourceUpdatedAt: row.updated_at || null,
    lastVerifiedAt: row.last_verified || null,
    reviewState: "source_signal",
    rightsState: row.image_url ? "requires_rights_review" : null,
    sourceImageUrl: sourceClient ? sourceImageUrl(row, sourceClient) : null,
    rawStatus: row.status || null,
    active: Boolean(row.is_active),
    featured: Boolean(row.is_featured),
    claimable: Boolean(row.is_claimable),
    ...resolve(row)
  };
}).sort((a, b) => (a.restaurantId ? 0 : 1) - (b.restaurantId ? 0 : 1) || String(a.venueName || "").localeCompare(String(b.venueName || "")));

const counts = {
  total: records.length,
  resolved: records.filter((record) => record.restaurantId).length,
  unresolved: records.filter((record) => !record.restaurantId && record.matchMethod === "unresolved").length,
  conflicts: records.filter((record) => record.matchMethod === "conflict").length,
  happyHour: records.filter((record) => record.specialType === "happy_hour").length,
  withPrice: records.filter((record) => record.price !== null && Number.isFinite(Number(record.price))).length,
  withSchedule: records.filter((record) => Array.isArray(record.dayOfWeek) && record.dayOfWeek.length && record.startTime && record.endTime).length,
  withSourceImage: records.filter((record) => record.sourceImageUrl).length
};

const payload = {
  version: 1,
  generatedAt: observedAt,
  source: {
    id: sourceId,
    name: sourceName,
    kind: "public_happy_hour_directory",
    url: sourceUrl,
    publicClientDiscovered: Boolean(sourceClient),
    clientBundleUrl: sourceClient?.bundleUrl || null,
    contentTypes: ["special", "happy_hour", "schedule", "price", "review_image_candidate"],
    reviewPolicy: "Records are treated as public directory source leads until restaurant-owned source review confirms them."
  },
  counts,
  records,
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/public-special-source-leads.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(new URL("../data/public-special-source-leads.js", import.meta.url), `window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS = ${JSON.stringify(payload, null, 2)};\n`);

console.log(`Public special leads: total=${counts.total}, resolved=${counts.resolved}, unresolved=${counts.unresolved}, conflicts=${counts.conflicts}, happyHour=${counts.happyHour}, failures=${failures.length}.`);
for (const record of records.filter((item) => !item.restaurantId).slice(0, 15)) {
  console.log(`- review: ${record.venueName}${record.address ? ` @ ${record.address}` : ""}`);
}
