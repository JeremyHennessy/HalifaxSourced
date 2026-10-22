import { createRobotsAllows } from "./lib/robots-policy.mjs";
import { sourcePageDisposition, preserveAcceptedSources } from './lib/source-page-classification.mjs';
import { fetchPublicSource } from "./lib/fetch-public-source.mjs";
import integrity from "../source-integrity.js";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const signalsPath = new URL("../data/build/official-site-signals.json", import.meta.url);
const outputJson = new URL("../data/build/verified-source-pages.json", import.meta.url);
const outputJs = new URL("../data/verified-source-pages.js", import.meta.url);
const delayMs = Number(process.env.SOURCE_VERIFY_DELAY_MS ?? 250);
const pageLimit = Number(process.env.SOURCE_VERIFY_PAGE_LIMIT ?? 300);
const timeoutMs = Number(process.env.SOURCE_VERIFY_TIMEOUT_MS ?? 12000);
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsAllows = createRobotsAllows({ userAgent, timeoutMs });
const trustedCatalogScripts = new Set([
  new URL('../data/restaurants.js', import.meta.url).href,
  new URL('../data/osm-restaurants.js', import.meta.url).href
]);

async function loadWindowScript(url) {
  if (!(url instanceof URL) || !trustedCatalogScripts.has(url.href)) throw new Error('untrusted_local_catalog_script');
  const source = await readFile(url, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: url.pathname, timeout: 20_000 });
  return context.window;
}

// Accepted snapshots are not replaced by a partial crawl or inconclusive candidates.
// Parse errors must fail closed instead of silently treating existing data as empty.
const previous = JSON.parse(await readFile(outputJson, "utf8"));
const payload = JSON.parse(await readFile(signalsPath, "utf8"));
const signals = Array.isArray(payload?.results) ? payload.results : [];
const curatedWindow = await loadWindowScript(new URL("../data/restaurants.js", import.meta.url));
const osmWindow = await loadWindowScript(new URL("../data/osm-restaurants.js", import.meta.url));
const restaurants = [
  ...(Array.isArray(curatedWindow.HALIFAX_RESTAURANTS) ? curatedWindow.HALIFAX_RESTAURANTS : []),
  ...(Array.isArray(osmWindow.HALIFAX_OSM_RESTAURANTS) ? osmWindow.HALIFAX_OSM_RESTAURANTS : [])
];
const restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(String(value).replaceAll("&amp;", "&"), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function sameSite(a, b) {
  return hostKey(a) && hostKey(a) === hostKey(b);
}

function decodeText(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value) {
  return decodeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetFingerprint(restaurant) {
  const address = String(restaurant?.address ?? "").split(",")[0].trim();
  const match = address.match(/\b(\d+[a-z]?)\s+(.+)/i);
  if (!match) return null;
  const number = match[1].toLowerCase();
  const streetWords = normalizedText(match[2])
    .split(" ")
    .filter((word) => !["street", "st", "avenue", "ave", "road", "rd", "drive", "dr", "boulevard", "blvd", "lane", "ln"].includes(word))
    .slice(0, 3);
  return streetWords.length ? `${number} ${streetWords.join(" ")}` : null;
}

function requiresLocationMatch(url) {
  try {
    return /\/(?:restaurants?|locations?)\/[^/]+/.test(new URL(url).pathname.toLowerCase());
  } catch {
    return false;
  }
}

function pageMatchesRestaurantLocation(url, html, restaurant) {
  if (!requiresLocationMatch(url)) return { ok: true, checked: false };
  const fingerprint = streetFingerprint(restaurant);
  if (!fingerprint) return { ok: false, checked: false };
  return { ok: normalizedText(html).includes(fingerprint), checked: true };
}

function explicitCandidates(signal, kind) {
  const website = safeUrl(signal.website);
  if (!website) return [];
  const candidates = [];
  for (const link of signal.candidateLinks ?? []) {
    if ((link.signalMatches?.[kind]?.length ?? 0) === 0) continue;
    const url = safeUrl(link.href, website);
    if (!url) continue;
    candidates.push({
      restaurantId: signal.restaurantId,
      restaurantName: signal.name,
      kind,
      url,
      label: decodeText(link.text || (kind === "menu" ? "Menu" : "Specials")),
      website,
      observedAt: signal.observedAt || payload.generatedAt || null
    });
  }
  return candidates;
}

const candidates = signals.flatMap((signal) => [
  ...explicitCandidates(signal, "menu"),
  ...explicitCandidates(signal, "specials")
]);
const uniqueCandidates = candidates.filter((candidate, index, all) => all.findIndex((item) => item.restaurantId === candidate.restaurantId && item.kind === candidate.kind && item.url === candidate.url) === index);

const menuSources = [];
const specialSources = [];
const failures = [];
const candidateSources = [];
let scannedPages = 0;

function recordSource(candidate, details) {
  const record = {
    restaurantId: candidate.restaurantId,
    kind: candidate.kind,
    url: details.url || candidate.url,
    label: candidate.label.slice(0, 120) || (candidate.kind === "menu" ? "Menu" : "Specials"),
    sourceWebsite: candidate.website,
    sourceKind: details.sourceKind,
    verificationMethod: details.verificationMethod,
    observedAt: candidate.observedAt,
    verifiedAt: new Date().toISOString(),
    contentType: details.contentType || null,
    locationValidated: details.locationValidated ?? null,
    reviewState: "verified"
  };
  const disposition = sourcePageDisposition(candidate, details);
  if (disposition.state !== "verified") {
    candidateSources.push({ ...record, verifiedAt: null, checkedAt: record.verifiedAt, reviewState: disposition.state, reason: disposition.reason });
    return;
  }
  (candidate.kind === "menu" ? menuSources : specialSources).push(record);
}

for (const candidate of uniqueCandidates.slice(0, pageLimit)) {
  const restaurant = restaurantById.get(candidate.restaurantId);
  if (!restaurant) {
    failures.push({ ...candidate, reason: "unknown_restaurant_id" });
    continue;
  }

  if (!integrity.safeSource(candidate.url) || !integrity.locationSafe({ ...candidate, sourceUrl: candidate.url })) {
    failures.push({ ...candidate, reason: "quarantined_identity_or_location" }); continue;
  }
  if (!sameSite(candidate.url, candidate.website)) {
    recordSource(candidate, {
      sourceKind: "official_outbound_link",
      verificationMethod: "linked_from_official_site",
      contentType: null,
      locationValidated: null
    });
    continue;
  }

  if (!(await robotsAllows(candidate.url))) {
    failures.push({ ...candidate, reason: "robots_disallow" });
    continue;
  }

  await sleep(delayMs);
  try {
    const response = await fetchPublicSource(candidate.url, {
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.2" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    }, robotsAllows);
    if (!response.ok) {
      failures.push({ ...candidate, reason: `http_${response.status}` });
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    const resolvedUrl = response.url || candidate.url;
    if (/pdf/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(resolvedUrl)) {
      scannedPages += 1;
      recordSource(candidate, { sourceKind: "official_page", verificationMethod: "reachable_official_pdf", url: resolvedUrl, contentType, locationValidated: null });
      continue;
    }
    if (!/html|xhtml/i.test(contentType)) {
      failures.push({ ...candidate, reason: "unsupported_content_type", contentType });
      continue;
    }
    const html = await response.text();
    scannedPages += 1;
    const location = pageMatchesRestaurantLocation(resolvedUrl, html, restaurant);
    if (!location.ok) {
      failures.push({ ...candidate, url: resolvedUrl, reason: location.checked ? "location_mismatch" : "location_unverifiable" });
      continue;
    }
    recordSource(candidate, { sourceKind: "official_page", verificationMethod: "reachable_official_page", url: resolvedUrl, contentType, locationValidated: location.checked });
  } catch (error) {
    failures.push({ ...candidate, reason: error.message });
  }
}

function dedupe(records) {
  return records
    .filter((record, index, all) => all.findIndex((item) => item.restaurantId === record.restaurantId && item.kind === record.kind && item.url === record.url) === index)
    .sort((a, b) => a.restaurantId.localeCompare(b.restaurantId) || a.url.localeCompare(b.url));
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  scannedPages,
  failedPages: failures.length,
  candidateCount: uniqueCandidates.length,
  failures: failures.slice(0, 150),
  candidateSources: dedupe(candidateSources),
  retentionPolicy: "Prior accepted relationships retain original evidence clocks; failed or inconclusive refreshes are not removals. Explicit reviewed replacement or withdrawal is separate.",
  menuSources: preserveAcceptedSources(previous.menuSources || [], dedupe(menuSources)),
  specialSources: preserveAcceptedSources(previous.specialSources || [], dedupe(specialSources))
};

await writeFile(outputJson, JSON.stringify(output, null, 2));
await writeFile(outputJs, `window.HALIFAX_VERIFIED_SOURCE_PAGES = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Verified official source pages: candidates=${uniqueCandidates.length}, scanned=${scannedPages}, failures=${failures.length}, menus=${output.menuSources.length}, specials=${output.specialSources.length}.`);
