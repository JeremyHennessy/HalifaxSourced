import { readFile, writeFile } from "node:fs/promises";
import { cleanLibraryText, dedupeLibraryEvents, parseRegionalLibraryPage } from "./regional-library-lib.mjs";

const payloadUrl = new URL("../data/build/city-events.json", import.meta.url);
const jsUrl = new URL("../data/city-events.js", import.meta.url);
const registry = JSON.parse(await readFile(new URL("../data/event-source-supplements.json", import.meta.url), "utf8"));
const payload = JSON.parse(await readFile(payloadUrl, "utf8"));
const source = (registry.sources || []).find((item) => item.id === "halifax-public-libraries");
if (!source) throw new Error("halifax_public_libraries_source_missing");

const filters = Array.isArray(source.regionalLocationFilters) ? source.regionalLocationFilters : [];
const pageLimit = Math.max(1, Math.min(20, Number(process.env.LIBRARY_REGIONAL_PAGE_LIMIT ?? 12)));
const delayMs = Math.max(0, Number(process.env.LIBRARY_REGIONAL_DELAY_MS ?? 100));
const timeoutMs = Number(process.env.SUPPLEMENTAL_EVENT_TIMEOUT_MS ?? 15000);
const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const rangeStart = Date.parse(payload.range?.start || new Date().toISOString());
const rangeEnd = Date.parse(payload.range?.end || new Date(Date.now() + 400 * 86400000).toISOString());

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!/html|xhtml/i.test(type)) throw new Error("not_html");
  return { text: await response.text(), resolvedUrl: response.url || url };
}

const regional = [];
const locationStats = [];
const failures = [];
for (const filter of filters) {
  let expectedPages = pageLimit;
  let collected = 0;
  const started = Date.now();
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pageLimit, expectedPages); pageNumber += 1) {
      const url = `${source.url}?locations=${encodeURIComponent(filter.code)}&page=${pageNumber}`;
      const page = await fetchHtml(url);
      const plain = cleanLibraryText(page.text);
      const totalMatch = plain.match(/\b\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+items\b/i);
      if (totalMatch) expectedPages = Math.min(pageLimit, Math.ceil(Number(totalMatch[1].replace(/,/g, "")) / 20));
      const events = parseRegionalLibraryPage({ html: page.text, resolvedUrl: page.resolvedUrl, filter, source, rangeStart, rangeEnd });
      regional.push(...events);
      collected += events.length;
      if (delayMs) await sleep(delayMs);
    }
    locationStats.push({ code: filter.code, name: filter.name, city: filter.city, status: "ok", eventCount: collected, durationMs: Date.now() - started });
    console.log(`${filter.name}: ${collected} regional library events.`);
  } catch (error) {
    failures.push({ code: filter.code, name: filter.name, city: filter.city, reason: error.message });
    locationStats.push({ code: filter.code, name: filter.name, city: filter.city, status: "failed", eventCount: collected, reason: error.message, durationMs: Date.now() - started });
  }
}

const events = dedupeLibraryEvents([...(payload.events || []), ...regional]);
const categoryCounts = {};
for (const event of events) for (const category of event.categories || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
const output = {
  ...payload,
  eventCount: events.length,
  categoryCounts,
  sourceStats: [...(payload.sourceStats || []), { sourceId: source.id, sourceName: source.name, mode: "bibliocommons_regional_filters", status: failures.length ? "partial" : "ok", eventCount: regional.length, observedAt: new Date().toISOString(), regionalLocationCounts: Object.fromEntries(locationStats.map((item) => [item.name, item.eventCount])) }],
  failures: [...(payload.failures || []), ...failures.map((item) => ({ sourceId: source.id, sourceName: source.name, url: source.url, reason: `regional_${item.code}_${item.reason}`, observedAt: new Date().toISOString() }))],
  regionalLibraryAudit: { generatedAt: new Date().toISOString(), locationStats, collectedBeforeDedupe: regional.length, failures },
  events
};
await writeFile(payloadUrl, JSON.stringify(output, null, 2) + "\n");
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Regional library events: collected=${regional.length}, merged-total=${events.length}, failures=${failures.length}.`);
