import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const context = createContext({ window: {} });
for (const file of ["../data/restaurants.js", "../data/osm-restaurants.js", "../data/ns-food-inspections.js"]) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  new Script(source, { filename: file }).runInContext(context);
}

const groups = [
  { label: "curated", records: context.window.HALIFAX_RESTAURANTS ?? [] },
  { label: "openstreetmap", records: context.window.HALIFAX_OSM_RESTAURANTS ?? [] }
];
const errors = [];
const ids = new Set();
const requiredFields = ["id", "name", "neighborhood", "cuisines", "vibe", "qualityScore", "freshnessDate", "evidenceStatus", "sources"];
const statuses = new Set(["verified", "needs-review", "restricted"]);
const nsFoodInspections = context.window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;

for (const { label, records } of groups) {
  if (!Array.isArray(records)) {
    errors.push(`${label} records must be an array.`);
    continue;
  }

  for (const [index, restaurant] of records.entries()) {
    for (const field of requiredFields) {
      if (!(field in restaurant)) errors.push(`${label} restaurant ${index} is missing ${field}.`);
    }

    if (ids.has(restaurant.id)) errors.push(`Duplicate id across sources: ${restaurant.id}`);
    ids.add(restaurant.id);

    if (!statuses.has(restaurant.evidenceStatus)) errors.push(`${restaurant.id} has invalid evidenceStatus: ${restaurant.evidenceStatus}`);
    if (!Number.isFinite(restaurant.qualityScore) || restaurant.qualityScore < 0 || restaurant.qualityScore > 100) errors.push(`${restaurant.id} qualityScore must be 0-100.`);
    if (!Array.isArray(restaurant.sources) || restaurant.sources.length === 0) errors.push(`${restaurant.id} must have at least one source.`);

    for (const source of restaurant.sources ?? []) {
      if (!source.label || !source.type || !source.status) errors.push(`${restaurant.id} has an incomplete source record.`);
      if (source.url) {
        try {
          const url = new URL(source.url);
          if (!["http:", "https:"].includes(url.protocol)) errors.push(`${restaurant.id} has unsupported source URL protocol.`);
        } catch {
          errors.push(`${restaurant.id} has invalid source URL: ${source.url}`);
        }
      }
    }
  }
}

if (!nsFoodInspections || !Array.isArray(nsFoodInspections.records)) {
  errors.push("Nova Scotia food inspection payload must expose a records array.");
} else {
  if (nsFoodInspections.count !== nsFoodInspections.records.length) {
    errors.push("Nova Scotia food inspection count must match records length.");
  }

  for (const [index, record] of nsFoodInspections.records.entries()) {
    for (const field of ["id", "name", "address", "city", "detailUrl", "source", "currentAsOf"]) {
      if (!record[field]) errors.push(`Nova Scotia food inspection record ${index} is missing ${field}.`);
    }

    if (record.detailUrl) {
      try {
        const url = new URL(record.detailUrl);
        if (url.protocol !== "https:") errors.push(`${record.id} detailUrl must use https.`);
      } catch {
        errors.push(`${record.id} has invalid detailUrl: ${record.detailUrl}`);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const total = groups.reduce((count, group) => count + group.records.length, 0);
const nsCount = nsFoodInspections?.records?.length ?? 0;
console.log(`Validated ${total} directory records (${groups.map((group) => `${group.records.length} ${group.label}`).join(", ")}) and ${nsCount} Nova Scotia inspection records.`);