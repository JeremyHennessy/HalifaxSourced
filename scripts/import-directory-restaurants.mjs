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

function parseSackvilleDirectory(html, sourceMeta, options = {}) {
  const records = [];
  for (const row of String(html).matchAll(/<div\b[^>]*class=["'][^"']*views-row[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*views-row[^"']*["']|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>|$)/gi)) {
    const block = row[1];
    const title = block.match(/<h4\b[^>]*class=["'][^"']*field-content[^"']*["'][^>]*>\s*<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const name = decode(title?.[2] || "").replace(/\s+/g, " ").trim();
    if (!name || name.length > 120) continue;
    const sourceUrl = safeUrl(title?.[1], sourceMeta.url) || sourceMeta.url;
    const imageMatch = block.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i);
    const imageUrl = safeUrl(imageMatch?.[1], sourceMeta.url);
    const text = decode(block);
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const address = extractAddress(lines, options.city || "Lower Sackville");
    const phone = extractPhone(text);
    const outbound = classifyOutbound(block, sourceMeta.url);
    if (!address && !phone && !outbound.website && !outbound.socialProfiles.length && !outbound.actionLinks.length && !outbound.linkHubs.length) continue;

    records.push({
      id: `${options.idPrefix || sourceMeta.id}-${slug(name)}-${slug(address || sourceUrl)}`,
      name,
      category: "Food & Drink",
      address,
      city: options.city || "Lower Sackville",
      neighborhood: options.neighborhood || "Sackville",
      website: outbound.website,
      socialProfiles: outbound.socialProfiles,
      linkHubs: outbound.linkHubs,
      actionLinks: outbound.actionLinks,
      phone,
      sourceImageUrl: imageUrl || null,
      rightsState: imageUrl ? "requires_rights_review" : null,
      sourceId: sourceMeta.id,
      sourceName: sourceMeta.name,
      sourceKind: sourceMeta.kind,
      sourceUrl,
      observedAt: new Date().toISOString(),
      reviewState: "directory-listed"
    });
  }
  return records;
}
function metaContent(html, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta\\b(?=[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'])(?=[^>]*content\\s*=\\s*["']([^"']*)["'])[^>]*>`, "i"),
    new RegExp(`<meta\\b(?=[^>]*content\\s*=\\s*["']([^"']*)["'])(?=[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'])[^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match?.[1]) return decode(match[1]).replace(/\s+/g, " ").trim();
  }
  return null;
}

function bayersLakeDirectoryLinks(html, baseUrl) {
  const seen = new Set();
  const links = [];
  for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const payload = JSON.parse(match[1]);
      const items = payload?.mainEntity?.itemListElement || payload?.itemListElement || [];
      for (const item of items) {
        const name = decode(item?.name || item?.item?.name || "").replace(/\s+/g, " ").trim();
        const url = safeUrl(item?.url || item?.item?.url, baseUrl);
        const key = `${normalize(name)}|${url}`;
        if (!name || !url || seen.has(key) || name.length > 120) continue;
        seen.add(key);
        links.push({ name, url });
      }
    } catch {}
  }
  if (links.length) return links;

  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    const name = decode(match[2]).replace(/\s+/g, " ").trim();
    if (!url || !name || /^(?:View Details|Categories|Tags)$/i.test(name) || name.length > 120) continue;
    if (canonicalHost(url) !== canonicalHost(baseUrl)) continue;
    const path = new URL(url).pathname;
    if (!/^\/[a-z0-9-]+\/?$/i.test(path) || /^\/(?:category|tag)\/?$/i.test(path)) continue;
    const key = `${normalize(name)}|${url}`;
    if (!normalize(name) || seen.has(key)) continue;
    seen.add(key);
    links.push({ name, url });
  }
  return links;
}

function mapsAddress(html, baseUrl) {
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url || !/(?:^|\.)google\.(?:com|ca)$|maps\.app\.goo\.gl$/i.test(canonicalHost(url))) continue;
    const parsed = new URL(url);
    const value = parsed.searchParams.get("q") || parsed.searchParams.get("query") || decode(match[2]);
    const address = decodeURIComponent(value || "").replace(/\s+/g, " ").trim();
    if (/Halifax|Nova Scotia|\bNS\b|Bayers Lake|Chain Lake|Lacewood|Parkland/i.test(address)) return address;
  }
  return null;
}

function parseBayersLakeDetail(html, url, item) {
  const footerIndex = String(html).search(/<footer\b|Burnside Park|Bayers Lake Park Association/i);
  const detailHtml = footerIndex > 0 ? String(html).slice(0, footerIndex) : String(html);
  const title = decode((detailHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || metaContent(detailHtml, "og:title") || item?.name || "")
    .replace(/\s+-\s+Bayers Lake Business Directory\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = title.replace(/\s+[–-]\s+Bayers Lake.*$/i, "").trim() || item?.name;
  if (!name || name.length > 120) return null;

  const text = decode(detailHtml);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const outbound = classifyOutbound(detailHtml, url);
  if (outbound.website && /(?:^|\.)bayerslakepark\.com$|(?:^|\.)burnsidepark\.com$|(?:^|\.)directoryeasy\.com$/i.test(canonicalHost(outbound.website))) outbound.website = null;
  outbound.socialProfiles = outbound.socialProfiles.filter((profile, index, all) => {
    if (/bayerslakepark|directoryeasy|burnsidepark/i.test(profile.url)) return false;
    return all.findIndex((candidate) => candidate.platform === profile.platform && candidate.url === profile.url) === index;
  });
  const imageUrl = safeUrl(metaContent(detailHtml, "og:image") || metaContent(detailHtml, "twitter:image"), url);
  const description = metaContent(detailHtml, "description") || metaContent(detailHtml, "og:description");
  const address = mapsAddress(detailHtml, url) || extractAddress(lines, "Halifax");
  const phone = extractPhone(text);
  if (!address && !phone && !outbound.website && !outbound.socialProfiles.length && !outbound.actionLinks.length && !outbound.linkHubs.length) return null;

  return {
    id: `blbd-${slug(name)}-${slug(address || new URL(url).pathname.split("/").filter(Boolean).at(-1) || "restaurant")}`,
    name,
    category: "Restaurants",
    description: description || null,
    address,
    city: "Halifax",
    neighborhood: "Bayers Lake",
    website: outbound.website,
    socialProfiles: outbound.socialProfiles,
    linkHubs: outbound.linkHubs,
    actionLinks: outbound.actionLinks,
    phone,
    sourceImageUrl: imageUrl || null,
    rightsState: imageUrl ? "requires_rights_review" : null,
    sourceId: "bayers-lake-restaurants",
    sourceName: "Bayers Lake Business Directory",
    sourceKind: "business_improvement_district_directory",
    sourceUrl: url,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  };
}

async function fetchBayersLakeDirectory(sourceMeta) {
  const records = [];
  const { html, resolvedUrl } = await get(sourceMeta.url);
  const links = bayersLakeDirectoryLinks(html, resolvedUrl);
  for (let index = 0; index < links.length; index += 5) {
    const batch = links.slice(index, index + 5);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const { html: detailHtml, resolvedUrl: detailUrl } = await get(item.url);
        return parseBayersLakeDetail(detailHtml, detailUrl, item);
      } catch (error) {
        failures.push({ sourceId: sourceMeta.id, sourceName: sourceMeta.name, sourceUrl: item.url, reason: error.message });
        return null;
      }
    }));
    records.push(...results.filter(Boolean));
  }
  return { records, links, checked: links.length, unknown: records.filter((record) => !knownNames.has(normalize(record.name))).length };
}
const RANS_SEARCH_TERMS = [
  "Halifax", "Dartmouth", "Bedford", "Lower Sackville", "Sackville", "Bayers Lake",
  "Clayton Park", "Hammonds Plains", "Fall River", "Cole Harbour", "Timberlea", "Eastern Passage"
];
const RANS_COMMUNITIES = [
  "Lower Sackville", "Hammonds Plains", "Eastern Passage", "Cole Harbour", "Fall River",
  "Bayers Lake", "Clayton Park", "Dartmouth", "Bedford", "Timberlea", "Sackville", "Halifax"
];

async function getJson(url) {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { json: await response.json(), headers: response.headers, resolvedUrl: response.url || url };
}

function ransTermsByTaxonomy(record) {
  const terms = {};
  for (const group of record?._embedded?.["wp:term"] || []) {
    for (const term of group || []) {
      if (!term?.taxonomy || !term.name) continue;
      if (!terms[term.taxonomy]) terms[term.taxonomy] = [];
      terms[term.taxonomy].push(decode(term.name).replace(/\s+/g, " ").trim());
    }
  }
  return terms;
}

function ransMainHtml(html) {
  const source = String(html);
  const start = source.search(/<h1\b|FIND A RESTAURANT|post_title/i);
  const end = source.search(/CONTACT\s+Restaurant Association|<footer\b/i);
  return source.slice(start > 0 ? start : 0, end > 0 && end > start ? end : source.length);
}

function ransLabeledUrl(text, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`\\b${escaped}\\s+((?:https?:\\/\\/|www\\.)[^\\s]+)`, "i"));
  if (!match?.[1]) return null;
  const raw = match[1].replace(/[),.;]+$/g, "");
  return safeUrl(raw, raw.startsWith("www.") ? "https://" : undefined);
}

function ransSocialProfiles(text) {
  const profiles = [];
  for (const [label, platform] of [["Facebook", "facebook"], ["Instagram", "instagram"], ["YouTube", "youtube"], ["LinkedIn", "linkedin"], ["TikTok", "tiktok"], ["Twitter", "x"], ["X", "x"]]) {
    const url = ransLabeledUrl(text, label);
    if (!url || /RestAssocNS|restassocns|rans\.ca/i.test(url)) continue;
    profiles.push({ platform, url, associationBasis: "trusted_directory_explicit_link" });
  }
  return profiles.filter((profile, index, all) => all.findIndex((item) => item.platform === profile.platform && item.url === profile.url) === index);
}
function extractRansPhone(html, text) {
  const tel = String(html).match(/href\s*=\s*["']tel:([^"']+)["']/i)?.[1];
  const raw = tel || extractPhone(text) || String(text).match(/\b(?:902|782)\d{7}\b/)?.[0] || null;
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw.trim();
}

function extractRansAddress(text) {
  const streetTypes = "Street|St\\.?|Road|Rd\\.?|Drive|Dr\\.?|Avenue|Ave\\.?|Place|Pl\\.?|Lane|Ln\\.?|Boulevard|Blvd\\.?|Highway|Hwy\\.?|Wharf|Mall|Row|Terrace|Way|Crescent|Cres\\.?|Court|Ct\\.?|Parkway|Pkwy\\.?|Trail|Square";
  const community = RANS_COMMUNITIES.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`\\b\\d{1,5}[A-Z]?[- ](?:[^\\n]{1,120})\\b(?:${streetTypes})\\b(?:[^\\n]{0,180}?(?:${community}|Nova Scotia|\\bNS\\b|Canada)(?:[^\\n]{0,80})?)?`, "i");
  const match = String(text).replace(/\s+/g, " ").match(pattern);
  if (!match) return null;
  return match[0]
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+(?:https?:\/\/|www\.).*$/i, "")
    .replace(/\s+share\b.*$/i, "")
    .replace(/\s+CONTACT\b.*$/i, "")
    .trim();
}

function inferRansCommunity(record) {
  const text = [record.address, record.description, record.name].filter(Boolean).join(" ");
  return RANS_COMMUNITIES.find((community) => new RegExp(`\\b${community.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) || null;
}

function parseRansDetail(restRecord, html, sourceMeta) {
  const detailHtml = ransMainHtml(html);
  let text = decode(detailHtml);
  const contactIndex = text.search(/\bCONTACT\s+Restaurant Association\b/i);
  if (contactIndex > 0) text = text.slice(0, contactIndex).trim();
  const terms = ransTermsByTaxonomy(restRecord);
  const title = decode(restRecord?.title?.rendered || metaContent(detailHtml, "og:title") || "").replace(/\s+/g, " ").trim();
  const name = title.replace(/\s+-\s+Restaurant Association of Nova Scotia\s*$/i, "").trim();
  if (!name || name.length > 160) return null;
  const website = ransLabeledUrl(text, "Website");
  const socialProfiles = ransSocialProfiles(text);
  const media = restRecord?._embedded?.["wp:featuredmedia"]?.[0];
  const imageUrl = safeUrl(media?.source_url || metaContent(detailHtml, "og:image"), restRecord.link || sourceMeta.url);
  const description = metaContent(detailHtml, "og:description") || metaContent(detailHtml, "description");
  const address = extractRansAddress(text) || extractAddress(text.split(/\n+/), "Halifax");
  const phone = extractRansPhone(detailHtml, text);
  const cuisines = terms.restaurant_cuisine || [];
  const categories = terms.restaurant_category || [];
  const community = inferRansCommunity({ address, description, name });
  const featureTerms = [
    ...(terms.restaurant_accessibility || []).map((value) => `accessibility:${value}`),
    ...(terms.restaurant_deliverytake || []).map((value) => `service:${value}`),
    ...(terms.restaurant_parking || []).map((value) => `parking:${value}`),
    ...(terms["special-events"] || []).map((value) => `event:${value}`)
  ];
  if (/allow dogs on patio\s+Yes/i.test(text)) featureTerms.push("patio:dog-friendly");
  if (!community && !/Halifax|Dartmouth|Bedford|Sackville|Bayers Lake|Clayton Park|Hammonds Plains|Fall River|Cole Harbour|Timberlea|Eastern Passage/i.test(text)) return null;
  if (!address && !phone && !website && !socialProfiles.length) return null;

  return {
    id: `rans-${slug(name)}-${slug(address || restRecord.slug || restRecord.id)}`,
    name,
    category: categories[0] || "Restaurant Association listing",
    description: description || null,
    address,
    city: community || "Halifax Regional Municipality",
    neighborhood: community || null,
    website,
    socialProfiles,
    linkHubs: [],
    actionLinks: [],
    phone,
    cuisine: cuisines,
    tags: [...new Set([...categories, ...cuisines, ...featureTerms])],
    sourceImageUrl: imageUrl || null,
    rightsState: imageUrl ? "requires_rights_review" : null,
    sourceId: sourceMeta.id,
    sourceName: sourceMeta.name,
    sourceKind: sourceMeta.kind,
    sourceUrl: restRecord.link || sourceMeta.url,
    sourceUpdatedAt: restRecord.modified_gmt || restRecord.modified || null,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  };
}

async function fetchRansDirectory(sourceMeta) {
  const apiBase = (sourceMeta.apiUrl || new URL("/wp-json/wp/v2", sourceMeta.url).href).replace(/\/$/, "");
  const perPage = 100;
  const maxPagesPerTerm = Math.max(1, Number(process.env.RANS_SEARCH_PAGE_LIMIT || 2));
  const ids = new Map();
  let searchHits = 0;
  for (const term of RANS_SEARCH_TERMS) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, maxPagesPerTerm); page += 1) {
      const url = `${apiBase}/search?subtype=restaurant&per_page=${perPage}&page=${page}&search=${encodeURIComponent(term)}`;
      try {
        const { json, headers } = await getJson(url);
        totalPages = Number(headers.get("x-wp-totalpages") || 1);
        searchHits += Number(headers.get("x-wp-total") || json.length || 0);
        for (const item of json || []) if (item?.id && item?.url) ids.set(item.id, { id: item.id, url: item.url, title: item.title });
      } catch (error) {
        failures.push({ sourceId: sourceMeta.id, sourceName: sourceMeta.name, sourceUrl: url, reason: error.message });
        break;
      }
    }
  }

  const records = [];
  const targets = [...ids.values()];
  for (let index = 0; index < targets.length; index += 5) {
    const batch = targets.slice(index, index + 5);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const { json: restRecord } = await getJson(`${apiBase}/restaurant/${item.id}?_embed=1`);
        const { html, resolvedUrl } = await get(restRecord.link || item.url);
        return parseRansDetail({ ...restRecord, link: resolvedUrl || restRecord.link || item.url }, html, sourceMeta);
      } catch (error) {
        failures.push({ sourceId: sourceMeta.id, sourceName: sourceMeta.name, sourceUrl: item.url, reason: error.message });
        return null;
      }
    }));
    records.push(...results.filter(Boolean));
  }
  return { records, links: targets, checked: targets.length, searchHits, unknown: records.filter((record) => !knownNames.has(normalize(record.name))).length };
}
function quinpoolMemberLinks(html, baseUrl) {
  const seen = new Set();
  const links = [];
  for (const article of String(html).matchAll(/<article\b(?=[^>]*business_category-food-drink)[^>]*>([\s\S]*?)<\/article>/gi)) {
    const block = article[1];
    const title = block.match(/<h3\b[^>]*class=["'][^"']*elementor-post__title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const fallback = block.match(/<a\b[^>]*href\s*=\s*["']([^"']*\/member\/[^"']+)["'][^>]*aria-label=["']Read more about ([^"']+)["']/i);
    const url = safeUrl(title?.[1] || fallback?.[1], baseUrl);
    const name = decode(title?.[2] || fallback?.[2] || "").replace(/\s+/g, " ").trim();
    const imageMatch = block.match(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/i);
    const imageUrl = safeUrl(imageMatch?.[1], baseUrl);
    const key = normalize(`${name}|${url}`);
    if (!url || !normalize(name) || seen.has(key) || name.length > 120) continue;
    seen.add(key);
    links.push({ name, url, imageUrl });
  }
  return links;
}

function parseQuinpoolDetail(html, url, item) {
  const fallbackName = typeof item === "string" ? item : item?.name;
  const fallbackImageUrl = typeof item === "string" ? null : item?.imageUrl;
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name = decode(h1?.[1] || fallbackName).replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) return null;
  const footerIndex = String(html).search(/About QRMDA/i);
  const detailHtml = footerIndex > 0 ? String(html).slice(0, footerIndex) : String(html);
  const text = decode(detailHtml);
  if (!/Member Details/i.test(text)) return null;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const detailIndex = lines.findIndex((line) => /^Member Details$/i.test(line));
  const detailLines = detailIndex >= 0 ? lines.slice(detailIndex + 1) : lines;
  const outbound = classifyOutbound(detailHtml, url);
  if (outbound.website && /(?:^|\.)boom12\.ca$/i.test(canonicalHost(outbound.website))) outbound.website = null;
  outbound.socialProfiles = outbound.socialProfiles.filter((profile, index, all) => {
    const host = canonicalHost(profile.url);
    if (/quinpool(?:road|_road)|karlaonquinpool/i.test(profile.url)) return false;
    return all.findIndex((item) => item.platform === profile.platform && item.url === profile.url) === index;
  });
  const address = extractAddress(detailLines, "Halifax");
  const phone = extractPhone(text);
  if (!address && !outbound.website && !outbound.socialProfiles.length && !outbound.actionLinks.length && !outbound.linkHubs.length) return null;

  return {
    id: `qrmda-${slug(name)}-${slug(address || new URL(url).pathname.split("/").filter(Boolean).at(-1) || "member")}`,
    name,
    category: "Food & Drink",
    address,
    city: "Halifax",
    neighborhood: "Quinpool Road",
    website: outbound.website,
    socialProfiles: outbound.socialProfiles,
    linkHubs: outbound.linkHubs,
    actionLinks: outbound.actionLinks,
    phone,
    sourceImageUrl: fallbackImageUrl || null,
    rightsState: fallbackImageUrl ? "requires_rights_review" : null,
    sourceId: "quinpool-road-food-drink",
    sourceName: "Quinpool Road Mainstreet District Association",
    sourceKind: "business_improvement_district_directory",
    sourceUrl: url,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  };
}
async function fetchQuinpoolDirectory(sourceMeta) {
  const records = [];
  const { html, resolvedUrl } = await get(sourceMeta.url);
  const links = quinpoolMemberLinks(html, resolvedUrl);
  const targets = links;
  for (let index = 0; index < targets.length; index += 6) {
    const batch = targets.slice(index, index + 6);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const { html: detailHtml, resolvedUrl: detailUrl } = await get(item.url);
        return parseQuinpoolDetail(detailHtml, detailUrl, item);
      } catch (error) {
        failures.push({ sourceId: sourceMeta.id, sourceName: sourceMeta.name, sourceUrl: item.url, reason: error.message });
        return null;
      }
    }));
    records.push(...results.filter(Boolean));
  }
  return { records, links, checked: targets.length, unknown: records.filter((record) => !knownNames.has(normalize(record.name))).length };
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

const sackvilleSource = source("sackville-business-food-drink");
try {
  const { html, resolvedUrl } = await get(sackvilleSource.url);
  const parsed = parseSackvilleDirectory(html, { ...sackvilleSource, url: resolvedUrl }, { city: "Lower Sackville", neighborhood: "Sackville", idPrefix: "sba" });
  if (parsed.length < 25) throw new Error(`parser_yield_below_expected:${parsed.length}<25`);
  records.push(...parsed);
  sourceMeta.push({
    id: sackvilleSource.id,
    name: sackvilleSource.name,
    kind: sackvilleSource.kind,
    url: sackvilleSource.url,
    directoryEntriesObserved: parsed.length,
    parserMode: "drupal_food_drink_listing"
  });
} catch (error) {
  failures.push({ sourceId: sackvilleSource.id, sourceName: sackvilleSource.name, sourceUrl: sackvilleSource.url, reason: error.message });
}
const quinpoolSource = source("quinpool-road-food-drink");
try {
  const result = await fetchQuinpoolDirectory(quinpoolSource);
  if (result.links.length < 30) throw new Error(`parser_yield_below_expected:${result.links.length}<30`);
  records.push(...result.records);
  sourceMeta.push({
    id: quinpoolSource.id,
    name: quinpoolSource.name,
    kind: quinpoolSource.kind,
    url: quinpoolSource.url,
    directoryEntriesObserved: result.links.length,
    newNameCandidatesChecked: result.checked,
    parserMode: "member_directory_detail_pages"
  });
} catch (error) {
  failures.push({ sourceId: quinpoolSource.id, sourceName: quinpoolSource.name, sourceUrl: quinpoolSource.url, reason: error.message });
}
const ransSource = source("rans-restaurant-directory");
try {
  const result = await fetchRansDirectory(ransSource);
  if (result.records.length < 50) throw new Error(`parser_yield_below_expected:${result.records.length}<50`);
  records.push(...result.records);
  sourceMeta.push({
    id: ransSource.id,
    name: ransSource.name,
    kind: ransSource.kind,
    url: ransSource.url,
    directoryEntriesObserved: result.links.length,
    newNameCandidatesChecked: result.checked,
    searchHitsObserved: result.searchHits,
    parserMode: "wordpress_rest_search_plus_detail_pages"
  });
} catch (error) {
  failures.push({ sourceId: ransSource.id, sourceName: ransSource.name, sourceUrl: ransSource.url, reason: error.message });
}
const bayersLakeSource = source("bayers-lake-restaurants");
try {
  const result = await fetchBayersLakeDirectory(bayersLakeSource);
  if (result.links.length < 10) throw new Error(`parser_yield_below_expected:${result.links.length}<10`);
  records.push(...result.records);
  sourceMeta.push({
    id: bayersLakeSource.id,
    name: bayersLakeSource.name,
    kind: bayersLakeSource.kind,
    url: bayersLakeSource.url,
    directoryEntriesObserved: result.links.length,
    newNameCandidatesChecked: result.checked,
    parserMode: "next_static_business_directory"
  });
} catch (error) {
  failures.push({ sourceId: bayersLakeSource.id, sourceName: bayersLakeSource.name, sourceUrl: bayersLakeSource.url, reason: error.message });
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
