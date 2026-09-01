import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourceId = "downtown-halifax-patios-2026";
const sourceName = "Downtown Halifax patio directory";
const sourceUrl = "https://downtownhalifax.ca/patios";
const timeoutMs = Number(process.env.PATIO_DIRECTORY_TIMEOUT_MS ?? 12000);
const userAgent = "HalifaxSourced/0.8 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const observedAt = new Date().toISOString();

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/place-source-registry.json", import.meta.url), "utf8"));

function source(id) {
  const record = (registry.sources || []).find((item) => item.id === id);
  if (!record) throw new Error(`Missing place source registry entry: ${id}`);
  return record;
}

function decode(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function cleanName(value) {
  return decode(value)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|restaurant|bar|cafe|café|pub|grill|kitchen|lounge)\b/g, " ")
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
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 14);
}

function safeUrl(value, base = sourceUrl) {
  try {
    const url = new URL(String(value ?? "").replaceAll("&amp;", "&"), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function canonicalHost(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function normalizedPathTokens(value) {
  try {
    return new URL(value).pathname
      .split("/")
      .map((part) => normalize(part))
      .filter((part) => part.length >= 4);
  } catch { return []; }
}

function streetKey(value) {
  const text = String(value ?? "").toLowerCase()
    .replace(/\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|boulevard|blvd\.|waterfront)\b/g, (word) => {
      if (word.startsWith("st")) return "st";
      if (word.startsWith("rd") || word === "road") return "rd";
      if (word.startsWith("ave") || word === "avenue") return "ave";
      if (word.startsWith("dr") || word === "drive") return "dr";
      if (word.startsWith("blvd") || word === "boulevard") return "blvd";
      if (word.startsWith("ln") || word === "lane") return "ln";
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

async function get(url) {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { html: await response.text(), resolvedUrl: response.url || url };
}

function extractCards(html, resolvedUrl) {
  const blocks = String(html)
    .split(/(?=<div class="c-info-card">)/gi)
    .map((block) => block.trim())
    .filter((block) => /^<div class="c-info-card">/i.test(block));
  return blocks.map((block, index) => {
    const nameRaw = block.match(/<h4\b[^>]*>\s*<strong\b[^>]*>([\s\S]*?)<\/strong>\s*<\/h4>/i)?.[1];
    const name = cleanName(nameRaw);
    if (!name) return null;
    const address = decode(block.match(/<h4\b[\s\S]*?<\/h4>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const website = safeUrl(block.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1], resolvedUrl);
    const imageUrl = safeUrl(block.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i)?.[1], resolvedUrl);
    const dogFriendly = /\p{Extended_Pictographic}/u.test(String(nameRaw || ""));
    return {
      sourceRecordId: `${sourceId}-${slug(name)}-${hashId(`${website || ""}|${address || ""}|${index}`)}`,
      name,
      address: address || null,
      website,
      sourceImageUrl: imageUrl,
      dogFriendly,
      feature: "patio",
      sourceUrl,
      observedAt,
      sourceId,
      sourceName,
      sourceKind: "business_improvement_district_patio_list",
      confidence: "source_backed_feature_candidate",
      reviewState: "source_signal",
      rightsState: imageUrl ? "requires_rights_review" : null
    };
  }).filter(Boolean);
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
    if (host) websiteRefs.push({ restaurant, url, host, pathTokens: normalizedPathTokens(url) });
  }
}

function resolve(card) {
  const nameKey = normalize(card.name);
  const exactName = byName.get(nameKey) || [];
  if (exactName.length === 1) return { restaurantId: exactName[0].id, matchMethod: "exact_name", matchConfidence: "high" };

  const candidateStreet = streetKey(card.address);
  const addressMatches = candidateStreet
    ? catalogRecords.filter((restaurant) => streetKey(restaurant.address) === candidateStreet)
    : [];
  if (addressMatches.length === 1) return { restaurantId: addressMatches[0].id, matchMethod: "street_address", matchConfidence: "high" };

  const host = canonicalHost(card.website);
  if (host) {
    const hostMatches = websiteRefs.filter((ref) => ref.host === host);
    if (hostMatches.length === 1) return { restaurantId: hostMatches[0].restaurant.id, matchMethod: "unique_website_host", matchConfidence: "high" };
    const pathTokens = normalizedPathTokens(card.website);
    const tokenMatches = hostMatches.filter((ref) => {
      const refText = `${normalize(ref.restaurant.name)} ${ref.pathTokens.join(" ")}`;
      return pathTokens.some((token) => refText.includes(token)) || normalize(ref.restaurant.name).includes(nameKey) || nameKey.includes(normalize(ref.restaurant.name));
    });
    const uniqueIds = [...new Set(tokenMatches.map((match) => match.restaurant.id))];
    if (uniqueIds.length === 1) return { restaurantId: uniqueIds[0], matchMethod: "website_path_or_name", matchConfidence: "probable" };
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

const failures = [];
let records = [];
try {
  const { html, resolvedUrl } = await get(sourceUrl);
  records = extractCards(html, resolvedUrl).map((card) => ({ ...card, ...resolve(card) }));
} catch (error) {
  failures.push({ sourceId, sourceName, sourceUrl, reason: error.message, observedAt });
}

records.sort((a, b) => (a.restaurantId ? 0 : 1) - (b.restaurantId ? 0 : 1) || a.name.localeCompare(b.name));

const counts = {
  total: records.length,
  resolved: records.filter((record) => record.restaurantId).length,
  unresolved: records.filter((record) => !record.restaurantId && record.matchMethod === "unresolved").length,
  conflicts: records.filter((record) => record.matchMethod === "conflict").length,
  dogFriendly: records.filter((record) => record.dogFriendly).length,
  withWebsite: records.filter((record) => record.website).length,
  withSourceImage: records.filter((record) => record.sourceImageUrl).length
};

const payload = {
  version: 1,
  generatedAt: observedAt,
  source: source(sourceId),
  counts,
  records,
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/patio-directory-facts.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(new URL("../data/patio-directory-facts.js", import.meta.url), `window.HALIFAX_PATIO_DIRECTORY_FACTS = ${JSON.stringify(payload, null, 2)};\n`);

console.log(`Patio directory facts: total=${counts.total}, resolved=${counts.resolved}, unresolved=${counts.unresolved}, conflicts=${counts.conflicts}, dogFriendly=${counts.dogFriendly}, failures=${failures.length}.`);
for (const record of records.filter((item) => !item.restaurantId).slice(0, 15)) {
  console.log(`- review: ${record.name}${record.address ? ` @ ${record.address}` : ""}`);
}
