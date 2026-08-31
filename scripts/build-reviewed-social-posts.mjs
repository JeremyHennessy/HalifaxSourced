import { mkdir, readFile, writeFile } from "node:fs/promises";

const decisionsPath = new URL("../data/reviewed-social-post-decisions.json", import.meta.url);
const recentPath = new URL("../data/build/recent-social-posts.json", import.meta.url);
const outputJsonPath = new URL("../data/build/reviewed-social-posts.json", import.meta.url);
const outputScriptPath = new URL("../data/reviewed-social-posts.js", import.meta.url);
const generatedAt = new Date().toISOString();

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function decisionValue(record) {
  if (!record) return "";
  if (typeof record === "string") return record;
  return String(record.decision || record.reviewDecision || record.state || "");
}

function validUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeDecisionRecords(payload) {
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  const map = new Map();
  for (const row of rows) {
    const id = String(row?.id || row?.postId || row?.postUrl || "").trim();
    if (!id) continue;
    map.set(id, row);
  }
  const decisions = payload?.decisions && typeof payload.decisions === "object" ? payload.decisions : {};
  for (const [id, value] of Object.entries(decisions)) {
    if (!id) continue;
    map.set(id, typeof value === "string" ? { id, decision: value } : { id, ...value });
  }
  return map;
}

function approvedDecision(row) {
  return ["approve_post", "approved", "publish", "promote"].includes(decisionValue(row));
}

const decisionPayload = await loadJson(decisionsPath, { version: 1, records: [] });
const recentPayload = await loadJson(recentPath, { records: [] });
const decisionMap = normalizeDecisionRecords(decisionPayload);
const recentRecords = Array.isArray(recentPayload.records) ? recentPayload.records : [];

const records = recentRecords
  .map((post) => {
    const id = String(post.id || post.postUrl || "");
    const decision = decisionMap.get(id) || decisionMap.get(post.postUrl || "");
    if (!approvedDecision(decision)) return null;
    const sourceUrl = validUrl(post.postUrl || post.profileUrl || post.feedUrl);
    if (!sourceUrl || !post.restaurantId) return null;
    return {
      ...post,
      sourceUrl,
      approvedAt: decision.approvedAt || decision.decidedAt || decision.reviewedAt || generatedAt,
      approvedBy: decision.approvedBy || "Halifax Sourced admin review",
      reviewState: "approved_post",
      reviewNote: decision.note || decision.reviewNote || null
    };
  })
  .filter(Boolean)
  .sort((a, b) => String(b.publishedAt || b.observedAt || "").localeCompare(String(a.publishedAt || a.observedAt || "")));

const categoryCounts = {};
const platformCounts = {};
const restaurantIds = new Set();
for (const record of records) {
  restaurantIds.add(record.restaurantId);
  categoryCounts[record.primaryCategory || "general_update"] = (categoryCounts[record.primaryCategory || "general_update"] || 0) + 1;
  platformCounts[record.platform || "unknown"] = (platformCounts[record.platform || "unknown"] || 0) + 1;
}

const output = {
  version: 1,
  generatedAt,
  decisionManifestGeneratedAt: decisionPayload.generatedAt || null,
  policy: decisionPayload.policy || "Only approved review decisions are promoted.",
  counts: {
    records: records.length,
    restaurants: restaurantIds.size,
    categoryCounts,
    platformCounts
  },
  records
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputJsonPath, JSON.stringify(output, null, 2));
await writeFile(outputScriptPath, `window.HALIFAX_REVIEWED_SOCIAL_POSTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Reviewed social posts: approved=${records.length}, restaurants=${restaurantIds.size}.`);
