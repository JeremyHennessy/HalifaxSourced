import { readFile, writeFile } from "node:fs/promises";

const overrides = JSON.parse(await readFile(new URL("../data/discovery-overrides.json", import.meta.url), "utf8"));
const approved = Array.isArray(overrides?.approved) ? overrides.approved : [];
const openingPayload = JSON.parse(await readFile(new URL("../data/build/opening-watch-leads.json", import.meta.url), "utf8").catch(() => '{"leads":[]}'));
const openingLeads = Array.isArray(openingPayload?.leads) ? openingPayload.leads : [];

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function legacySourceFor(item) {
  if (!item.sourceUrl) return null;
  return {
    label: item.sourceName || "Local discovery source",
    type: item.sourceType || "local_discovery",
    url: item.sourceUrl,
    status: item.status || "needs-review"
  };
}

function sourcesFor(item) {
  const sources = Array.isArray(item.sources) ? item.sources.filter((source) => source?.url) : [];
  const legacy = legacySourceFor(item);
  if (legacy && !sources.some((source) => source.url === legacy.url && source.type === legacy.type)) sources.push(legacy);
  return sources;
}

const restaurants = approved.map((item) => {
  const sourceUrls = new Set(sourcesFor(item).map((source) => source.url));
  const sourceMatch = openingLeads.find((lead) =>
    normalize(lead.name) === normalize(item.name) &&
    (!sourceUrls.size || sourceUrls.has(lead.sourceUrl))
  );

  return {
    id: item.id,
    name: item.name,
    neighborhood: item.neighborhood || "Halifax",
    category: item.category || "Restaurant",
    cuisines: item.cuisines || [],
    vibe: item.vibe || ["new opening"],
    qualityScore: Number.isFinite(item.qualityScore) ? item.qualityScore : 60,
    freshnessDate: item.freshnessDate || sourceMatch?.publishedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    evidenceStatus: item.evidenceStatus || "needs-review",
    sourceLayer: "local_discovery",
    address: item.address || sourceMatch?.locationHint || null,
    phone: item.phone || null,
    website: item.website || null,
    openingHours: item.openingHours || null,
    openingStatus: item.openingStatus || sourceMatch?.status || null,
    coordinates: item.coordinates || null,
    socialProfiles: Array.isArray(item.socialProfiles) ? item.socialProfiles : [],
    summary: item.summary || `New local restaurant discovery lead from ${item.sourceName || sourceMatch?.sourceName || "a local source"}.`,
    specials: Array.isArray(item.specials) ? item.specials : [],
    events: Array.isArray(item.events) ? item.events : [],
    sources: sourcesFor(item),
    discoveryReview: {
      approvedByOverride: true,
      sourceLeadObserved: Boolean(sourceMatch),
      reviewNote: item.reviewNote || null
    }
  };
});

await writeFile(new URL("../data/discovered-restaurants.js", import.meta.url), `window.HALIFAX_DISCOVERED_RESTAURANTS = ${JSON.stringify(restaurants, null, 2)};\n`);
await writeFile(new URL("../data/build/discovered-restaurants.json", import.meta.url), JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), count: restaurants.length, restaurants }, null, 2));
console.log(`Built ${restaurants.length} approved discovered restaurant records.`);
for (const restaurant of restaurants) console.log(`- ${restaurant.name}: sources=${restaurant.sources.length}, source-lead-observed=${restaurant.discoveryReview.sourceLeadObserved}`);
