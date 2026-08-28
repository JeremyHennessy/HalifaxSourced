import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve("data", "build", "owner-submissions.normalized.json");
const outputPath = resolve("data", "restaurant-media.js");
const allowedSourceTypes = new Set(["owner", "owner_submission", "restaurant_owner", "first_party", "official_site_permitted", "licensed"]);
const allowedPermissions = new Set(["permitted", "owner_approved", "written_permission", "licensed"]);

function token(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function httpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
const records = [];
const failures = [];

for (const submission of submissions) {
  for (const image of submission.images ?? []) {
    if (token(image.reviewState) !== "approved") continue;
    const sourceType = token(image.sourceType);
    const permission = token(image.permission);
    const problems = [];
    if (!submission.restaurantId) problems.push("restaurant_id is required");
    if (!httpUrl(image.url) && !/^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(String(image.url ?? ""))) problems.push("image_url must be http(s) or a repository asset path");
    if (!httpUrl(image.sourceUrl)) problems.push("image_source_url must be an http(s) provenance URL");
    if (!allowedSourceTypes.has(sourceType)) problems.push(`unsupported image_source_type: ${sourceType || "missing"}`);
    if (!allowedPermissions.has(permission) || image.permissionConfirmed !== true) problems.push("explicit permission confirmation is required");
    if (!String(image.rightsBasis ?? "").trim()) problems.push("image_rights_basis is required");
    if (problems.length) {
      failures.push({ restaurantId: submission.restaurantId, name: submission.name, imageUrl: image.url, problems });
      continue;
    }
    records.push({
      restaurantId: submission.restaurantId,
      url: image.url,
      alt: image.alt || submission.name || "Restaurant image",
      sourceUrl: image.sourceUrl,
      sourceType,
      rightsBasis: image.rightsBasis,
      permission,
      permissionConfirmed: true,
      attribution: image.attribution || null,
      reviewState: "approved"
    });
  }
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}

const unique = records.filter((record, index, all) => all.findIndex((candidate) => candidate.restaurantId === record.restaurantId && candidate.url === record.url) === index);
const output = `window.HALIFAX_RESTAURANT_MEDIA = ${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), records: unique }, null, 2)};\n`;
await writeFile(outputPath, output);
console.log(`Published ${unique.length} approved restaurant media records to data/restaurant-media.js.`);
