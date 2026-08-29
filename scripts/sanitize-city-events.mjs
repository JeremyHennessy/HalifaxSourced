import { mkdir, readFile, writeFile } from "node:fs/promises";

const buildUrl = new URL("../data/build/city-events.json", import.meta.url);
const jsUrl = new URL("../data/city-events.js", import.meta.url);
const registryUrl = new URL("../data/event-source-registry.json", import.meta.url);
const payload = JSON.parse(await readFile(buildUrl, "utf8"));
const registry = JSON.parse(await readFile(registryUrl, "utf8"));
const sources = new Map((registry.sources || []).map((source) => [source.id, source]));
const events = Array.isArray(payload.events) ? payload.events : [];

const allowedMunicipalities = new Map([
  ["halifax", "Halifax"],
  ["dartmouth", "Dartmouth"],
  ["bedford", "Bedford"]
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function municipalityFrom(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (/\bdartmouth\b/.test(text)) return "Dartmouth";
  if (/\bbedford\b/.test(text)) return "Bedford";
  if (/\bhalifax\b/.test(text)) return "Halifax";
  return null;
}

function sourceMunicipality(source) {
  return municipalityFrom(`${source?.venueAddress || ""} ${source?.venueName || ""}`);
}

function inScopeMunicipality(event) {
  const source = sources.get(event.sourceId) || null;
  const locationText = `${event.address || ""} ${event.venueName || ""}`;
  const locationMunicipality = municipalityFrom(locationText);
  const explicitMunicipality = municipalityFrom(event.city);
  const fixedSourceMunicipality = sourceMunicipality(source);

  // Tourism Nova Scotia is province-wide. Require affirmative Halifax/Dartmouth/Bedford
  // evidence in the event location itself; never default an unknown provincial event to Halifax.
  if (event.sourceId === "tourism-ns-events") return locationMunicipality;

  // Venue/team sources registered with a Halifax-metro home venue are scoped to that venue
  // unless the event itself explicitly identifies another municipality.
  if (fixedSourceMunicipality) {
    const explicitText = clean(event.city);
    if (explicitText && !explicitMunicipality) return null;
    // A source adapter's explicit municipality is stronger than a street name.
    // For example, Bedford Public Library is on Dartmouth Road in Bedford.
    return explicitMunicipality || locationMunicipality || fixedSourceMunicipality;
  }

  // Halifax-local directories may omit a municipality on some listings. Prefer event evidence;
  // only fall back to Halifax for explicitly local Halifax event-directory sources.
  if (event.sourceId === "halifax-events-community") return locationMunicipality || explicitMunicipality || "Halifax";

  return explicitMunicipality || locationMunicipality;
}

function addCategory(categories, name, regex, text) {
  if (regex.test(text) && !categories.includes(name)) categories.push(name);
}

function classifyEvent(event) {
  const source = sources.get(event.sourceId) || null;
  const title = clean(event.title);
  const venue = clean(event.venueName);
  const sourceName = clean(event.sourceName);
  const text = `${title} ${venue}`.toLowerCase();
  const categories = [];

  if (source?.kind === "official_sports_schedule" || /mooseheads|wanderers|thunderbirds|halifax tides|\bvs\.?\b|soccer|football|hockey|lacrosse|basketball|baseball|rugby|match\b|game\b/.test(text)) {
    categories.push("Sports");
  }
  addCategory(categories, "Music", /concert|music|symphony|orchestra|recital|songwriter|singer|band\b|\bdj\b|jazz|rock\b|folk\b|opera|choir|choral|album|tribute/, text);
  addCategory(categories, "Food & Drink", /food|drink|beer|wine|cocktail|tasting|dinner|brunch|culinary|chef|brew|cider|spirits|oyster|supper|kitchen party/, text);
  addCategory(categories, "Festivals", /festival|fest\b|fringe|celebration|convention|expo|fair\b/, text);
  addCategory(categories, "Markets", /market|vendor|craft fair|night market|farmers/, text);
  addCategory(categories, "Comedy", /comedy|comedian|stand[ -]?up|improv|jimmy carr/, text);
  addCategory(categories, "Arts", /theatre|theater|dance|film|cinema|gallery|museum|performance|musical|play\b|ballet|art\b|arts|exhibit|exhibition/, text);
  addCategory(categories, "Outdoor", /outdoor|trail|garden|beach|paddle|kayak|harbour|harbor|waterfront/, text);
  addCategory(categories, "Community", /community|family|parade|heritage|culture|cultural|pride|fundraiser|conference/, text);

  if (!categories.length) {
    if (event.sourceId === "the-carleton" || /symphony nova scotia/i.test(sourceName)) categories.push("Music");
    else if (event.sourceId === "neptune-theatre" || event.sourceId === "light-house-arts-centre") categories.push("Arts");
    else {
      const trustworthyExisting = (event.categories || []).filter((category) => [
        "Sports", "Music", "Food & Drink", "Festivals", "Markets", "Arts", "Comedy", "Outdoor", "Community"
      ].includes(category));
      if (event.sourceId !== "tourism-ns-events" && trustworthyExisting.length) categories.push(...trustworthyExisting.slice(0, 3));
      else categories.push("Other");
    }
  }

  return [...new Set(categories)];
}

const kept = [];
const removed = [];
let categoryReclassified = 0;
for (const event of events) {
  const municipality = inScopeMunicipality(event);
  if (!municipality || !allowedMunicipalities.has(municipality.toLowerCase())) {
    removed.push({
      id: event.id,
      title: event.title,
      sourceId: event.sourceId,
      city: event.city || null,
      address: event.address || null,
      venueName: event.venueName || null,
      reason: "outside_halifax_metro_scope"
    });
    continue;
  }

  const categories = classifyEvent(event);
  const oldCategories = JSON.stringify(event.categories || []);
  if (JSON.stringify(categories) !== oldCategories) categoryReclassified += 1;
  kept.push({ ...event, city: municipality, categories });
}

const categoryCounts = {};
for (const event of kept) for (const category of event.categories || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;

const output = {
  ...payload,
  version: Math.max(3, Number(payload.version || 0)),
  sanitizedAt: new Date().toISOString(),
  eventCount: kept.length,
  categoryCounts,
  scopeAudit: {
    inputEvents: events.length,
    keptEvents: kept.length,
    removedOutOfScope: removed.length,
    categoryReclassified,
    allowedMunicipalities: [...allowedMunicipalities.values()],
    removedSample: removed.slice(0, 50)
  },
  events: kept
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(buildUrl, JSON.stringify(output, null, 2));
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`City event sanitation: input=${events.length}, kept=${kept.length}, removed-out-of-scope=${removed.length}, categories-reclassified=${categoryReclassified}.`);
console.log(`Categories: ${Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key}=${value}`).join(", ")}`);
