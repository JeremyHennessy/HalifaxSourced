import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const lookbackDays = Number(process.env.OPENING_WATCH_LOOKBACK_DAYS ?? 180);
const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
const userAgent = "HalifaxSourced/0.4 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const sources = [
  {
    name: "Halifax ReTales",
    type: "local_opening_watch",
    url: "https://halifax.retales.ca/feed/"
  }
];

function decode(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block, tags) {
  for (const tag of tags) {
    const match = String(block).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return decode(match[1]);
  }
  return "";
}

function tagRaw(block, tags) {
  for (const tag of tags) {
    const match = String(block).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return match[1];
  }
  return "";
}

function itemBlocks(xml) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
}

function sentenceCandidates(text) {
  const withBoundaries = String(text ?? "")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, ". ");
  return decode(withBoundaries)
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 12 && value.length <= 700);
}

function openingStatus(sentence) {
  const value = sentence.toLowerCase();
  if (/\bis now open\b|\bhas opened\b|\bnow open\b/.test(value)) return "open";
  if (/\blooks like (?:it )?is opening\b|\bis opening\b|\bopening this week\b|\bopening soon\b/.test(value)) return "opening";
  if (/\bcoming soon\b|\bwill open\b|\bis coming\b/.test(value)) return "coming_soon";
  if (/\bis returning\b|\bhas returned\b|\breopening\b|\breopened\b/.test(value)) return "returning";
  if (/\btaking over\b|\btakes over\b/.test(value)) return "location_change";
  return null;
}

function extractName(sentence) {
  const normalized = sentence.replace(/\s+/g, " ").trim();

  const quotedDescriptor = normalized.match(
    /^([A-Z][A-Za-z0-9À-ÿ&'’.\-]*(?:\s+[A-Z][A-Za-z0-9À-ÿ&'’.\-]*){0,5})(?:\s+[“"][^”"]{1,100}[”"])?\s*,?\s*(?:is now open|has opened|is opening|looks like (?:it )?is opening|will open|is coming soon|is returning|has returned|is reopening|has reopened)\b/i
  );
  if (quotedDescriptor) return quotedDescriptor[1].trim();

  const commaLead = normalized.match(
    /^(.{2,90}?),\s*(?:is now open|has opened|is opening|looks like (?:it )?is opening|will open|is coming soon|is returning|has returned|is reopening|has reopened)\b/i
  );
  if (commaLead) {
    let value = commaLead[1]
      .replace(/^(?:and|but|meanwhile|also|the\s+)?/i, "")
      .replace(/^(?:indian|japanese|korean|yemeni|lebanese|italian|mexican|filipino|chinese)\s+(?:resto|restaurant|spot|place)\s+/i, "")
      .replace(/^(?:restaurant|resto|spot|cafe|café|bar)\s+/i, "")
      .trim();
    if (value.split(/\s+/).length <= 7) return value;
  }

  const takeover = normalized.match(/^([A-Z][A-Za-z0-9À-ÿ&'’.\-]*(?:\s+[A-Z][A-Za-z0-9À-ÿ&'’.\-]*){0,5}).{0,120}\b(?:taking over|takes over)\b/i);
  if (takeover) return takeover[1].trim();

  return null;
}

function extractLocation(sentence) {
  const patterns = [
    /\bon\s+([A-Z0-9][^.;]{2,100}?)(?:\s+(?:beside|near|by|across|inside|at)\b|[.;]|$)/i,
    /\bat\s+([0-9]{1,5}\s+[A-Z][^.;]{2,90})(?:[.;]|$)/i,
    /\bin\s+(Downtown Halifax|Halifax|Dartmouth|Bedford|North End|South End|West End|Waterfront)\b/i
  ];
  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (match) return decode(match[1]).slice(0, 120);
  }
  return null;
}

function slug(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const leads = [];
const failures = [];

for (const source of sources) {
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": userAgent, Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const xml = await response.text();

    for (const item of itemBlocks(xml).slice(0, 80)) {
      const publishedRaw = tagText(item, ["pubDate", "published", "updated", "dc:date"]);
      const publishedStamp = Date.parse(publishedRaw);
      if (Number.isFinite(publishedStamp) && publishedStamp < cutoff) continue;

      const articleTitle = tagText(item, ["title"]).slice(0, 180);
      const sourceUrl = tagText(item, ["link"]);
      const content = tagRaw(item, ["content:encoded", "description"]);
      for (const sentence of sentenceCandidates(content)) {
        const status = openingStatus(sentence);
        if (!status) continue;
        const name = extractName(sentence);
        if (!name || name.length < 2 || name.length > 90) continue;
        if (/^(this|that|there|they|we|it|same store|hear ye)$/i.test(name)) continue;

        const locationHint = extractLocation(sentence);
        const fingerprint = createHash("sha256")
          .update(`${source.name}|${sourceUrl}|${name}|${status}|${locationHint || ""}`)
          .digest("hex")
          .slice(0, 16);

        leads.push({
          id: `${slug(name)}-${fingerprint}`,
          name,
          status,
          locationHint,
          articleTitle,
          sourceName: source.name,
          sourceType: source.type,
          sourceUrl,
          publishedAt: Number.isFinite(publishedStamp) ? new Date(publishedStamp).toISOString() : null,
          observedAt: new Date().toISOString(),
          confidence: "local_opening_lead",
          reviewState: "needs-cross-check"
        });
      }
    }
  } catch (error) {
    failures.push({ sourceName: source.name, sourceUrl: source.url, reason: error.message });
  }
}

const unique = leads.filter((lead, index, all) =>
  all.findIndex((item) =>
    item.sourceUrl === lead.sourceUrl &&
    item.name.toLowerCase() === lead.name.toLowerCase() &&
    item.status === lead.status
  ) === index
).sort((a, b) => String(b.publishedAt || b.observedAt).localeCompare(String(a.publishedAt || a.observedAt)));

const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  lookbackDays,
  sources,
  count: unique.length,
  leads: unique,
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/opening-watch-leads.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/opening-watch-leads.js", import.meta.url), `window.HALIFAX_OPENING_WATCH_LEADS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Opening watch: leads=${unique.length}, failures=${failures.length}.`);
for (const lead of unique.slice(0, 20)) console.log(`- ${lead.name}: ${lead.status}${lead.locationHint ? ` @ ${lead.locationHint}` : ""}`);
