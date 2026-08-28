import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const directoryPayload = JSON.parse(await readFile(new URL("../data/build/directory-restaurant-leads.json", import.meta.url), "utf8"));
const canonical = Array.isArray(catalog.restaurants) ? catalog.restaurants : [];
const candidates = Array.isArray(directoryPayload.records) ? directoryPayload.records : [];

function normalizeName(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|restaurant|resto|cafe|café|bar|pub|eatery|kitchen)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function normalizeAddress(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|place|pl\.?|boulevard|blvd\.?|highway|hwy\.?)\b/g, " ")
    .replace(/\b(nova scotia|ns|canada)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function domain(value) {
  try {
    return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

function postal(value) {
  return String(value ?? "").toUpperCase().match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/)?.[0].replace(/\s/g, "") || "";
}

function streetNumber(value) {
  return String(value ?? "").match(/\b\d{1,5}[A-Z]?\b/i)?.[0]?.toUpperCase() || "";
}

function tokenSimilarity(a, b) {
  const left = new Set(normalizeAddress(a).split(" ").filter((item) => item.length > 1));
  const right = new Set(normalizeAddress(b).split(" ").filter((item) => item.length > 1));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / Math.max(left.size, right.size);
}

function coords(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function distanceMeters(a, b) {
  const left = coords(a);
  const right = coords(b);
  if (!left || !right) return null;
  const rad = Math.PI / 180;
  const dLat = (right.lat - left.lat) * rad;
  const dLon = (right.lon - left.lon) * rad;
  const lat1 = left.lat * rad;
  const lat2 = right.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function scorePair(candidate, place) {
  const evidence = [];
  let score = 0;
  const cName = normalizeName(candidate.name);
  const pName = normalizeName(place.name);
  if (cName && cName === pName) { score += 35; evidence.push("exact_normalized_name"); }
  else if (cName.length >= 8 && pName.length >= 8 && (cName.includes(pName) || pName.includes(cName))) { score += 15; evidence.push("compatible_name"); }

  const cPhone = normalizePhone(candidate.phone);
  const pPhone = normalizePhone(place.phone);
  if (cPhone && pPhone && cPhone === pPhone) { score += 45; evidence.push("exact_phone"); }

  const cDomain = domain(candidate.website);
  const pDomain = domain(place.website);
  if (cDomain && pDomain && cDomain === pDomain) { score += 50; evidence.push("exact_official_domain"); }

  const cPostal = postal(candidate.address);
  const pPostal = postal(place.address);
  if (cPostal && pPostal && cPostal === pPostal) { score += 30; evidence.push("exact_postal_code"); }

  const cNumber = streetNumber(candidate.address);
  const pNumber = streetNumber(place.address);
  const similarity = tokenSimilarity(candidate.address, place.address);
  if (cNumber && pNumber && cNumber === pNumber && similarity >= 0.55) { score += 35; evidence.push("compatible_street_address"); }
  else if (similarity >= 0.75) { score += 20; evidence.push("high_address_similarity"); }

  const distance = distanceMeters(candidate.coordinates, place.coordinates);
  if (distance !== null) {
    if (distance <= 60) { score += 40; evidence.push("coordinates_within_60m"); }
    else if (distance <= 200) { score += 25; evidence.push("coordinates_within_200m"); }
    else if (distance <= 500) { score += 10; evidence.push("coordinates_within_500m"); }
  }

  const addressConflict = Boolean(cNumber && pNumber && cNumber !== pNumber && similarity < 0.4);
  const domainConflict = Boolean(cDomain && pDomain && cDomain !== pDomain);
  const phoneConflict = Boolean(cPhone && pPhone && cPhone !== pPhone);
  const conflictCount = [addressConflict, domainConflict, phoneConflict].filter(Boolean).length;
  if (conflictCount) score -= conflictCount * 20;

  return { score, evidence, conflicts: [addressConflict ? "street_number_conflict" : null, domainConflict ? "domain_conflict" : null, phoneConflict ? "phone_conflict" : null].filter(Boolean), distanceMeters: distance === null ? null : Math.round(distance), addressSimilarity: Number(similarity.toFixed(3)) };
}

function classify(best, second) {
  if (!best) return "unresolved";
  const hasCompatibleName = best.evidence.some((item) => ["exact_normalized_name", "compatible_name"].includes(item));
  const strongEvidence = best.evidence.filter((item) => !["exact_normalized_name", "compatible_name"].includes(item)).length;
  const margin = second ? best.score - second.score : best.score;
  if (best.conflicts.length) return best.score >= 80 && margin >= 20 ? "review_conflict" : "unresolved_conflict";
  if (!hasCompatibleName && strongEvidence) return "non_name_evidence_review";
  if (best.score >= 75 && strongEvidence >= 1 && margin >= 20) return "resolved_high";
  if (best.score >= 60 && best.evidence.length >= 2 && margin >= 15) return "resolved_probable";
  if (best.score >= 35 && best.evidence.includes("exact_normalized_name")) return "name_only_review";
  return "unresolved";
}

const resolutions = [];
for (const candidate of candidates) {
  const scored = canonical.map((place) => ({ place, ...scorePair(candidate, place) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.place.id).localeCompare(String(b.place.id)));
  const best = scored[0] || null;
  const second = scored[1] || null;
  const state = classify(best, second);
  resolutions.push({
    candidateId: candidate.id,
    candidateName: candidate.name,
    sourceId: candidate.sourceId || null,
    sourceUrl: candidate.sourceUrl,
    candidateAddress: candidate.address || null,
    candidateWebsite: candidate.website || null,
    state,
    matchedRestaurantId: state.startsWith("resolved_") || state === "review_conflict" ? best?.place?.id || null : null,
    matchedRestaurantName: state.startsWith("resolved_") || state === "review_conflict" ? best?.place?.name || null : null,
    score: best?.score || 0,
    evidence: best?.evidence || [],
    conflicts: best?.conflicts || [],
    distanceMeters: best?.distanceMeters ?? null,
    addressSimilarity: best?.addressSimilarity ?? 0,
    scoreMargin: best ? best.score - (second?.score || 0) : 0,
    nextBestRestaurantId: second?.place?.id || null,
    reviewState: state.startsWith("resolved_") ? "resolved-by-evidence" : "needs-review"
  });
}

const counts = resolutions.reduce((acc, item) => {
  acc[item.state] = (acc[item.state] || 0) + 1;
  return acc;
}, {});
const resolved = resolutions.filter((item) => item.state.startsWith("resolved_"));
const reviewQueue = resolutions.filter((item) => !item.state.startsWith("resolved_") || item.conflicts.length);
const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  directoryGeneratedAt: directoryPayload.generatedAt || null,
  candidateCount: resolutions.length,
  resolvedCount: resolved.length,
  counts,
  resolutionPolicy: {
    high: "compatible name, score >=75, at least one non-name identity signal, margin >=20, no conflicts",
    probable: "compatible name, score >=60, at least two evidence signals, margin >=15, no conflicts",
    nameOnly: "exact normalized name without sufficient location/identity evidence remains review-only",
    nonNameEvidence: "address, coordinates, phone or domain evidence without a compatible name remains review-only",
    conflicts: "address/domain/phone conflicts prevent automatic resolution"
  },
  resolutions,
  reviewQueue
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/place-source-resolutions.json", import.meta.url), JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ candidateCount: payload.candidateCount, resolvedCount: payload.resolvedCount, counts }, null, 2));
