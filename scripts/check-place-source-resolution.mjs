import { mkdir, readFile, writeFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../data/place-source-registry.json", import.meta.url), "utf8"));
const directory = JSON.parse(await readFile(new URL("../data/build/directory-restaurant-leads.json", import.meta.url), "utf8"));
const resolutions = JSON.parse(await readFile(new URL("../data/build/place-source-resolutions.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));

const errors = [];
const warnings = [];
const registryIds = new Set();
for (const source of registry.sources || []) {
  if (!source.id || registryIds.has(source.id)) errors.push(`invalid_or_duplicate_source_id:${source.id || "missing"}`);
  registryIds.add(source.id);
  for (const field of ["name", "kind", "url", "authorityClass", "refreshFrequency", "parserMode"]) if (!source[field]) errors.push(`source_missing_${field}:${source.id}`);
  if (!Array.isArray(source.geographicScope) || !source.geographicScope.length) errors.push(`source_missing_geographic_scope:${source.id}`);
  if (!Array.isArray(source.contentTypes) || !source.contentTypes.length) errors.push(`source_missing_content_types:${source.id}`);
  try { new URL(source.url); } catch { errors.push(`source_invalid_url:${source.id}`); }
}

const candidateIds = new Set();
for (const record of directory.records || []) {
  if (!record.id || candidateIds.has(record.id)) errors.push(`invalid_or_duplicate_candidate_id:${record.id || "missing"}`);
  candidateIds.add(record.id);
  if (!record.sourceId || !registryIds.has(record.sourceId)) errors.push(`candidate_unknown_source:${record.id}:${record.sourceId || "missing"}`);
  if (!record.sourceUrl) errors.push(`candidate_missing_source_url:${record.id}`);
  if (record.website) {
    try { new URL(record.website); } catch { errors.push(`candidate_invalid_website:${record.id}`); }
  }
  for (const profile of record.socialProfiles || []) {
    if (!profile.platform || !profile.url || profile.associationBasis !== "trusted_directory_explicit_link") errors.push(`candidate_invalid_social_profile:${record.id}`);
  }
}

const canonicalIds = new Set((catalog.restaurants || []).map((item) => item.id));
const resolutionIds = new Set();
for (const item of resolutions.resolutions || []) {
  if (!candidateIds.has(item.candidateId)) errors.push(`resolution_unknown_candidate:${item.candidateId}`);
  if (resolutionIds.has(item.candidateId)) errors.push(`duplicate_resolution:${item.candidateId}`);
  resolutionIds.add(item.candidateId);
  if (item.state.startsWith("resolved_")) {
    if (!item.matchedRestaurantId || !canonicalIds.has(item.matchedRestaurantId)) errors.push(`resolved_unknown_restaurant:${item.candidateId}:${item.matchedRestaurantId || "missing"}`);
    if (!Array.isArray(item.evidence) || !item.evidence.some((evidence) => !["exact_normalized_name", "compatible_name"].includes(evidence))) errors.push(`resolved_without_non_name_evidence:${item.candidateId}`);
    if (item.conflicts?.length) errors.push(`resolved_with_conflict:${item.candidateId}`);
  }
  if (item.state === "name_only_review" && item.matchedRestaurantId) errors.push(`name_only_must_not_auto_resolve:${item.candidateId}`);
}

if (resolutionIds.size !== candidateIds.size) errors.push(`resolution_count_mismatch:candidates=${candidateIds.size}:resolutions=${resolutionIds.size}`);
if ((directory.failures || []).length) warnings.push(...directory.failures.map((failure) => `source_fetch_failure:${failure.sourceId || failure.sourceName}:${failure.reason}`));
if (!(directory.records || []).some((record) => record.sourceId === "downtown-dartmouth-food-drink")) warnings.push("downtown_dartmouth_zero_records");
if (!(directory.records || []).some((record) => record.sourceId === "spring-garden-eat-drink")) warnings.push("spring_garden_zero_records");

const report = {
  generatedAt: new Date().toISOString(),
  registeredSources: registryIds.size,
  enabledSources: (registry.sources || []).filter((source) => source.enabled).length,
  directoryCandidates: candidateIds.size,
  resolutionCounts: resolutions.counts || {},
  resolvedCount: resolutions.resolvedCount || 0,
  reviewQueueCount: resolutions.reviewQueue?.length || 0,
  errors,
  warnings
};
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/place-source-resolution-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
