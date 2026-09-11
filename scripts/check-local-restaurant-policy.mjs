import { readFile } from "node:fs/promises";
import { isLocalRestaurantRecord, localRestaurantPolicyDecision } from "./lib/local-restaurant-policy.mjs";

const errors = [];
const excludedFixtures = [
  "McDonald's",
  "McDonald\u2019s",
  "Wendy's",
  "Wendy\u2019s",
  "Tim Hortons",
  "Subway",
  "Burger King",
  "KFC",
  "Starbucks",
  "Pizza Hut"
];
const localFixtures = [
  "The Canteen",
  "EDNA Restaurant",
  "Bar Kismet",
  "Cafe Good Luck",
  "The Bicycle Thief"
];

for (const name of excludedFixtures) {
  if (isLocalRestaurantRecord({ name })) errors.push(`Fixture should be excluded by local restaurant policy: ${name}`);
}

for (const name of localFixtures) {
  const decision = localRestaurantPolicyDecision({ name });
  if (decision.excluded) errors.push(`Fixture should remain eligible as local/independent: ${name} matched ${decision.matchedToken}`);
}

let catalog = null;
try {
  catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
} catch {}

if (catalog?.restaurants) {
  for (const restaurant of catalog.restaurants) {
    const decision = localRestaurantPolicyDecision(restaurant);
    if (decision.excluded) {
      errors.push(`Catalog includes non-local chain record ${restaurant.id || "unknown-id"} (${restaurant.name || "unknown name"}) via ${decision.field}: ${decision.matchedValue}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const catalogCount = catalog?.restaurants?.length ?? 0;
const excludedCount = catalog?.counts?.localPolicyExcluded?.total ?? null;
console.log(`Local restaurant policy passed${catalog ? ` for ${catalogCount} catalog records` : " fixture checks"}.`);
if (excludedCount !== null) console.log(`Local restaurant policy excluded ${excludedCount} non-local chain/franchise records during catalog export.`);
