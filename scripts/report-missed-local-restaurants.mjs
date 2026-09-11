import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

async function loadWindow(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/\b0\b/g, "zero")
    .replace(/\b1\b/g, "one")
    .replace(/\b2\b/g, "two")
    .replace(/\b3\b/g, "three")
    .replace(/\b4\b/g, "four")
    .replace(/\b5\b/g, "five")
    .replace(/\b6\b/g, "six")
    .replace(/\b7\b/g, "seven")
    .replace(/\b8\b/g, "eight")
    .replace(/\b9\b/g, "nine")
    .replace(/\b(the|restaurant|restaurants|resto|restobar|bar|grill|kitchen|cafe|coffee|bakery|bistro|taverna|tavern|pub|lounge|dining|food|foods|wine|enoteca|halifax|dartmouth|bedford|sackville|hfx|ns|nova scotia|downtown|waterfront|authentic|indian|thai|vietnamese|filipino|chinese|japanese|korean|asian|italian|greek|lebanese|mexican|spanish|irish|seafood|pizzeria|pizza|noodles|burger|burgers|sandwich|sandwiches|sushi|and|plus)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function nameKeys(value) {
  const raw = String(value ?? "");
  return new Set([
    normalize(raw),
    normalize(raw.replace(/\([^)]*\)/g, "")),
    normalize(raw.replace(/[-–—].*$/u, "")),
    normalize(raw.replace(/\b(?:restaurant|bar|grill|kitchen|cafe|bakery|bistro|pub|lounge)\b/gi, ""))
  ].filter((key) => key.length >= 3));
}

function sourceRank(kind) {
  return {
    downtown_halifax_directory: 35,
    business_improvement_district_directory: 32,
    business_improvement_district_feature_directory: 30,
    restaurant_association_directory: 28,
    culinary_tourism_member_directory: 26,
    nova_scotia_tourism_directory: 24,
    shopping_centre_directory: 12
  }[kind] || 0;
}

function priorityScore(record) {
  const text = `${record.name || ""} ${record.address || ""} ${record.sourceKind || ""}`;
  let score = sourceRank(record.sourceKind);
  if (/\b(restaurant|resto|bar|grill|kitchen|cafe|coffee|bakery|bistro|pub|lounge|taproom|diner|pizzeria|pizza|noodles|sushi|seafood|tacos|thai|indian|chinese|vietnamese|filipino|korean|brunch|sandwich|burger|shawarma|donut|donuts|ice cream|dessert|chocolate|brew|cider)\b/i.test(text)) score += 20;
  if (/\b(halifax|dartmouth|bedford|sackville|cole harbour|lower water|spring garden|quinpool|argyle|barrington|gottingen|agricola|portland|hollis)\b/i.test(text)) score += 10;
  if (/\b(official|tourism|directory|association)\b/i.test(text)) score += 5;
  return score;
}

const allowedDirectoryKinds = new Set([
  "nova_scotia_tourism_directory",
  "downtown_halifax_directory",
  "business_improvement_district_directory",
  "business_improvement_district_feature_directory",
  "shopping_centre_directory",
  "restaurant_association_directory",
  "culinary_tourism_member_directory"
]);

const chainPattern = /\b(mcdonald|wendy|burger king|kfc|subway|tim hortons|starbucks|pizza hut|domino|dairy queen|a&w|harveys|mary brown|pita pit|booster juice|cora\b|mr\.?\s*sub|taco bell|popeyes|five guys|moxies|the keg|chop steakhouse|cows ice cream|harvest clean eats)\b/i;
const nonRestaurantPattern = /\b(farmers'? market|museum|hotel|motel|inn|suites|accommodations|retail shop|university|archives|cultural centre|conference centre|tour|attraction|historic properties|shopping district|visitor information|airport|golf course|farm museum|hostel)\b/i;

const curatedWindow = await loadWindow("data/restaurants.js");
const osmWindow = await loadWindow("data/osm-restaurants.js");
const discoveredWindow = await loadWindow("data/discovered-restaurants.js");
const directoryWindow = await loadWindow("data/directory-restaurant-leads.js");

const activeRestaurants = [
  ...(curatedWindow.HALIFAX_RESTAURANTS || []),
  ...(osmWindow.HALIFAX_OSM_RESTAURANTS || []),
  ...(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS || [])
];
const knownKeys = new Set();
for (const restaurant of activeRestaurants) for (const key of nameKeys(restaurant.name)) knownKeys.add(key);

const directoryRecords = directoryWindow.HALIFAX_DIRECTORY_RESTAURANT_LEADS?.records || [];
const candidates = [];
const seen = new Set();
const excluded = { knownAlias: 0, sourceKind: 0, chainOrBigFastFood: 0, nonRestaurantVenue: 0, duplicateCandidate: 0 };

for (const record of directoryRecords) {
  if (!record?.name) continue;
  if (!allowedDirectoryKinds.has(record.sourceKind)) { excluded.sourceKind += 1; continue; }
  const text = `${record.name || ""} ${record.address || ""}`;
  if (chainPattern.test(text)) { excluded.chainOrBigFastFood += 1; continue; }
  if (nonRestaurantPattern.test(text)) { excluded.nonRestaurantVenue += 1; continue; }
  const keys = [...nameKeys(record.name)];
  if (keys.some((key) => knownKeys.has(key))) { excluded.knownAlias += 1; continue; }
  const candidateKey = keys[0];
  if (!candidateKey) continue;
  if (seen.has(candidateKey)) { excluded.duplicateCandidate += 1; continue; }
  seen.add(candidateKey);
  candidates.push({
    name: record.name,
    address: record.address || null,
    neighborhood: record.neighborhood || record.area || null,
    sourceKind: record.sourceKind,
    sourceName: record.sourceName || null,
    sourceUrl: record.sourceUrl,
    observedAt: record.observedAt || null,
    priorityScore: priorityScore(record),
    reviewState: "needs_source_check"
  });
}

candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name));
const report = {
  generatedAt: new Date().toISOString(),
  scope: "Trusted Halifax-area directory leads not already matched to curated, OpenStreetMap, or reviewed discovery restaurant names. Candidates are not published until source review confirms identity, locality, and current operation.",
  counts: {
    activeRestaurants: activeRestaurants.length,
    directoryRecords: directoryRecords.length,
    candidateCount: candidates.length,
    ...excluded
  },
  topCandidates: candidates.slice(0, 150)
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/missed-local-restaurant-candidates.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.counts, null, 2));
console.log(`Wrote ${report.topCandidates.length} review candidates to artifacts/missed-local-restaurant-candidates.json`);