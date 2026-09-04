import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchRestaurantjiDirectory } from "./review-directory-sources.mjs";

const registry = JSON.parse(await readFile(new URL("../data/place-source-registry.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const payloadPath = new URL("../data/build/directory-restaurant-leads.json", import.meta.url);
const jsPath = new URL("../data/directory-restaurant-leads.js", import.meta.url);
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
let discoveredRestaurants = [];
try {
  const source = await readFile(new URL("../data/discovered-restaurants.js", import.meta.url), "utf8");
  const match = source.match(/window\.HALIFAX_DISCOVERED_RESTAURANTS\s*=\s*([\s\S]*);\s*$/);
  if (match) discoveredRestaurants = JSON.parse(match[1]);
} catch {}

const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();
const sourceMeta = (registry.sources || []).find((source) => source.id === "restaurantji-hrm-review-directory");
if (!sourceMeta) throw new Error("Missing restaurantji-hrm-review-directory source registry entry.");
if (sourceMeta.enabled === false) {
  console.log("Restaurantji review-directory source is disabled; no records imported.");
  process.exit(0);
}

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function slug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function robotsPatternToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp("^" + escaped);
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
        current = { agents: [], disallow: [], crawlDelay: null, hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.hasRules = true;
      if (key === "disallow" && value) current.disallow.push(value);
      if (key === "crawl-delay" && value) current.crawlDelay = Number(value);
    }
  }
  const specific = groups.find((group) => group.agents.some((agent) => agent.includes("halifaxsourced")));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  return specific || wildcard || { disallow: [], crawlDelay: null };
}

async function robotsRules(url) {
  const parsed = new URL(url);
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), {
          headers: { "User-Agent": userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(8000)
        });
        if (response.status === 401 || response.status === 403) return { disallow: ["/"], crawlDelay: null };
        if (!response.ok) return { disallow: [], crawlDelay: null };
        return parseRobots(await response.text());
      } catch { return { disallow: [], crawlDelay: null }; }
    })());
  }
  return robotsCache.get(parsed.origin);
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  const rules = await robotsRules(url);
  return !(rules.disallow || []).some((pattern) => pattern === "/" || (pattern && robotsPatternToRegExp(pattern).test(parsed.pathname)));
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

function unique(records) {
  return records.filter((record, index, all) => {
    const key = `${normalize(record.name)}|${normalize(record.address)}|${record.sourceId}`;
    return all.findIndex((item) => `${normalize(item.name)}|${normalize(item.address)}|${item.sourceId}` === key) === index;
  });
}

const knownNames = new Set([...(catalog.restaurants || []), ...discoveredRestaurants].map((restaurant) => normalize(restaurant.name)));
const result = await fetchRestaurantjiDirectory(sourceMeta, { get, normalize, slug, safeUrl, knownNames });
if (result.records.length < 120) throw new Error(`parser_yield_below_expected:${result.records.length}<120`);
const annotated = unique(result.records).map((record) => ({
  ...record,
  alreadyInCatalogByName: knownNames.has(normalize(record.name)),
  alreadyInCatalog: knownNames.has(normalize(record.name))
}));

payload.records = unique([...(payload.records || []).filter((record) => record.sourceId !== sourceMeta.id), ...annotated]);
payload.count = payload.records.length;
payload.newToCatalogCount = payload.records.filter((record) => !record.alreadyInCatalogByName).length;
payload.sources = (payload.sources || []).filter((source) => source.id !== sourceMeta.id).concat({
  id: sourceMeta.id,
  name: sourceMeta.name,
  kind: sourceMeta.kind,
  url: sourceMeta.url,
  directoryEntriesObserved: annotated.length,
  newNameCandidatesChecked: annotated.filter((record) => !record.alreadyInCatalogByName).length,
  cityPagesChecked: result.pages,
  parserMode: sourceMeta.parserMode
});
payload.failures = (payload.failures || []).filter((failure) => failure.sourceId !== sourceMeta.id);
payload.generatedAt = new Date().toISOString();

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(payloadPath, JSON.stringify(payload, null, 2));
await writeFile(jsPath, `window.HALIFAX_DIRECTORY_RESTAURANT_LEADS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Review directory import: source=${sourceMeta.id}, records=${annotated.length}, new-to-catalog-name=${annotated.filter((record) => !record.alreadyInCatalogByName).length}.`);
for (const page of result.pages) console.log(`- ${page.city}: observed=${page.observed}`);
