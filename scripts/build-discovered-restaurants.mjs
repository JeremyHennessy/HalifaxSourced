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

function sourceFor(item) {
  return {
    label: item.sourceName || "Local discovery source",
    type: item.sourceType || "local_discovery",
    url: item.sourceUrl,
    status: item.status || "needs-review"
  };
}

const restaurants = approved.map((item) => {
  const sourceMatch = openingLeads.find((lead) =>
    normalize(lead.name) === normalize(item.name) &&
    (!item.sourceUrl || lead.sourceUrl === item.sourceUrl)
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
    coordinates: item.coordinates || null,
    summary: item.summary || `New local restaurant discovery lead from ${item.sourceName || sourceMatch?.sourceName || "a local source"}.`,
    specials: [],
    events: [],
    sources: [sourceFor(item)],
    discoveryReview: {
      approvedByOverride: true,
      sourceLeadObserved: Boolean(sourceMatch),
      reviewNote: item.reviewNote || null
    }
  };
});

await writeFile(new URL("../data/discovered-restaurants.js", import.meta.url), `window.HALIFAX_DISCOVERED_RESTAURANTS = ${JSON.stringify(restaurants, null, 2)};\n`);
await writeFile(new URL("../data/build/discovered-restaurants.json", import.meta.url), JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), count: restaurants.length, restaurants }, null, 2));
console.log(`Built ${restaurants.length} approved discovered restaurant records.`);
for (const restaurant of restaurants) console.log(`- ${restaurant.name}: source-lead-observed=${restaurant.discoveryReview.sourceLeadObserved}`);
