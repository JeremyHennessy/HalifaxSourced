import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const context = createContext({ window: {} });
new Script(await readFile(new URL("../data/restaurants.js", import.meta.url), "utf8"), { filename: "data/restaurants.js" }).runInContext(context);
const restaurants = context.window.HALIFAX_RESTAURANTS ?? [];
const lifecyclePhrases = /\b(last day of service|final service|permanently closed|closed (?:our|its|their) doors|temporarily closed|new location|relocat(?:e|ed|ing)|moved)\b/i;
const inactiveStatuses = new Set(["temporarily_closed", "permanently_closed", "moved"]);
const errors = [];

for (const restaurant of restaurants) {
  const evidence = restaurant.operatingStatusEvidence || {};
  const lifecycleText = [evidence.claim, ...(restaurant.sources || []).map((source) => source.label)].filter(Boolean).join(" ");
  if (lifecyclePhrases.test(lifecycleText) && !inactiveStatuses.has(restaurant.operatingStatus) && !/currently operating|closed separately/i.test(evidence.claim || "")) {
    errors.push(`${restaurant.id} has official closure/move language but remains ${restaurant.operatingStatus}.`);
  }
  if (inactiveStatuses.has(restaurant.operatingStatus) && !lifecyclePhrases.test(evidence.claim || "")) {
    errors.push(`${restaurant.id} is ${restaurant.operatingStatus} without an explicit closure/move claim.`);
  }
  if (restaurant.operatingStatus === "active" && /closed separately/i.test(evidence.claim || "") && !evidence.location) {
    errors.push(`${restaurant.id} must identify the exact active location when another location closed.`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const inactive = restaurants.filter((restaurant) => inactiveStatuses.has(restaurant.operatingStatus));
console.log(`Validated lifecycle evidence for ${restaurants.length} curated records (${inactive.length} inactive).`);
