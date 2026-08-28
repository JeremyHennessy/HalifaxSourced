import { readFile, writeFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../data/place-source-registry.json", import.meta.url), "utf8"));
const payloadPath = new URL("../data/build/directory-restaurant-leads.json", import.meta.url);
const jsPath = new URL("../data/directory-restaurant-leads.js", import.meta.url);
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
const source = (registry.sources || []).find((item) => item.id === "downtown-dartmouth-food-drink");
if (!source) throw new Error("Missing downtown-dartmouth-food-drink source registry entry.");

const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const SOCIAL_HOSTS = new Map([
  ["facebook.com", "facebook"], ["instagram.com", "instagram"], ["tiktok.com", "tiktok"],
  ["threads.net", "threads"], ["x.com", "x"], ["twitter.com", "x"], ["youtube.com", "youtube"],
  ["linkedin.com", "linkedin"], ["bsky.app", "bluesky"]
]);
const ACTION_HOSTS = new Map([
  ["opentable.ca", "reservations"], ["opentable.com", "reservations"], ["resy.com", "reservations"],
  ["exploretock.com", "reservations"], ["sevenrooms.com", "reservations"], ["bookenda.com", "reservations"],
  ["ritual.co", "ordering"], ["doordash.com", "ordering"], ["ubereats.com", "ordering"],
  ["skipthedishes.com", "ordering"], ["toasttab.com", "ordering"], ["order.online", "ordering"]
]);

function decode(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|section|article|h1|h2|h3|h4)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}
function hostMatch(value, map) {
  for (const [domain, kind] of map) if (value === domain || value.endsWith(`.${domain}`)) return kind;
  return null;
}
function slug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}
function phone(text) {
  return String(text).match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)?.[0] || null;
}
function addressLine(line) {
  return /\b\d{1,5}[A-Z]?[- ]+[^\n]{1,90}\b(?:Street|St\.?|Road|Rd\.?|Drive|Dr\.?|Avenue|Ave\.?|Place|Pl\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Highway|Hwy\.?|Wharf|Mall|Row|Terrace|Way)\b/i.test(line);
}
function genericLine(line) {
  return /^(food\s*&\s*drink|downtown dartmouth|all together,? downtown d\s*artmouth|search|view website|subscribe|thanks for submitting|connect|image)$/i.test(line) || /^©?\s*2026/i.test(line);
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  try {
    const response = await fetch(new URL("/robots.txt", parsed.origin), { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) return true;
    const lines = (await response.text()).split(/\r?\n/);
    let wildcard = false;
    const disallow = [];
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, "").trim();
      if (/^user-agent\s*:\s*\*\s*$/i.test(line)) { wildcard = true; continue; }
      if (/^user-agent\s*:/i.test(line)) { wildcard = false; continue; }
      if (wildcard) {
        const match = line.match(/^disallow\s*:\s*(.*)$/i);
        if (match?.[1]) disallow.push(match[1].trim());
      }
    }
    return !disallow.some((prefix) => prefix === "/" || parsed.pathname.startsWith(prefix));
  } catch { return true; }
}

if (!(await robotsAllows(source.url))) throw new Error("robots_disallow:downtown-dartmouth-food-drink");
const response = await fetch(source.url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`http_${response.status}:downtown-dartmouth-food-drink`);
const html = await response.text();
const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .filter((match) => /^view website$/i.test(decode(match[2])));

const records = [];
let previousEnd = Math.max(0, anchors[0]?.index ? anchors[0].index - 5000 : 0);
for (let index = 0; index < anchors.length; index += 1) {
  const anchor = anchors[index];
  const chunk = html.slice(previousEnd, anchor.index);
  previousEnd = anchor.index + anchor[0].length;
  const lines = decode(chunk).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let addressIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) if (addressLine(lines[i])) { addressIndex = i; break; }
  if (addressIndex < 0) continue;
  let name = null;
  for (let i = addressIndex - 1; i >= Math.max(0, addressIndex - 8); i -= 1) {
    const line = lines[i];
    if (!line || genericLine(line) || /@/.test(line) || phone(line) || line.length > 120) continue;
    name = line;
    break;
  }
  if (!name) continue;
  const addressParts = [lines[addressIndex]];
  if (/Dartmouth|\bNS\b|Nova Scotia/i.test(lines[addressIndex + 1] || "")) addressParts.push(lines[addressIndex + 1]);
  const address = addressParts.join(" ").replace(/\s+/g, " ").trim();
  const href = safeUrl(anchor[1], response.url || source.url);
  if (!href) continue;
  const outboundHost = host(href);
  const social = hostMatch(outboundHost, SOCIAL_HOSTS);
  const action = hostMatch(outboundHost, ACTION_HOSTS);
  const website = !social && !action && outboundHost && outboundHost !== host(source.url) ? href : null;
  const socialProfiles = social ? [{ platform: social, url: href, associationBasis: "trusted_directory_explicit_link" }] : [];
  const actionLinks = action ? [{ kind: action, url: href, label: "View Website", associationBasis: "trusted_directory_explicit_link" }] : [];
  records.push({
    id: `ddbc-${slug(name)}-${slug(address)}`,
    name,
    category: "Food & Drink",
    address,
    city: "Dartmouth",
    neighborhood: "Downtown Dartmouth",
    website,
    socialProfiles,
    linkHubs: [],
    actionLinks,
    phone: phone(lines.slice(addressIndex, addressIndex + 6).join(" ")) || phone(chunk),
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: "business_improvement_district_directory",
    sourceUrl: source.url,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  });
}

const existing = (payload.records || []).filter((record) => record.sourceId !== source.id);
const knownNames = new Set(existing.filter((record) => record.alreadyInCatalogByName).map((record) => normalize(record.name)));
const deduped = records.filter((record, index, all) => all.findIndex((item) => normalize(item.name) === normalize(record.name) && normalize(item.address) === normalize(record.address)) === index)
  .map((record) => ({ ...record, alreadyInCatalogByName: knownNames.has(normalize(record.name)), alreadyInCatalog: knownNames.has(normalize(record.name)) }));

payload.records = [...existing, ...deduped];
payload.count = payload.records.length;
payload.newToCatalogCount = payload.records.filter((record) => !record.alreadyInCatalogByName).length;
payload.sources = (payload.sources || []).filter((item) => item.id !== source.id).concat({ id: source.id, name: source.name, kind: source.kind, url: source.url, directoryEntriesObserved: deduped.length, parserMode: "view_website_address_blocks" });
await writeFile(payloadPath, JSON.stringify(payload, null, 2));
await writeFile(jsPath, `window.HALIFAX_DIRECTORY_RESTAURANT_LEADS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Downtown Dartmouth refinement: anchors=${anchors.length}, records=${deduped.length}.`);
for (const record of deduped.slice(0, 12)) console.log(`- ${record.name} | ${record.address} | ${record.website || record.socialProfiles[0]?.url || record.actionLinks[0]?.url || "no outbound"}`);
if (deduped.length < 10) throw new Error(`downtown_dartmouth_parse_too_thin:${deduped.length}`);
