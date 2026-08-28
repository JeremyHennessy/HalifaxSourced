import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const knownNames = new Set((catalog.restaurants || []).map((restaurant) => normalize(restaurant.name)));
const userAgent = "HalifaxSourced/0.4 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const maxTourismPages = Number(process.env.NS_TOURISM_PAGE_LIMIT ?? 30);
const downtownDetailLimit = Number(process.env.DOWNTOWN_DIRECTORY_DETAIL_LIMIT ?? 120);

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

function externalLinks(html, baseUrl) {
  const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  const links = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === baseHost || host.endsWith(`.${baseHost}`)) continue;
    links.push({ url, label: decode(match[2]).slice(0, 120), host });
  }
  return links;
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

async function get(url) {
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
    const links = externalLinks(block, pageUrl);
    const website = links
      .map((link) => link.url)
      .find((url) => !/google\.com|facebook\.com|instagram\.com|x\.com|twitter\.com/i.test(url)) || null;

    records.push({
      id: `ns-tourism-${slug(name)}-${slug(address || postalCode || String(index))}`,
      name,
      category: eatDrinkType,
      address: [address, postalCode].filter(Boolean).join(", ") || null,
      city: "Halifax Metro",
      website,
      coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      phone,
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

  const website = links
    .filter((link) => !/google\.|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com/i.test(link.host))
    .map((link) => link.url)
    .find(Boolean) || null;

  const facebook = links.find((link) => /(^|\.)facebook\.com$/i.test(link.host))?.url || null;
  const instagram = links.find((link) => /(^|\.)instagram\.com$/i.test(link.host))?.url || null;

  return {
    id: `dhbc-${slug(name)}-${slug(address || new URL(url).pathname.split("/").at(-1))}`,
    name,
    category: "Food & Drink",
    address,
    city: "Downtown Halifax",
    website,
    socialProfiles: [
      facebook ? { platform: "facebook", url: facebook } : null,
      instagram ? { platform: "instagram", url: instagram } : null
    ].filter(Boolean),
    sourceName: "Downtown Halifax Business Commission",
    sourceKind: "downtown_halifax_directory",
    sourceUrl: url,
    observedAt: new Date().toISOString(),
    reviewState: "directory-listed"
  };
}

const records = [];
const failures = [];
const sourceMeta = [];

let previousFingerprint = null;
let emptyPages = 0;
for (let page = 1; page <= maxTourismPages; page += 1) {
  const url = `https://novascotia.com/plain-listings-ai-datasource/?listing_page=${page}`;
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
    failures.push({ sourceName: "NovaScotia.com", sourceUrl: url, reason: error.message });
    if (page > 2) break;
  }
}
sourceMeta.push({ name: "NovaScotia.com", kind: "nova_scotia_tourism_directory", url: "https://novascotia.com/plain-listings-ai-datasource/" });

const downtownUrl = "https://members.downtownhalifax.ca/directory/Search/food-drink-526691";
try {
  const { html } = await get(downtownUrl);
  const links = downtownDetailLinks(html, downtownUrl);
  const unknown = links.filter((item) => !knownNames.has(normalize(item.name))).slice(0, downtownDetailLimit);

  for (let index = 0; index < unknown.length; index += 6) {
    const batch = unknown.slice(index, index + 6);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        const { html: detailHtml, resolvedUrl } = await get(item.url);
        return parseDowntownDetail(detailHtml, resolvedUrl, item.name);
      } catch (error) {
        failures.push({ sourceName: "Downtown Halifax Business Commission", sourceUrl: item.url, reason: error.message });
        return null;
      }
    }));
    records.push(...results.filter(Boolean));
  }

  sourceMeta.push({
    name: "Downtown Halifax Business Commission",
    kind: "downtown_halifax_directory",
    url: downtownUrl,
    directoryEntriesObserved: links.length,
    newNameCandidatesChecked: unknown.length
  });
} catch (error) {
  failures.push({ sourceName: "Downtown Halifax Business Commission", sourceUrl: downtownUrl, reason: error.message });
}

const uniqueRecords = records.filter((record, index, all) => {
  const key = `${normalize(record.name)}|${normalize(record.address)}`;
  return all.findIndex((item) => `${normalize(item.name)}|${normalize(item.address)}` === key) === index;
}).map((record) => ({
  ...record,
  alreadyInCatalog: knownNames.has(normalize(record.name))
}));

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: sourceMeta,
  count: uniqueRecords.length,
  newToCatalogCount: uniqueRecords.filter((record) => !record.alreadyInCatalog).length,
  records: uniqueRecords,
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/directory-restaurant-leads.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/directory-restaurant-leads.js", import.meta.url), `window.HALIFAX_DIRECTORY_RESTAURANT_LEADS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Directory discovery: records=${payload.count}, new-to-catalog=${payload.newToCatalogCount}, failures=${failures.length}.`);
