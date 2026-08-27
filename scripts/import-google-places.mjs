import { mkdir, readFile, writeFile } from "node:fs/promises";

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_PLACES_API_KEY is required. This job stores place IDs only; display content must be fetched/rendered under Google Places API terms with attribution and cache controls.");
  process.exit(2);
}

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const limit = Number(process.env.GOOGLE_PLACES_LIMIT ?? 25);
const targets = catalog.restaurants.slice(0, limit);
const links = [];

for (const restaurant of targets) {
  const textQuery = `${restaurant.name} ${restaurant.address ?? restaurant.neighborhood ?? "Halifax Nova Scotia"}`;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id"
    },
    body: JSON.stringify({ textQuery, includedType: "restaurant", maxResultCount: 1 })
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status} for ${restaurant.name}`);
  const payload = await response.json();
  const placeId = payload.places?.[0]?.id ?? null;
  links.push({ restaurantId: restaurant.id, query: textQuery, placeId, observedAt: new Date().toISOString() });
}

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/google-place-links.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), count: links.length, links }, null, 2));
console.log(`Linked ${links.filter((item) => item.placeId).length}/${links.length} restaurants to Google place IDs.`);
