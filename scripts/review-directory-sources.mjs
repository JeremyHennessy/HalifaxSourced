const DEFAULT_RESTAURANTJI_CITY_PAGES = [
  { city: "Halifax", url: "https://www.restaurantji.com/ns/halifax/", minimumObserved: 80 },
  { city: "Dartmouth", url: "https://www.restaurantji.com/ns/dartmouth/", minimumObserved: 25 },
  { city: "Bedford", url: "https://www.restaurantji.com/ns/bedford/", minimumObserved: 12 },
  { city: "Lower Sackville", url: "https://www.restaurantji.com/ns/lower-sackville/", minimumObserved: 10 },
  { city: "Eastern Passage", url: "https://www.restaurantji.com/ns/eastern-passage/", minimumObserved: 8 },
  { city: "Fall River", url: "https://www.restaurantji.com/ns/fall-river/", minimumObserved: 8 },
  { city: "Timberlea", url: "https://www.restaurantji.com/ns/timberlea/", minimumObserved: 8 },
  { city: "Hammonds Plains", url: "https://www.restaurantji.com/ns/hammonds-plains/", minimumObserved: 8 },
  { city: "Upper Tantallon", url: "https://www.restaurantji.com/ns/upper-tantallon/", minimumObserved: 8 },
  { city: "Beaver Bank", url: "https://www.restaurantji.com/ns/beaver-bank/", minimumObserved: 8 }
];

const HRM_COMMUNITIES = [
  "Halifax", "Dartmouth", "Bedford", "Lower Sackville", "Sackville", "Cole Harbour",
  "Eastern Passage", "Fall River", "Timberlea", "Hammonds Plains", "Upper Tantallon",
  "Tantallon", "Beaver Bank", "Waverley", "Goffs", "Enfield", "Herring Cove", "Spryfield",
  "Bayers Lake", "Clayton Park"
];

function decode(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function defaultSlug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultNormalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function defaultSafeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function valueList(value) {
  if (Array.isArray(value)) return value.map((item) => decode(item)).filter(Boolean);
  return decode(value).split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
}

function addressText(address, fallbackCity) {
  if (!address) return null;
  if (typeof address === "string") return decode(address);
  const street = decode(address.streetAddress || address.address || "");
  const locality = decode(address.addressLocality || fallbackCity || "");
  const region = decode(address.addressRegion || "NS");
  const postal = decode(address.postalCode || "");
  const country = decode(address.addressCountry || "");
  const first = [street, locality].filter(Boolean).join(", ");
  const second = [region, postal].filter(Boolean).join(" ");
  const full = [first, second, country && !/^CA|Canada$/i.test(country) ? country : null].filter(Boolean).join(", ");
  return full || null;
}

function addressCity(address, fallbackCity) {
  if (address && typeof address === "object") return decode(address.addressLocality || fallbackCity || "") || fallbackCity || null;
  const text = decode(address || "");
  return HRM_COMMUNITIES.find((city) => new RegExp("\\b" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text)) || fallbackCity || null;
}

function ratingSummary(item) {
  const rating = item?.aggregateRating || item?.reviewRating || null;
  if (!rating || typeof rating !== "object") return null;
  const ratingValue = Number(rating.ratingValue);
  const reviewCount = Number(rating.reviewCount ?? rating.ratingCount);
  const bestRating = Number(rating.bestRating || 5);
  const summary = {
    source: "Restaurantji",
    ratingValue: Number.isFinite(ratingValue) ? ratingValue : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    bestRating: Number.isFinite(bestRating) ? bestRating : 5
  };
  return summary.ratingValue || summary.reviewCount ? summary : null;
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
    return out;
  }
  if (typeof value !== "object") return out;
  out.push(value);
  flattenJsonLd(value["@graph"], out);
  return out;
}

function jsonLdRestaurants(html) {
  const restaurants = [];
  for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const nodes = flattenJsonLd(JSON.parse(match[1]));
      for (const node of nodes) {
        const type = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (!type.map(String).some((item) => /ItemList/i.test(item))) continue;
        const elements = Array.isArray(node.itemListElement) ? node.itemListElement : [];
        for (const element of elements) {
          const item = element?.item || element;
          if (!item || typeof item !== "object") continue;
          const itemType = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
          if (!itemType.map(String).some((entry) => /Restaurant|FoodEstablishment|LocalBusiness/i.test(entry)) && !item.name) continue;
          restaurants.push({ item, position: Number(element.position ?? item.position) || null });
        }
      }
    } catch {}
  }
  return restaurants;
}

function attr(block, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block).match(new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decode(match[1]) : null;
}

function cardFacts(html, baseUrl, safeUrl = defaultSafeUrl, normalize = defaultNormalize) {
  const byUrl = new Map();
  const byName = new Map();
  for (const match of String(html).matchAll(/<div\b(?=[^>]*\brestaurant-card\b)[^>]*>/gi)) {
    const block = match[0];
    const name = attr(block, "data-name");
    const link = safeUrl(attr(block, "data-link"), baseUrl);
    const address = attr(block, "data-address");
    const image = safeUrl(attr(block, "data-image"), baseUrl);
    const lat = Number(attr(block, "data-lat"));
    const lon = Number(attr(block, "data-lng"));
    const position = Number(attr(block, "data-position"));
    const facts = {
      name,
      link,
      address,
      image,
      position: Number.isFinite(position) ? position : null,
      coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
    };
    if (link) byUrl.set(link.replace(/\/$/, ""), facts);
    if (name) byName.set(normalize(name), facts);
  }
  return { byUrl, byName };
}

function withinHrm(record) {
  const haystack = [record.address, record.city, record.name].filter(Boolean).join(" ");
  return HRM_COMMUNITIES.some((city) => new RegExp("\\b" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(haystack));
}

export function parseRestaurantjiCityPage(html, sourceMeta, page, helpers = {}) {
  const safeUrl = helpers.safeUrl || defaultSafeUrl;
  const slug = helpers.slug || defaultSlug;
  const normalize = helpers.normalize || defaultNormalize;
  const pageUrl = page.resolvedUrl || page.url || sourceMeta.url;
  const cards = cardFacts(html, pageUrl, safeUrl, normalize);
  const records = [];
  const seen = new Set();

  for (const { item, position } of jsonLdRestaurants(html)) {
    const name = decode(item.name);
    if (!name || name.length > 180) continue;
    const sourceUrl = safeUrl(item.url, pageUrl) || pageUrl;
    const card = cards.byUrl.get(sourceUrl.replace(/\/$/, "")) || cards.byName.get(normalize(name)) || {};
    const address = addressText(item.address, page.city) || card.address || null;
    const city = addressCity(item.address || address, page.city);
    const cuisines = valueList(item.servesCuisine || item.cuisine || item.category || "");
    const rating = ratingSummary(item);
    const key = normalize(name) + "|" + normalize(address || sourceUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const record = {
      id: `${sourceMeta.id}-${slug(name)}-${slug(address || sourceUrl || position || records.length)}`,
      name,
      category: cuisines[0] || "Review directory listing",
      address,
      city: city || "Halifax Regional Municipality",
      neighborhood: city && city !== page.city ? city : null,
      website: null,
      socialProfiles: [],
      linkHubs: [],
      actionLinks: [],
      phone: null,
      cuisine: cuisines,
      tags: [...new Set(["review_directory_observed", ...cuisines.map((item) => `cuisine:${item}`)])],
      coordinates: card.coordinates || null,
      thirdPartyRatings: rating ? [rating] : [],
      sourceId: sourceMeta.id,
      sourceName: sourceMeta.name,
      sourceKind: sourceMeta.kind,
      sourceUrl,
      sourcePageUrl: pageUrl,
      sourcePosition: position || card.position || null,
      observedAt: new Date().toISOString(),
      reviewState: "third-party-directory-listed",
      sourceConfidence: "review-directory-discovery"
    };
    if (withinHrm(record)) records.push(record);
  }
  return records;
}

export async function fetchRestaurantjiDirectory(sourceMeta, helpers = {}) {
  if (!helpers.get) throw new Error("missing_get_helper");
  const cityPages = Array.isArray(sourceMeta.cityPages) && sourceMeta.cityPages.length
    ? sourceMeta.cityPages
    : DEFAULT_RESTAURANTJI_CITY_PAGES;
  const records = [];
  const pages = [];
  for (let index = 0; index < cityPages.length; index += 1) {
    const page = cityPages[index];
    const { html, resolvedUrl } = await helpers.get(page.url);
    const parsed = parseRestaurantjiCityPage(html, sourceMeta, { ...page, resolvedUrl }, helpers);
    if (page.minimumObserved && parsed.length < page.minimumObserved) {
      throw new Error(`parser_yield_below_expected:${page.city}:${parsed.length}<${page.minimumObserved}`);
    }
    records.push(...parsed);
    pages.push({ city: page.city, url: page.url, observed: parsed.length });
    if (index + 1 < cityPages.length) await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return {
    records,
    pages,
    checked: pages.length,
    links: records.map((record) => ({ name: record.name, url: record.sourceUrl })),
    unknown: records.filter((record) => !helpers.knownNames?.has?.(helpers.normalize?.(record.name) ?? defaultNormalize(record.name))).length
  };
}
