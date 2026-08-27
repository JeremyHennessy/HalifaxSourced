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
  return body.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])));
}

function splitList(value) {
  return String(value ?? "").split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function normalize(row, sourceFile) {
  return {
    name: row.name,
    neighborhood: row.neighborhood || null,
    cuisines: splitList(row.cuisines),
    vibe: splitList(row.vibe),
    specials: row.special_title ? [{ title: row.special_title, cadence: row.special_cadence || "Owner submitted", sourceStatus: "needs-review" }] : [],
    events: row.event_title ? [{ title: row.event_title, timing: row.event_timing || "Owner submitted", sourceStatus: "needs-review" }] : [],
    sourceUrl: row.source_url || null,
    contactEmail: row.contact_email || null,
    sourceFile,
    reviewState: "needs-review"
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
    const rows = JSON.parse(text);
    normalized.push(...(Array.isArray(rows) ? rows : [rows]).map((row) => normalize(row, file)));
  }
}

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: normalized.length, submissions: normalized }, null, 2));
console.log(`Normalized ${normalized.length} owner submissions to data/build/owner-submissions.normalized.json.`);
