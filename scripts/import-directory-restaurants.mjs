import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/place-source-registry.json", import.meta.url), "utf8"));
let discoveredRestaurants = [];
try {
  const source = await readFile(new URL("../data/discovered-restaurants.js", import.meta.url), "utf8");
  const match = source.match(/window\.HALIFAX_DISCOVERED_RESTAURANTS\s*=\s*([\s\S]*);\s*$/);
  if (match) discoveredRestaurants = JSON.parse(match[1]);
} catch {}
const knownNames = new Set([...(catalog.restaurants || []), ...discoveredRestaurants].map((restaurant) => normalize(restaurant.name)));
const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const maxTourismPages = Number(process.env.NS_TOURISM_PAGE_LIMIT ?? 30);
const downtownDetailLimit = Number(process.env.DOWNTOWN_DIRECTORY_DETAIL_LIMIT ?? 120);
const robotsCache = new Map();

const SOCIAL_HOSTS = new Map([
  ["facebook.com", "facebook"], ["instagram.com", "instagram"], ["tiktok.com", "tiktok"],
  ["threads.net", "threads"], ["x.com", "x"], ["twitter.com", "x"], ["youtube.com", "youtube"],
  ["youtu.be", "youtube"], ["linkedin.com", "linkedin"], ["bsky.app", "bluesky"],
  ["pinterest.com", "pinterest"], ["snapchat.com", "snapchat"]
]);
const LINK_HUB_HOSTS = new Map([
  ["linktr.ee", "linktree"], ["beacons.ai", "beacons"], ["linkin.bio", "linkinbio"],
  ["campsite.bio", "campsite"], ["bento.me", "bento"]
]);
const ACTION_HOSTS = new Map([
  ["opentable.ca", "reservations"], ["opentable.com", "reservations"], ["resy.com", "reservations"],
  ["exploretock.com", "reservations"], ["sevenrooms.com", "reservations"], ["bookenda.com", "reservations"],
  ["touchbistro.com", "reservations"], ["ritual.co", "ordering"], ["doordash.com", "ordering"],
  ["ubereats.com", "ordering"], ["skipthedishes.com", "ordering"], ["chownow.com", "ordering"],
  ["toasttab.com", "ordering"], ["square.site", "ordering"], ["order.online", "ordering"]
]);

function source(id) {
  const match = (registry.sources || []).find((item) => item.id === id);
  if (!match) throw new Error(`Missing place source registry entry: ${id}`);
  return match;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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
    .replace(/&eacute;/gi, "é")
    .replace(/&egrave;/gi, "è")
    .replace(/&agrave;/gi, "à")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
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

function canonicalHost(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function externalLinks(html, baseUrl) {
  const baseHost = canonicalHost(baseUrl);
  const links = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const host = canonicalHost(url);
    if (!host || host === baseHost || host.endsWith(`.${baseHost}`)) continue;
    const inlineLabel = match[2].replace(/<\/?(?:span|strong|em|b|i)\b[^>]*>/gi, "");
    links.push({ url, label: decode(inlineLabel).slice(0, 120), host });
  }
  return links;
}

function hostMatch(host, registryMap) {
  for (const [domain, value] of registryMap) if (host === domain || host.endsWith(`.${domain}`)) return value;
  return null;
}

function classifyOutbound(html, baseUrl) {
  const links = externalLinks(html, baseUrl)
    .filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
  const socialProfiles = [];
  const linkHubs = [];
  const actionLinks = [];
  let website = null;

  for (const link of links) {
    if (/google\.(?:com|ca)$/.test(link.host) || /maps\.app\.goo\.gl$/.test(link.host)) continue;
    const social = hostMatch(link.host, SOCIAL_HOSTS);
    if (social) {
      socialProfiles.push({ platform: social, url: link.url, associationBasis: "trusted_directory_explicit_link" });
      continue;
    }
    const hub = hostMatch(link.host, LINK_HUB_HOSTS);
    if (hub) {
      linkHubs.push({ platform: hub, url: link.url, associationBasis: "trusted_directory_explicit_link" });
      continue;
    }
    const action = hostMatch(link.host, ACTION_HOSTS);
    if (action) {
      actionLinks.push({ kind: action, url: link.url, label: link.label || null, associationBasis: "trusted_directory_explicit_link" });
      continue;
    }
    if (!website) website = link.url;
  }
  return { website, socialProfiles, linkHubs, actionLinks };
}

function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`(?:^|\\n)${escaped}\\s*:\\s*([^\\n]+)`, "i"));
  return match ? match[1].trim() : null;
}

function slug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), {
          headers: { "User-Agent": userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(8000)
        });
        if (response.status === 401 || response.status === 403) return ["/"];
        if (!response.ok) return [];
        return parseRobots(await response.text());
      } catch { return []; }
    })());
  }
  const disallow = await robotsCache.get(parsed.origin);
  return !disallow.some((prefix) => prefix === "/" || (prefix && parsed.pathname.startsWith(prefix)));
}

async function get(url) {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { html: await response.text(), resolvedUrl: response.url || url };
}

function parseTourismPage(html, pageUrl) {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const records = [];
  for (let index = 0; index < headings.length; index += 1) {
    const name = decode(headings[index][1]);
    if (!name || name.length > 120) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : html.length;
    const block = html.slice(start, end);
    const text = decode(block);
    const eatDrinkType = field(text, "Eat drink type") || field(text, "Eat_drink_type");
    const region = field(text, "Region");
    if (!eatDrinkType || !/Halifax Metro/i.test(region || "")) continue;

    const listingUrl = field(text, "URL");
    const address = field(text, "Street address") || field(text, "Street_address");
    const postalCode = field(text, "Postal code") || field(text, "Postal_code");
    const phone = field(text, "Phone");
    const lat = Number(field(text, "Latitude"));
    const lon = Number(field(text, "Longitude"));
    const outbound = classifyOutbound(block, pageUrl);

    records.push({
      id: `ns-tourism-${slug(name)}-${slug(address || postalCode || String(index))}`,
      name,
      category: eatDrinkType,
      address: [address, postalCode].filter(Boolean).join(", ") || null,
      city: "Halifax Metro",
      website: outbound.website,
      socialProfiles: outbound.socialProfiles,
      linkHubs: outbound.linkHubs,
      actionLinks: outbound.actionLinks,
      coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      phone,
      sourceId: "ns-tourism-food-drink",
      sourceName: "NovaScotia.com",
      sourceKind: "nova_scotia_tourism_directory",
      sourceUrl: listingUrl && safeUrl(listingUrl, pageUrl) ? safeUrl(listingUrl, pageUrl) : pageUrl,
      observedAt: new Date().toISOString(),
      reviewState: "directory-listed"
    });
  }
  return records;
}

function downtownDetailLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*\/directory\/Details\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    const name = decode(match[2]);
    if (!url || !name || name.length > 120) continue;
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    links.push({ name, url });
  }
  return links;
}

function parseDowntownDetail(html, url, fallbackName) {
  const text = decode(html);
  if (!/Categories\s*\n?\s*Food\s*&\s*Drink/i.test(text)) return null;
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name = decode(h1?.[1] || fallbackName);
  const links = externalLinks(html, url);
  const address = links
    .filter((link) => /google\.(?:com|ca)$/i.test(link.host))
    .map((link) => link.label)
    .find((value) => /Halifax|Nova Scotia|\bNS\b/i.test(value)) || null;
  const outbound = classifyOutbound(html, url);

  return {
    id: `dhbc-${slug(name)}-${slug(address || new URL(url).pathname.split("/").at(-1))}`,
    name,
    category: "Food & Drink",
    address,
    city: "Downtown Halifax",
    website: outbound.website,
    socialProfiles: outbound.socialProfiles,
    linkHubs: outbound.linkHubs,
    actionLinks: outbound.actionLinks,
    sourceId: "downtown-halifax-food-drink",
    sourceName: "Downtown Halifax Business Commission",
    sourceKind: "downtown_halifax_directory",
    sourceUrl: url,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  };
}

function extractPhone(text) {
  return text.match(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/)?.[0] || null;
}

function extractAddress(lines, city) {
  const street = lines.find((line) => /\b\d{1,5}[A-Z]?[- ](?:[^\n]{1,80})\b(?:Street|St\.?|Road|Rd\.?|Drive|Dr\.?|Avenue|Ave\.?|Place|Pl\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Highway|Hwy\.?|Wharf|Mall|Row|Terrace|Way)\b/i.test(line));
  if (!street) return null;
  return /Nova Scotia|\bNS\b|Halifax|Dartmouth|Bedford/i.test(street) ? street : `${street}, ${city}, NS`;
}

function parseAssociationDirectory(html, sourceMeta, options = {}) {
  const cardMarker = /<div\b[^>]*\brole=["']region["'][^>]*\baria-label=["']content changes on hover["'][^>]*>/gi;
  const cardStarts = [...String(html).matchAll(cardMarker)];
  if (cardStarts.length) {
    const records = [];
    for (let index = 0; index < cardStarts.length; index += 1) {
      const start = cardStarts[index].index;
      const end = index + 1 < cardStarts.length ? cardStarts[index + 1].index : html.length;
      const block = html.slice(start, end);
      const links = externalLinks(block, sourceMeta.url);
      const primary = links.find((link) => link.label && link.label.length <= 120);
      if (!primary) continue;
      const name = primary.label.replace(/\s+/g, " ").trim();
      const text = decode(block);
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const outbound = classifyOutbound(block, sourceMeta.url);
      const address = extractAddress(lines, options.city || "Halifax");
      const phone = extractPhone(text);
      if (!address && !outbound.website && !outbound.socialProfiles.length && !outbound.actionLinks.length && !outbound.linkHubs.length) continue;

      records.push({
        id: `${options.idPrefix || sourceMeta.id}-${slug(name)}-${slug(address || primary.url || String(index))}`,
        name,
        category: "Food & Drink",
        address,
        city: options.city || "Halifax",
        neighborhood: options.neighborhood || null,
        website: outbound.website,
        socialProfiles: outbound.socialProfiles,
        linkHubs: outbound.linkHubs,
        actionLinks: outbound.actionLinks,
        phone,
        sourceId: sourceMeta.id,
        sourceName: sourceMeta.name,
        sourceKind: sourceMeta.kind,
        sourceUrl: sourceMeta.url,
        observedAt: new Date().toISOString(),
        reviewState: "directory-listed"
      });
    }
    return records;
  }

  const headingMatches = [...String(html).matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const records = [];
  let category = "Food & Drink";
  const categoryPattern = /restaurants?|pubs?|caf[eé]s?|coffee|quick service|food\s*&\s*drink/i;
  const generic = /^(food\s*&\s*drink|eat\s*&\s*drink|restaurants?\s*&\s*pubs?|caf[eé]s?\s*&?\s*coffee(?: shops?)?|quick service)$/i;

  for (let index = 0; index < headingMatches.length; index += 1) {
    const level = Number(headingMatches[index][1]);
    const heading = decode(headingMatches[index][2]);
    if (!heading) continue;
    if (categoryPattern.test(heading) && (generic.test(heading) || level === 2)) {
      category = heading.replace(/\s+/g, " ").trim();
      continue;
    }
    if (level < 3 || generic.test(heading) || heading.length < 2 || heading.length > 120 || heading.split(/\s+/).length > 12) continue;
    const start = headingMatches[index].index + headingMatches[index][0].length;
    const end = index + 1 < headingMatches.length ? headingMatches[index + 1].index : html.length;
    const block = html.slice(start, end);
    const text = decode(block);
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const outbound = classifyOutbound(block, sourceMeta.url);
    const address = extractAddress(lines, options.city || "Halifax");
    const phone = extractPhone(text);
    if (!address && !outbound.website && !outbound.socialProfiles.length && !outbound.actionLinks.length && !outbound.linkHubs.length) continue;

    records.push({
      id: `${options.idPrefix || sourceMeta.id}-${slug(heading)}-${slug(address || outbound.website || String(index))}`,
      name: heading,
      category,
      address,
      city: options.city || "Halifax",
      neighborhood: options.neighborhood || null,
      website: outbound.website,
      socialProfiles: outbound.socialProfiles,
      linkHubs: outbound.linkHubs,
      actionLinks: outbound.actionLinks,
      phone,
      sourceId: sourceMeta.id,
      sourceName: sourceMeta.name,
      sourceKind: sourceMeta.kind,
      sourceUrl: sourceMeta.url,
      observedAt: new Date().toISOString(),
      reviewState: "directory-listed"
    });
  }
  return records;
}

const records = [];
const failures = [];
const sourceMeta = [];

const tourismSource = source("ns-tourism-food-drink");
let previousFingerprint = null;
let emptyPages = 0;
for (let page = 1; page <= maxTourismPages; page += 1) {
  const url = `${tourismSource.url}?listing_page=${page}`;
  try {
    const { html } = await get(url);
    const pageRecords = parseTourismPage(html, url);
    const fingerprint = pageRecords.map((record) => `${record.name}|${record.address}`).join("\n");
    if (fingerprint && fingerprint === previousFingerprint) break;
    previousFingerprint = fingerprint || previousFingerprint;
    if (!pageRecords.length) {
      emptyPages += 1;
      if (emptyPages >= 2) break;
    } else {
      emptyPages = 0;
      records.push(...pageRecords);
    }
  } catch (error) {
    failures.push({ sourceId: tourismSource.id, sourceName: tourismSource.name, sourceUrl: url, reason: error.message });
    if (page > 2) break;
  }
}
sourceMeta.push({ id: tourismSource.id, name: tourismSource.name, kind: tourismSource.kind, url: tourismSource.url });

const downtownSource = source("downtown-halifax-food-drink");
try {
  const { html } = await get(downtownSource.url);
  const links = downtownDetailLinks(html, downtownSource.url);
  const unknown = links.filter((item) => !knownNames.has(normalize(item.name))).slice(0, downtownDetailLimit);
  for (let index = 0; index < unknown.length; index += 6) {
    const batch = unknown.slice(index, index + 6);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const { html: detailHtml, resolvedUrl } = await get(item.url);
        return parseDowntownDetail(detailHtml, resolvedUrl, item.name);
      } catch (error) {
        failures.push({ sourceId: downtownSource.id, sourceName: downtownSource.name, sourceUrl: item.url, reason: error.message });
        return null;
      }
    }));
    records.push(...results.filter(Boolean));
  }
  sourceMeta.push({ id: downtownSource.id, name: downtownSource.name, kind: downtownSource.kind, url: downtownSource.url, directoryEntriesObserved: links.length, newNameCandidatesChecked: unknown.length });
} catch (error) {
  failures.push({ sourceId: downtownSource.id, sourceName: downtownSource.name, sourceUrl: downtownSource.url, reason: error.message });
}

for (const config of [
  { sourceId: "downtown-dartmouth-food-drink", city: "Dartmouth", neighborhood: "Downtown Dartmouth", idPrefix: "ddbc", minimumObserved: 30 },
  { sourceId: "spring-garden-eat-drink", city: "Halifax", neighborhood: "Spring Garden", idPrefix: "sgaba" }
]) {
  const registered = source(config.sourceId);
  try {
    const { html, resolvedUrl } = await get(registered.url);
    const parsed = parseAssociationDirectory(html, { ...registered, url: resolvedUrl }, config);
    if (config.minimumObserved && parsed.length < config.minimumObserved) {
      throw new Error(`parser_yield_below_expected:${parsed.length}<${config.minimumObserved}`);
    }
    records.push(...parsed);
    sourceMeta.push({ id: registered.id, name: registered.name, kind: registered.kind, url: registered.url, directoryEntriesObserved: parsed.length });
  } catch (error) {
    failures.push({ sourceId: registered.id, sourceName: registered.name, sourceUrl: registered.url, reason: error.message });
  }
}

const uniqueRecords = records.filter((record, index, all) => {
  const key = `${normalize(record.name)}|${normalize(record.address)}|${record.sourceId}`;
  return all.findIndex((item) => `${normalize(item.name)}|${normalize(item.address)}|${item.sourceId}` === key) === index;
}).map((record) => ({
  ...record,
  alreadyInCatalogByName: knownNames.has(normalize(record.name)),
  alreadyInCatalog: knownNames.has(normalize(record.name))
}));

const payload = {
  version: 2,
  generatedAt: new Date().toISOString(),
  registryVersion: registry.version,
  sources: sourceMeta,
  count: uniqueRecords.length,
  newToCatalogCount: uniqueRecords.filter((record) => !record.alreadyInCatalogByName).length,
  records: uniqueRecords,
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/directory-restaurant-leads.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/directory-restaurant-leads.js", import.meta.url), `window.HALIFAX_DIRECTORY_RESTAURANT_LEADS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Directory discovery: records=${payload.count}, new-to-catalog-name=${payload.newToCatalogCount}, failures=${failures.length}.`);
for (const item of sourceMeta) console.log(`- ${item.id}: observed=${item.directoryEntriesObserved ?? "paged"}`);
