import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const inputDir = new URL("../data/imports", import.meta.url);
const outputFile = new URL("../data/build/owner-submissions.normalized.json", import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && /\r|\n/.test(char)) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  const [headers, ...body] = rows;
  if (!headers) return [];
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])));
}

function splitList(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value ?? "").split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value) {
  return value === true || /^(?:1|true|yes|y)$/i.test(String(value ?? "").trim());
}

function normalizeToken(value, fallback = "") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeImage(raw, fallback = {}) {
  const url = String(raw.image_url ?? raw.imageUrl ?? raw.url ?? "").trim();
  if (!url) return null;
  const permissionConfirmed = parseBoolean(raw.image_permission_confirmed ?? raw.imagePermissionConfirmed ?? raw.permissionConfirmed);
  return {
    url,
    alt: raw.image_alt || raw.imageAlt || raw.alt || fallback.name || "Restaurant image",
    sourceUrl: raw.image_source_url || raw.imageSourceUrl || raw.sourceUrl || fallback.sourceUrl || null,
    sourceType: normalizeToken(raw.image_source_type || raw.imageSourceType || raw.sourceType, "owner_submission"),
    rightsBasis: raw.image_rights_basis || raw.imageRightsBasis || raw.rightsBasis || null,
    permission: permissionConfirmed ? normalizeToken(raw.image_permission || raw.permission, "permitted") : normalizeToken(raw.image_permission || raw.permission, "unverified"),
    permissionConfirmed,
    attribution: raw.image_attribution || raw.imageAttribution || raw.attribution || null,
    reviewState: normalizeToken(raw.image_review_state || raw.imageReviewState || raw.reviewState, "needs_review"),
    width: Number(raw.image_width ?? raw.imageWidth ?? raw.width) || null,
    height: Number(raw.image_height ?? raw.imageHeight ?? raw.height) || null
  };
}

function normalize(row, sourceFile) {
  const sourceUrl = row.source_url || row.sourceUrl || null;
  const base = { name: row.name, sourceUrl };
  const nestedImages = Array.isArray(row.images) ? row.images : [];
  const images = nestedImages.length ? nestedImages.map((image) => normalizeImage(image, base)).filter(Boolean) : [normalizeImage(row, base)].filter(Boolean);
  return {
    restaurantId: row.restaurant_id || row.restaurantId || null,
    name: row.name,
    neighborhood: row.neighborhood || row.neighbourhood || null,
    cuisines: splitList(row.cuisines),
    vibe: splitList(row.vibe),
    specials: row.special_title || row.specialTitle ? [{ title: row.special_title || row.specialTitle, cadence: row.special_cadence || row.specialCadence || "Owner submitted", sourceStatus: "needs-review" }] : [],
    events: row.event_title || row.eventTitle ? [{ title: row.event_title || row.eventTitle, timing: row.event_timing || row.eventTiming || "Owner submitted", sourceStatus: "needs-review" }] : [],
    images,
    sourceUrl,
    contactEmail: row.contact_email || row.contactEmail || null,
    sourceFile,
    observedAt: new Date().toISOString(),
    reviewState: normalizeToken(row.review_state || row.reviewState, "needs_review")
  };
}

const files = await readdir(inputDir).catch(() => []);
const normalized = [];
for (const file of files) {
  if (file.includes("example")) continue;
  const path = join(inputDir.pathname, file);
  const text = await readFile(path, "utf8");
  if (extname(file).toLowerCase() === ".csv") normalized.push(...parseCsv(text).map((row) => normalize(row, file)));
  if (extname(file).toLowerCase() === ".json") {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.submissions) ? parsed.submissions : [parsed];
    normalized.push(...rows.map((row) => normalize(row, file)));
  }
}

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: normalized.length, submissions: normalized }, null, 2));
console.log(`Normalized ${normalized.length} owner submissions to data/build/owner-submissions.normalized.json.`);