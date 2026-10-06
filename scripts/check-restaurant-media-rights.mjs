import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import {mediaPermitted,referenceProblems} from "./lib/media-rights-contract.mjs";

async function windowData(path) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), context, { filename: path, timeout: 20_000 });
  return context.window;
}
function isHttp(value) { try { return ["http:", "https:"].includes(new URL(String(value || "")).protocol); } catch { return false; } }

const mediaWindow = await windowData("data/restaurant-media.js");
const media = mediaWindow.HALIFAX_RESTAURANT_MEDIA?.records || [];
const refs = (await windowData("data/restaurant-media-references.js")).HALIFAX_MEDIA_SOURCE_REFERENCES?.records || [];
const priority = JSON.parse(await readFile(new URL("../data/restaurant-media-priority.json", import.meta.url), "utf8"));
const failures = [];
const allowedSourceTypes = new Set(["owner", "owner_submission", "restaurant_owner", "restaurant_owner_submission", "first_party", "official_site_permitted", "licensed"]);
const allowedPermissions = new Set(["licensed", "owner_submitted", "permitted", "owner_approved", "written_permission"]);
if (!Array.isArray(priority.records) || priority.records.length !== priority.targetCount || priority.targetCount < 25) failures.push("priority queue target must match at least 25 reviewed records");
if (new Set((priority.records || []).map((record) => record.restaurantId)).size !== priority.records?.length) failures.push("priority queue contains duplicate restaurant IDs");

for (const record of media) {
  if (/First-party official site media/i.test(record.license || "") || /remote thumbnail reference only|not rehosted/i.test(record.rightsBasis || "")) failures.push(`${record.restaurantId}: public reference is not authorization`);
  if (!mediaPermitted(record)) failures.push(`${record.restaurantId}: shared consumer rights contract failed`);
  if (record.reviewState !== "approved" || record.permissionConfirmed !== true || !allowedPermissions.has(record.permission) || !allowedSourceTypes.has(record.sourceType)) failures.push(`${record.restaurantId}: approval contract failed`);
  if (!record.creator || !record.license || !record.attribution || !record.rightsBasis || !isHttp(record.sourceUrl)) failures.push(`${record.restaurantId}: creator, licence, attribution, rights basis and source URL are required`);
  if (!record.alt || record.alt.length < 20) failures.push(`${record.restaurantId}: descriptive alt text is required`);
  const isReviewedAsset = /^assets\/restaurants\/[a-z0-9-]+\.jpg$/.test(record.url);
  const isApprovedRemote = allowedSourceTypes.has(record.sourceType) && isHttp(record.url) && String(record.url).startsWith("https://");
  if (!isReviewedAsset && !isApprovedRemote) failures.push(record.restaurantId + ": media must use a reviewed repository asset or approved HTTPS official-site image");
  if (isReviewedAsset) {
    try { await access(new URL("../" + record.url, import.meta.url)); } catch { failures.push(record.restaurantId + ": local media asset is missing"); }
  }
}
for (const record of refs) {
  for (const problem of referenceProblems(record)) failures.push(`${record.restaurantId}: ${problem}`);
  const queue = priority.records.find(item => item.restaurantId === record.restaurantId);
  if (queue?.status !== "rights_review_required" || queue?.rightsState !== "unverified" || queue?.permissionConfirmed === true || queue?.renderable === true || queue?.license != null) failures.push(`${record.restaurantId}: reference queue claims inconsistent rights`);
}
const approvedIds = new Set(media.filter(record => record.reviewState === "approved").map((record) => record.restaurantId));
const priorityIds = new Set((priority.records || []).map((record) => record.restaurantId));
for (const record of media) {
  if (!priorityIds.has(record.restaurantId)) failures.push(`${record.restaurantId}: manifest media is missing from priority queue`);
}
for (const record of priority.records || []) {
  if (record.status === "approved" && !approvedIds.has(record.restaurantId)) failures.push(`${record.restaurantId}: queue says approved but manifest has no media`);
  if (record.status !== "approved" && approvedIds.has(record.restaurantId)) failures.push(`${record.restaurantId}: manifest media is not marked approved in queue`);
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  targetCount: priority.targetCount,
  approvedCount: approvedIds.size,
  retainedSourceReferenceCount: refs.length,
  pendingCount: (priority.records || []).filter((record) => record.status !== "approved").length,
  policy: priority.policy,
  approvedRestaurantIds: [...approvedIds],
  failures
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/restaurant-media-rights-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
if (failures.length) { console.error(JSON.stringify(report, null, 2)); process.exit(1); }
console.log(JSON.stringify({ target: report.targetCount, approved: report.approvedCount, pending: report.pendingCount }, null, 2));
