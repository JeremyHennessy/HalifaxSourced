const DEFAULT_API_BASE = "https://tasteofnovascotia.com/wp-json/wp/v2";

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`invalid_${label}`);
  return parsed;
}

export function tasteRegionId(terms, regionSlug = "halifax-metro") {
  if (!Array.isArray(terms)) throw new Error("taste_region_terms_not_array");
  const matches = terms.filter((term) => term?.slug === regionSlug && Number.isInteger(Number(term?.id)));
  if (matches.length !== 1) throw new Error(`taste_region_resolution_${matches.length}`);
  return positiveInteger(matches[0].id, "taste_region_id");
}

export function tasteMemberApiUrl({
  apiBase = DEFAULT_API_BASE,
  categoryId,
  regionId,
  page = 1,
  perPage = 100
}) {
  const url = new URL("member", String(apiBase).replace(/\/?$/, "/"));
  url.searchParams.set("member-category[0]", String(positiveInteger(categoryId, "taste_category_id")));
  url.searchParams.set("member-region", String(positiveInteger(regionId, "taste_region_id")));
  url.searchParams.set("per_page", String(positiveInteger(perPage, "taste_per_page")));
  url.searchParams.set("page", String(positiveInteger(page, "taste_page")));
  url.searchParams.set("_fields", "id,link,title,member-region,modified,status");
  return url.href;
}

export function tasteMemberLinksFromApi(records, { regionId, sourceUrl }) {
  if (!Array.isArray(records)) throw new Error("taste_members_not_array");
  const expectedRegionId = positiveInteger(regionId, "taste_region_id");
  const expectedHost = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  const seenIds = new Set();
  const seenUrls = new Set();
  const links = [];

  for (const record of records) {
    const id = Number(record?.id);
    const regions = Array.isArray(record?.["member-region"])
      ? record["member-region"].map(Number)
      : [];
    if (!Number.isInteger(id) || id < 1 || (record?.status && record.status !== "publish") || !regions.includes(expectedRegionId)) continue;
    let url;
    try { url = new URL(record.link); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || host !== expectedHost || !/^\/members\/[^/]+\/?$/.test(url.pathname)) continue;
    const normalizedUrl = url.href;
    if (seenIds.has(id) || seenUrls.has(normalizedUrl)) continue;
    const name = String(record?.title?.rendered || "").trim();
    if (!name || name.length > 200) continue;
    seenIds.add(id);
    seenUrls.add(normalizedUrl);
    links.push({ id, name, url: normalizedUrl, modifiedAt: record.modified || null, apiRegionQualified: true });
  }
  return links;
}

export function assertTasteMemberCompleteness(expectedTotal, links, records) {
  const expected = Number(expectedTotal);
  if (!Number.isInteger(expected) || expected < 1) throw new Error("taste_api_total_invalid");
  if (!Array.isArray(links) || links.length !== expected) throw new Error(`taste_api_member_count_mismatch:${links?.length ?? 0}!=${expected}`);
  if (!Array.isArray(records) || records.length !== links.length) throw new Error(`taste_detail_incomplete:${records?.length ?? 0}!=${links.length}`);
}

export function tasteScopedDetailHtml(html) {
  const source = String(html || "");
  const currentStart = source.search(/<main\b|<div\b[^>]*class=["'][^"']*tast_single_member__content/i);
  const legacyStart = source.search(/<article\b|<h1\b/i);
  const start = currentStart >= 0 ? currentStart : (legacyStart >= 0 ? legacyStart : 0);
  const tail = source.slice(start);
  const end = tail.search(/<div\b[^>]*class=["'][^"']*taste_map__results\b|<section\b[^>]*class=["'][^"']*comments\b|<aside\b[^>]*role=["']complementary["']|<footer\b/i);
  return tail.slice(0, end > 0 ? end : tail.length);
}

function detailValue(html, label) {
  const escaped = String(label).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = String(html).match(new RegExp(`<div\\b[^>]*class=["'][^"']*taste_single_member__meta\\b[^"']*["'][^>]*>[\\s\\S]*?<h2\\b[^>]*>\\s*${escaped}\\s*<\\/h2>[\\s\\S]*?<div\\b[^>]*class=["'][^"']*taste_single_member__meta__value[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"));
  return match?.[1] || null;
}

export function tasteDetailAddress(html, decodeText) {
  const match = String(html).match(/<address\b[^>]*class=["'][^"']*taste_single_mebmer__address[^"']*["'][^>]*>([\s\S]*?)<\/address>/i);
  return match?.[1] ? decodeText(match[1]).replace(/\s+/g, " ").trim() : null;
}

export function tasteDetailOpeningHours(html, decodeText) {
  const raw = detailValue(html, "Hours of Operation");
  if (!raw) return null;
  const value = decodeText(raw).replace(/\s+/g, " ").trim();
  if (!value || /(?:please\s+)?(?:visit|check|see)\s+(?:our\s+)?website|hours?\s+(?:may\s+)?vary|contact\s+(?:the\s+)?(?:restaurant|member|business)/i.test(value)) return null;
  return value;
}
