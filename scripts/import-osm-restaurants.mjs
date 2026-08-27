const scope = {
  name: "Halifax peninsula, Dartmouth, Armdale, Fairview, and immediately surrounding areas",
  bbox: { south: 44.575, west: -63.69, north: 44.705, east: -63.505 }
};

const amenityTypes = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  bar: "Bar",
  pub: "Pub",
  fast_food: "Quick eats",
  food_court: "Food court",
  ice_cream: "Dessert"
};

const vibeByAmenity = {
  restaurant: ["dining"],
  cafe: ["coffee", "daytime"],
  bar: ["drinks", "late"],
  pub: ["pub", "casual"],
  fast_food: ["quick", "casual"],
  food_court: ["quick", "groups"],
  ice_cream: ["dessert", "casual"]
};

const query = `
[out:json][timeout:45];
(
  nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court|ice_cream)$"](${scope.bbox.south},${scope.bbox.west},${scope.bbox.north},${scope.bbox.east});
);
out center tags;
`;

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function titleCaseList(value) {
  return value
    .split(/[;,]+/)
    .map((part) => part.trim().replace(/_/g, " "))
    .filter(Boolean)
    .map((part) => part.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "));
}

function formatAddress(tags) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [street, tags["addr:city"], tags["addr:province"] ?? tags["addr:state"]].filter(Boolean).join(", ");
}

function neighborhoodFor(lat, lon, tags) {
  const suburb = tags["addr:suburb"] ?? tags["is_in:neighbourhood"];
  const city = tags["addr:city"];
  if (suburb) return suburb;
  if (/dartmouth/i.test(city ?? "")) return "Dartmouth";
  if (/bedford/i.test(city ?? "")) return "Bedford";
  if (/halifax/i.test(city ?? "") && lon < -63.64) return "Armdale / Fairview";
  if (lon > -63.57) return "Dartmouth";
  if (lat < 44.622) return "South End";
  if (lon < -63.64) return "Armdale / Fairview";
  if (lat > 44.665) return "North End";
  if (lat > 44.648 && lon < -63.595) return "West End";
  if (lon > -63.595 && lat < 44.655) return "Downtown";
  return "Halifax Peninsula";
}

function qualityFromTags(tags) {
  let score = 62;
  if (tags.website || tags["contact:website"]) score += 7;
  if (tags.phone || tags["contact:phone"]) score += 4;
  if (tags.cuisine) score += 5;
  if (tags.opening_hours) score += 4;
  if (tags["addr:street"]) score += 3;
  return Math.min(score, 82);
}

function transformElement(element) {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!name || !lat || !lon) return null;

  const amenity = tags.amenity ?? "restaurant";
  const category = amenityTypes[amenity] ?? "Food and drink";
  const cuisines = tags.cuisine ? titleCaseList(tags.cuisine) : [category];
  const address = formatAddress(tags);
  const website = tags.website ?? tags["contact:website"] ?? null;
  const phone = tags.phone ?? tags["contact:phone"] ?? null;

  return {
    id: `osm-${element.type}-${element.id}-${slugify(name)}`,
    name,
    neighborhood: neighborhoodFor(lat, lon, tags),
    category,
    cuisines,
    vibe: vibeByAmenity[amenity] ?? ["food and drink"],
    qualityScore: qualityFromTags(tags),
    freshnessDate: new Date().toISOString().slice(0, 10),
    evidenceStatus: "needs-review",
    summary: `${category} captured from OpenStreetMap${address ? ` at ${address}` : ""}. Needs restaurant-owned confirmation for specials, events, and quality notes.`,
    address: address || null,
    phone,
    website,
    openingHours: tags.opening_hours ?? null,
    coordinates: { lat, lon },
    specials: [],
    events: [],
    sources: [
      {
        label: "OpenStreetMap object",
        type: "openstreetmap",
        url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        status: "verified"
      }
    ],
    osm: { type: element.type, id: element.id, amenity, rawTags: tags }
  };
}

async function fetchOverpass() {
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "HalifaxSourced/0.1 (https://github.com/JeremyHennessy/HalifaxSourced)"
        },
        body: new URLSearchParams({ data: query })
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status} ${response.statusText}`);
      return { endpoint, payload: await response.json() };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const { mkdir, writeFile } = await import("node:fs/promises");
const { endpoint, payload } = await fetchOverpass();
const restaurants = payload.elements.map(transformElement).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
const generatedAt = new Date().toISOString();
const output = `window.HALIFAX_OSM_META = ${JSON.stringify({ generatedAt, source: `OpenStreetMap via Overpass API (${endpoint})`, scope: scope.name, bbox: scope.bbox, count: restaurants.length }, null, 2)};\n\nwindow.HALIFAX_OSM_RESTAURANTS = ${JSON.stringify(restaurants, null, 2)};\n`;
await mkdir(new URL("../data", import.meta.url), { recursive: true });
await writeFile(new URL("../data/osm-restaurants.js", import.meta.url), output);
console.log(`Imported ${restaurants.length} food and drink places from OpenStreetMap.`);
console.log(`Scope: ${scope.name}`);
