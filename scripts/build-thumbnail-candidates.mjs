import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const generatedAt = new Date().toISOString();
const timeoutMs = Number(process.env.THUMBNAIL_DISCOVERY_TIMEOUT_MS ?? 8000);
const delayMs = Number(process.env.THUMBNAIL_DISCOVERY_DELAY_MS ?? 150);
const pageLimit = Math.max(0, Number(process.env.THUMBNAIL_DISCOVERY_PAGE_LIMIT ?? 120));
const pagesPerRestaurant = Math.max(1, Math.min(6, Number(process.env.THUMBNAIL_DISCOVERY_PAGES_PER_RESTAURANT ?? 3)));
const fetchOfficialPages = String(process.env.THUMBNAIL_DISCOVERY_FETCH ?? "0") === "1";
const discoveryScope = String(process.env.THUMBNAIL_DISCOVERY_SCOPE ?? "missing_any").toLowerCase();
const subpageLimit = Math.max(0, Math.min(12, Number(process.env.THUMBNAIL_DISCOVERY_SUBPAGE_LIMIT ?? 8)));
const imageProbeEnabled = String(process.env.THUMBNAIL_IMAGE_PROBE ?? (fetchOfficialPages ? "1" : "0")) === "1";
const imageProbeLimit = Math.max(0, Number(process.env.THUMBNAIL_IMAGE_PROBE_LIMIT ?? 400));
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const outputJsonPath = new URL("../data/build/thumbnail-candidates.json", import.meta.url);
const outputScriptPath = new URL("../data/thumbnail-candidates.js", import.meta.url);
let reviewedThumbnailRejections = new Map();
let reviewedThumbnailDecisionsById = new Map();
let reviewedThumbnailDecisionsByImage = new Map();

const subpageSlugs = [
  "menu", "menus", "food", "drink", "drinks", "gallery", "photos", "events", "event", "blog", "news", "specials", "happy-hour", "happyhour", "patio", "about"
];
const blockedSourceHostFragments = [
  "facebook.com", "instagram.com", "fbcdn.net", "scontent-", "skipthedishes.com", "ubereats.com", "doordash.com", "tbdine.com", "opentable.", "resy.com", "yelp.", "tripadvisor.", "google.", "maps.google.", "linktr.ee", "bit.ly", "tinyurl.com"
];
const approvedImageCdnHosts = new Set([
  "images.squarespace-cdn.com", "static1.squarespace.com", "static.wixstatic.com", "img1.wsimg.com", "images.getbento.com", "res.cloudinary.com", "i0.wp.com", "i1.wp.com", "i2.wp.com", "i3.wp.com", "cdn.shopify.com", "cdn.sanity.io", "assets-global.website-files.com", "uploads-ssl.webflow.com"
]);

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")); }
  catch { return fallback; }
}

async function loadWindowScript(path, globalName, fallback) {
  try {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window[globalName] ?? fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function hashId(parts) { return createHash("sha1").update(parts.filter(Boolean).join("|"), "utf8").digest("hex").slice(0, 18); }
function publicHttpUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return !(
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? "").trim(), base);
    return ["http:", "https:"].includes(url.protocol) && publicHttpUrl(url) ? url.href : null;
  } catch { return null; }
}
function safeAssetPath(value) {
  const raw = String(value ?? "").trim();
  if (/^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw.startsWith("./") ? raw : `./${raw}`;
  return null;
}
function safeThumbnailUrl(value, base) {
  const assetPath = safeAssetPath(value);
  if (assetPath) return assetPath;
  const raw = htmlDecode(value);
  if (!raw || /[{}]|(?:link|location)\.href/i.test(raw) || /^[a-z]$/i.test(raw.trim())) return null;
  const url = safeUrl(raw, base);
  if (!url) return null;
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (/%22|%27/i.test(url)) return null;
  if (/\.(?:svg|ico|woff2?|ttf|eot|css|js|map|pdf)(?:[?#]|$)/i.test(url)) return null;
  if (parsed.hash && /svg/i.test(parsed.hash)) return null;
  if (/^\/[a-z]$/i.test(path) && !parsed.search) return null;
  return url;
}
function thumbnailQualityFlags(candidate) {
  const flags = [];
  const thumbnailUrl = String(candidate?.thumbnailUrl || candidate?.url || "").trim();
  const sourceUrl = String(candidate?.sourceUrl || "").trim();
  const lower = thumbnailUrl.toLowerCase();
  const sourceLower = sourceUrl.toLowerCase();
  const pathname = (() => { try { return new URL(thumbnailUrl).pathname.toLowerCase(); } catch { return lower; } })();
  const filename = pathname.split("/").pop() || pathname;
  if (thumbnailUrl.startsWith("http://")) flags.push("insecure_thumbnail_url");
  if (/favicon|apple-touch-icon|touch-icon|site-icon|sprite|avatar|badge|pwa-icon|pwa-app|logo-default|sitelogo/.test(lower) || /(?:^|[-_.])(icon|apple)(?:[-_.0-9]|$)/.test(filename)) flags.push("icon_or_favicon");
  if (/placeholder|blank|default-image|dummy/.test(lower)) flags.push("placeholder_image");
  if (/[^/?#]*logo[^/?#]*\.(?:png|jpe?g|webp)|(?:^|[/\-_.+])logo(?:[/\-_.+0-9]|$)|\/logos?\/|public\/logos?|cropped-[^/]{0,80}32x32|32x32|57x57|60x60|72x72|114x114|120x120|144x144|180x180|192x192|225x225|(?:^|[?&/,_-])w[_=](?:1?\d{1,2}|2[0-4]\d)(?!\d)|(?:^|[?&/,_-])h[_=](?:1?\d{1,2}|2[0-4]\d)(?!\d)/.test(lower)) flags.push("logo_candidate");
  if (/social-sharing|socialshare|socialpreview|twitter-card|ogimage|og-image|(?:^|[-_.])social(?:[-_.]|$)/.test(filename)) flags.push("generic_social_card");
  if (/stock|franchis|brand-refresh|summary_square|artboard|fit=100%2c50|fit=100,50|h1_shape|web\+logo|web-logo/.test(lower)) flags.push("generic_brand_or_stock_image");
  if (/facebook\.com|fbcdn\.net|scontent-/.test(lower) || /facebook\.com|fbcdn\.net|scontent-/.test(sourceLower)) flags.push("social_profile_image");
  if (safeUrl(thumbnailUrl) && safeUrl(sourceUrl) && safeUrl(thumbnailUrl) === safeUrl(sourceUrl)) flags.push("thumbnail_is_page_url");
  if (["blocked_source_host", "blocked_image_host", "source_host_not_first_party"].includes(candidate?.sourceHostValidation)) flags.push(candidate.sourceHostValidation);
  if (candidate?.sourceHostValidation === "remote_image_host_needs_source_check") flags.push("remote_image_host_needs_source_check");
  const probedWidth = Number(candidate?.imageProbe?.width || candidate?.width);
  const probedHeight = Number(candidate?.imageProbe?.height || candidate?.height);
  const probedContentType = String(candidate?.imageProbe?.contentType || "").toLowerCase();
  const probedBytes = Number(candidate?.imageProbe?.contentLength || candidate?.imageProbe?.sampledBytes || 0);
  if (candidate?.imageProbe && candidate.imageProbe.ok === false) flags.push("image_probe_failed");
  if (probedContentType && !probedContentType.startsWith("image/")) flags.push("non_image_response");
  if (Number.isFinite(probedWidth) && Number.isFinite(probedHeight) && probedWidth > 0 && probedHeight > 0) {
    const aspect = probedWidth / probedHeight;
    if (probedWidth < 300 || probedHeight < 160) flags.push("tiny_decoded_image");
    if (aspect < 0.5 || aspect > 2.8) flags.push("awkward_thumbnail_aspect");
  }
  if (probedBytes > 0 && probedBytes < 12000) flags.push("very_small_image_payload");
  const reviewedDecision = reviewedThumbnailDecisionsById.get(candidate?.id) || reviewedThumbnailDecisionsByImage.get(`${candidate?.restaurantId || ""}|${thumbnailUrl}`);
  if (reviewedDecision === "needs_source_check") flags.push("reviewed_needs_source_check");
  const rejectionKey = `${candidate?.restaurantId || ""}|${thumbnailUrl}`;
  if (reviewedThumbnailRejections.has(rejectionKey)) flags.push(`reviewed_rejected_${reviewedThumbnailRejections.get(rejectionKey)}`);
  return [...new Set(flags)];
}
function thumbnailReviewPriority(candidate) {
  if (candidate?.reviewState === "approved" && candidate?.rightsStatus === "production_approved") return 100;
  const flags = thumbnailQualityFlags(candidate);
  let score = 50;
  if (!String(candidate?.thumbnailUrl || "").startsWith("https://")) score -= 4;
  if (candidate?.sourceKind === "official_feed_media") score += 8;
  if (candidate?.sourceKind === "official_page_thumbnail_candidate") score += 4;
  if (candidate?.confidence === "same_host_official_page_image") score += 4;
  if (flags.includes("generic_social_card")) score -= 8;
  for (const flag of flags) {
    if (["icon_or_favicon", "placeholder_image", "logo_candidate", "social_profile_image", "thumbnail_is_page_url", "generic_brand_or_stock_image", "blocked_source_host", "blocked_image_host", "source_host_not_first_party", "non_image_response", "tiny_decoded_image", "awkward_thumbnail_aspect", "very_small_image_payload", "image_probe_failed"].includes(flag)) score -= 35;
  }
  return Math.max(0, score);
}
function promotionReviewState(candidate) {
  if (candidate?.reviewState === "approved" && candidate?.rightsStatus === "production_approved") return "approved";
  const flags = thumbnailQualityFlags(candidate);
  if (flags.includes("reviewed_needs_source_check") || flags.includes("remote_image_host_needs_source_check")) return "source_check";
  return thumbnailReviewPriority(candidate) >= 45 && flags.length === 0 ? "needs_visual_review" : "low_quality_metadata";
}
function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); }
  catch { return ""; }
}
function hostBlocked(value) {
  const normalized = host(value);
  return !normalized || blockedSourceHostFragments.some((fragment) => normalized.includes(fragment));
}
function hostMatches(candidateHost, officialHost) {
  if (!candidateHost || !officialHost) return false;
  return candidateHost === officialHost || candidateHost.endsWith(`.${officialHost}`) || officialHost.endsWith(`.${candidateHost}`);
}
function officialHostsForRestaurant(restaurant, firstPartyRecord = {}) {
  return [...new Set([restaurant.website, firstPartyRecord.website]
    .map((value) => host(value))
    .filter((value) => value && !hostBlocked(`https://${value}`)))]
}
function sourceHostValidation(restaurant, pageUrl, imageUrl, firstPartyRecord = {}) {
  const pageHost = host(pageUrl);
  const imageHost = host(imageUrl);
  const officialHosts = officialHostsForRestaurant(restaurant, firstPartyRecord);
  const pageIsOfficial = officialHosts.some((officialHost) => hostMatches(pageHost, officialHost));
  const imageIsOfficial = officialHosts.some((officialHost) => hostMatches(imageHost, officialHost));
  const imageIsApprovedCdn = approvedImageCdnHosts.has(imageHost);
  if (hostBlocked(pageUrl)) return { state: "blocked_source_host", pageHost, imageHost, officialHosts };
  if (!pageIsOfficial) return { state: "source_host_not_first_party", pageHost, imageHost, officialHosts };
  if (hostBlocked(imageUrl)) return { state: "blocked_image_host", pageHost, imageHost, officialHosts };
  if (imageIsOfficial) return { state: "first_party_image_host", pageHost, imageHost, officialHosts };
  if (imageIsApprovedCdn) return { state: "approved_cdn_image_host", pageHost, imageHost, officialHosts };
  return { state: "remote_image_host_needs_source_check", pageHost, imageHost, officialHosts };
}
function siteRoot(value) {
  const url = safeUrl(value);
  if (!url || hostBlocked(url)) return null;
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/`;
}
function officialSubpageUrls(restaurant, firstPartyRecord = {}) {
  const urls = [];
  const push = (value) => {
    const url = safeUrl(value);
    if (!url || hostBlocked(url)) return;
    const validation = sourceHostValidation(restaurant, url, url, firstPartyRecord);
    if (["first_party_image_host", "approved_cdn_image_host"].includes(validation.state)) urls.push(url);
  };
  push(restaurant.website);
  push(firstPartyRecord.website);
  for (const link of firstPartyRecord.relatedLinks || []) {
    if (["menu", "events", "ordering", "reservations"].includes(link.kind)) push(link.url);
  }
  for (const base of [restaurant.website, firstPartyRecord.website].map(siteRoot).filter(Boolean)) {
    for (const slug of subpageSlugs.slice(0, subpageLimit)) push(new URL(slug.replace(/^\//, ""), base).href);
  }
  return [...new Set(urls)].slice(0, pagesPerRestaurant);
}
function readUint24(bytes, offset) {
  return (bytes[offset] << 16) + (bytes[offset + 1] << 8) + bytes[offset + 2];
}
function decodeImageDimensions(bytes) {
  if (!bytes?.length || bytes.length < 16) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length >= 24) {
    return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const size = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { format: "jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += Math.max(2, size + 2);
    }
  }
  if (bytes.slice(0, 6).toString("ascii") === "GIF87a" || bytes.slice(0, 6).toString("ascii") === "GIF89a") {
    return { format: "gif", width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") {
    const type = bytes.slice(12, 16).toString("ascii");
    if (type === "VP8X" && bytes.length >= 30) return { format: "webp", width: 1 + readUint24(bytes, 24), height: 1 + readUint24(bytes, 27) };
    if (type === "VP8 " && bytes.length >= 30) return { format: "webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (type === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { format: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  return null;
}
async function probeImage(candidate) {
  const thumbnailUrl = safeUrl(candidate?.thumbnailUrl);
  if (!thumbnailUrl || !thumbnailUrl.startsWith("https://")) return null;
  try {
    const response = await fetch(thumbnailUrl, {
      headers: { "User-Agent": userAgent, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.6", Range: "bytes=0-262143" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok && response.status !== 206) return { ok: false, status: response.status };
    const bytes = Buffer.from(await response.arrayBuffer());
    const dimensions = decodeImageDimensions(bytes);
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      contentLength: Number(response.headers.get("content-length")) || null,
      sampledBytes: bytes.length,
      ...(dimensions || {})
    };
  } catch (error) {
    return { ok: false, reason: error.name === "TimeoutError" ? "timeout" : error.message };
  }
}
function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .trim();
}
function token(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function usableImageUrl(value, base) {
  const raw = htmlDecode(value);
  if (!raw || /[{}]|location\.href/i.test(raw) || /^[a-z]$/i.test(raw.trim())) return null;
  const url = safeUrl(raw, base);
  if (!url) return null;
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (/%22|%27/i.test(url)) return null;
  if (/\.(?:svg|ico|woff2?|ttf|eot|css|js|map|pdf)(?:[?#]|$)/i.test(url)) return null;
  if (parsed.hash && /svg/i.test(parsed.hash)) return null;
  if (/^\/[a-z]$/i.test(path) && !parsed.search) return null;
  if (/\b(?:link|location)\.href\b/i.test(path)) return null;
  return url;
}
function extractMetaImages(html, baseUrl) {
  const images = [];
  const source = String(html ?? "");
  for (const match of source.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]*>/gi)) {
    const tag = match[0];
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    const url = usableImageUrl(content, baseUrl);
    if (url) images.push({ url, extractionMethod: "html_meta_image" });
  }
  for (const match of source.matchAll(/<link\b[^>]*rel=["'][^"']*(?:image_src|apple-touch-icon|icon)[^"']*["'][^>]*>/gi)) {
    const tag = match[0];
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const url = usableImageUrl(href, baseUrl);
    if (url) images.push({ url, extractionMethod: "html_link_image" });
  }
  for (const match of source.matchAll(/"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)"|\{[^}]*"url"\s*:\s*"([^"]+)")/gi)) {
    const url = usableImageUrl(match[1] || match[2] || match[3], baseUrl);
    if (url) images.push({ url, extractionMethod: "jsonld_image" });
  }
  return images.filter((image, index, all) => all.findIndex((item) => item.url === image.url) === index).slice(0, 6);
}
function imageUrlFromSrcset(value) {
  const first = String(value || "").split(",").map((part) => part.trim()).find(Boolean);
  return first ? first.split(/\s+/)[0] : null;
}
function attrValue(tag, attr) {
  return tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"))?.[1] || null;
}
function numericAttr(tag, attr) {
  const value = Number(attrValue(tag, attr));
  return Number.isFinite(value) ? value : null;
}
function extractHtmlContentImages(html, baseUrl) {
  const images = [];
  const source = String(html ?? "");
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const rawUrl = attrValue(tag, "src") || attrValue(tag, "data-src") || attrValue(tag, "data-lazy-src") || imageUrlFromSrcset(attrValue(tag, "srcset") || attrValue(tag, "data-srcset"));
    const url = usableImageUrl(rawUrl, baseUrl);
    if (!url) continue;
    const alt = htmlDecode(attrValue(tag, "alt") || attrValue(tag, "title") || "");
    images.push({ url, extractionMethod: "html_img_content", alt, width: numericAttr(tag, "width"), height: numericAttr(tag, "height") });
  }
  for (const match of source.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const url = usableImageUrl(match[1], baseUrl);
    if (url) images.push({ url, extractionMethod: "css_background_image" });
  }
  return images
    .filter((image) => !/data:image|\.svg(?:\?|$)|\.ico(?:\?|$)/i.test(image.url))
    .filter((image, index, all) => all.findIndex((item) => item.url === image.url) === index)
    .slice(0, 18);
}
function approvedCandidate(record, restaurantName) {
  return {
    restaurantId: record.restaurantId,
    restaurantName,
    thumbnailUrl: record.url,
    sourceUrl: record.sourceUrl,
    sourceKind: "approved_restaurant_media",
    extractionMethod: "approved_media_manifest",
    reviewState: "approved",
    rightsStatus: "production_approved",
    permission: record.permission || null,
    rightsBasis: record.rightsBasis || null,
    attribution: record.attribution || null,
    alt: record.alt || restaurantName || "Restaurant thumbnail",
    confidence: "approved_exact_restaurant_id",
    observedAt: generatedAt
  };
}
function postCandidate(post, restaurantName, sourceKind) {
  const thumbnailUrl = safeThumbnailUrl(post.thumbnailUrl || post.mediaUrl);
  const sourceUrl = safeUrl(post.postUrl);
  if (!thumbnailUrl || !sourceUrl) return null;
  return {
    restaurantId: post.restaurantId,
    restaurantName: post.restaurantName || restaurantName,
    thumbnailUrl,
    sourceUrl,
    postUrl: sourceUrl,
    platform: post.platform || null,
    sourceKind,
    extractionMethod: "declared_post_media",
    reviewState: "candidate_review",
    rightsStatus: "requires_rights_review",
    permission: null,
    rightsBasis: null,
    attribution: null,
    alt: post.title ? `${post.restaurantName || restaurantName}: ${post.title}` : `${post.restaurantName || restaurantName} update thumbnail`,
    confidence: sourceKind === "meta_social_media" ? "official_social_api_media" : sourceKind === "official_page_thumbnail_candidate" ? "official_page_source_media" : "official_feed_media",
    observedAt: post.observedAt || generatedAt,
    publishedAt: post.publishedAt || null,
    title: post.title || null,
    category: post.primaryCategory || null
  };
}
function publicSpecialImageCandidate(lead, restaurantName) {
  const thumbnailUrl = safeThumbnailUrl(lead.sourceImageUrl);
  const sourceUrl = safeUrl(lead.sourceUrl || lead.sourcePageUrl);
  if (!thumbnailUrl || !sourceUrl || !lead.restaurantId) return null;
  return {
    restaurantId: lead.restaurantId,
    restaurantName: lead.venueName || restaurantName,
    thumbnailUrl,
    sourceUrl,
    pageUrl: safeUrl(lead.sourcePageUrl) || sourceUrl,
    platform: null,
    sourceKind: lead.sourceId === "discover-halifax-dine-around-2026" ? "public_campaign_menu_image" : "public_special_source_image",
    extractionMethod: "public_special_source_declared_image",
    reviewState: "candidate_review",
    rightsStatus: "requires_rights_review",
    permission: null,
    rightsBasis: null,
    attribution: lead.sourceName || null,
    alt: lead.title ? `${lead.venueName || restaurantName}: ${lead.title}` : `${lead.venueName || restaurantName} special image candidate`,
    confidence: "public_special_source_media",
    observedAt: lead.observedAt || generatedAt,
    publishedAt: lead.sourceUpdatedAt || null,
    title: lead.title || null,
    category: lead.specialType || null
  };
}
function directoryImageCandidate(lead, resolution, restaurantName) {
  const thumbnailUrl = safeThumbnailUrl(lead.sourceImageUrl);
  const sourceUrl = safeUrl(lead.sourceUrl);
  const restaurantId = resolution?.matchedRestaurantId;
  if (!thumbnailUrl || !sourceUrl || !restaurantId) return null;
  return {
    restaurantId,
    restaurantName: restaurantName || resolution.matchedRestaurantName || lead.name,
    thumbnailUrl,
    sourceUrl,
    pageUrl: sourceUrl,
    platform: null,
    sourceKind: "directory_source_image",
    extractionMethod: "trusted_directory_declared_image",
    reviewState: "candidate_review",
    rightsStatus: "requires_rights_review",
    permission: null,
    rightsBasis: null,
    attribution: lead.sourceName || null,
    alt: `${restaurantName || resolution.matchedRestaurantName || lead.name} directory thumbnail candidate`,
    confidence: "trusted_directory_source_media",
    observedAt: lead.observedAt || generatedAt,
    publishedAt: null,
    title: lead.name || null,
    category: lead.category || null
  };
}
function pageCandidate(restaurant, pageUrl, image, firstPartyRecord = {}) {
  const validation = sourceHostValidation(restaurant, pageUrl, image.url, firstPartyRecord);
  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    thumbnailUrl: image.url,
    sourceUrl: pageUrl,
    pageUrl,
    sourceKind: "official_page_thumbnail_candidate",
    extractionMethod: image.extractionMethod,
    width: image.width || null,
    height: image.height || null,
    imageProbe: image.imageProbe || null,
    imageHost: validation.imageHost || null,
    sourceHost: validation.pageHost || null,
    officialHosts: validation.officialHosts || [],
    sourceHostValidation: validation.state,
    reviewState: "candidate_review",
    rightsStatus: "requires_rights_review",
    permission: null,
    rightsBasis: null,
    attribution: null,
    alt: image.alt ? `${restaurant.name}: ${image.alt}` : `${restaurant.name} thumbnail candidate`,
    confidence: validation.state === "first_party_image_host" ? "same_host_official_page_image" : validation.state === "approved_cdn_image_host" ? "official_page_approved_cdn_image" : validation.state,
    observedAt: generatedAt
  };
}
function ownerSubmittedImageCandidate(submission, image, restaurantName) {
  const thumbnailUrl = safeThumbnailUrl(image.url);
  const sourceUrl = safeUrl(image.sourceUrl || submission.sourceUrl);
  if (!submission.restaurantId || !thumbnailUrl || !sourceUrl) return null;
  const permissionConfirmed = image.permissionConfirmed === true;
  return {
    restaurantId: submission.restaurantId,
    restaurantName: restaurantName || submission.name || "Owner-submitted restaurant",
    thumbnailUrl,
    sourceUrl,
    sourceKind: "owner_submitted_image",
    extractionMethod: "owner_submitted_media_import",
    width: image.width || null,
    height: image.height || null,
    reviewState: "candidate_review",
    rightsStatus: "requires_rights_review",
    permission: image.permission || null,
    permissionConfirmed,
    rightsBasis: image.rightsBasis || null,
    attribution: image.attribution || null,
    alt: image.alt || `${submission.name || restaurantName || "Restaurant"} owner-submitted image`,
    confidence: permissionConfirmed ? "owner_submitted_permission_declared" : "owner_submitted_needs_permission",
    observedAt: submission.observedAt || generatedAt,
    title: submission.name || restaurantName || null,
    category: "owner_submission"
  };
}
function normalizeCandidate(candidate) {
  if (!candidate?.restaurantId || !candidate.thumbnailUrl || !candidate.sourceUrl) return null;
  const thumbnailUrl = safeThumbnailUrl(candidate.thumbnailUrl);
  const sourceUrl = safeUrl(candidate.sourceUrl);
  if (!thumbnailUrl || !sourceUrl) return null;
  const normalized = {
    id: `thumb-${hashId([candidate.restaurantId, thumbnailUrl, candidate.sourceKind])}`,
    restaurantId: candidate.restaurantId,
    restaurantName: candidate.restaurantName || "Unknown restaurant",
    thumbnailUrl,
    sourceUrl,
    postUrl: safeUrl(candidate.postUrl) || null,
    pageUrl: safeUrl(candidate.pageUrl) || null,
    platform: candidate.platform || null,
    sourceKind: candidate.sourceKind,
    extractionMethod: candidate.extractionMethod,
    width: candidate.imageProbe?.width || candidate.width || null,
    height: candidate.imageProbe?.height || candidate.height || null,
    imageProbe: candidate.imageProbe || null,
    imageHost: candidate.imageHost || host(thumbnailUrl) || null,
    sourceHost: candidate.sourceHost || host(sourceUrl) || null,
    officialHosts: candidate.officialHosts || [],
    sourceHostValidation: candidate.sourceHostValidation || null,
    reviewState: candidate.reviewState,
    rightsStatus: candidate.rightsStatus,
    permission: candidate.permission || null,
    permissionConfirmed: candidate.permissionConfirmed === true,
    rightsBasis: candidate.rightsBasis || null,
    attribution: candidate.attribution || null,
    alt: String(candidate.alt || candidate.restaurantName || "Restaurant thumbnail").slice(0, 180),
    confidence: candidate.confidence,
    observedAt: candidate.observedAt || generatedAt,
    publishedAt: candidate.publishedAt || null,
    title: candidate.title || null,
    category: candidate.category || null,
    eligibleForProduction: candidate.reviewState === "approved" && candidate.rightsStatus === "production_approved"
  };
  const reviewedDecision = reviewedThumbnailDecisionsById.get(normalized.id) || reviewedThumbnailDecisionsByImage.get(`${normalized.restaurantId}|${normalized.thumbnailUrl}`);
  if (reviewedDecision === "needs_source_check") normalized.reviewState = "source_check";
  if (["reject_thumbnail", "reject_candidate"].includes(reviewedDecision)) {
    normalized.reviewState = "rejected";
    normalized.rightsStatus = "rejected";
  }
  normalized.eligibleForProduction = normalized.reviewState === "approved" && normalized.rightsStatus === "production_approved";
  normalized.qualityFlags = thumbnailQualityFlags(normalized);
  normalized.reviewPriority = thumbnailReviewPriority(normalized);
  normalized.promotionReviewState = promotionReviewState(normalized);
  return normalized;
}

const catalog = await loadJson("../data/build/catalog.json", { restaurants: [] });
const firstParty = await loadJson("../data/build/first-party-sources.json", { records: [] });
const recentPosts = await loadJson("../data/build/recent-social-posts.json", { records: [] });
const feedPayload = await loadJson("../data/build/website-feed-signals.json", { posts: [] });
const socialPayload = await loadJson("../data/build/social-signals.json", { posts: [] });
const publicSpecialPayload = await loadJson("../data/build/public-special-source-leads.json", { records: [] });
const directoryPayload = await loadJson("../data/build/directory-restaurant-leads.json", { records: [] });
const placeResolutionPayload = await loadJson("../data/build/place-source-resolutions.json", { resolutions: [] });
const mediaPayload = await loadWindowScript("data/restaurant-media.js", "HALIFAX_RESTAURANT_MEDIA", { records: [] });
const rejectionPayload = await loadJson("../data/thumbnail-rejected-candidates.json", { records: [] });
const reviewedDecisionPayload = await loadJson("../data/reviewed-thumbnail-decisions.json", { records: [] });
const ownerSubmissionPayload = await loadJson("../data/build/owner-submissions.normalized.json", { submissions: [] });
reviewedThumbnailRejections = new Map((rejectionPayload.records || []).map((record) => [`${record.restaurantId}|${safeThumbnailUrl(record.thumbnailUrl) || record.thumbnailUrl}`, token(record.reason || "reviewed_rejected")]));
reviewedThumbnailDecisionsById = new Map((reviewedDecisionPayload.records || []).map((record) => [record.id, token(record.decision)]).filter(([id]) => id));
reviewedThumbnailDecisionsByImage = new Map((reviewedDecisionPayload.records || []).map((record) => [`${record.restaurantId || ""}|${safeThumbnailUrl(record.thumbnailUrl) || record.thumbnailUrl || ""}`, token(record.decision)]).filter(([key]) => !key.endsWith("|")));
const existingThumbnailPayload = await loadJson("../data/build/thumbnail-candidates.json", { candidates: [], failures: [] });
const restaurants = Array.isArray(catalog.restaurants) ? catalog.restaurants : [];
const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
const firstPartyById = new Map((firstParty.records || []).map((record) => [record.restaurantId, record]));
const resolvedDirectoryByCandidateId = new Map((placeResolutionPayload.resolutions || [])
  .filter((resolution) => String(resolution?.state || "").startsWith("resolved_") && resolution.matchedRestaurantId)
  .map((resolution) => [resolution.candidateId, resolution]));
const candidates = [];
const failures = [];

for (const media of mediaPayload.records || []) {
  const restaurant = restaurantsById.get(media.restaurantId);
  if (!restaurant) continue;
  candidates.push(approvedCandidate(media, restaurant.name));
}
for (const post of [
  ...(recentPosts.records || []),
  ...(feedPayload.posts || []),
  ...(socialPayload.posts || [])
]) {
  const restaurant = restaurantsById.get(post.restaurantId);
  const sourceKind = post.sourceFamily === "social_api" || ["facebook", "instagram"].includes(post.platform) ? "meta_social_media" : post.sourceFamily === "website_page" || post.platform === "official_page" ? "official_page_thumbnail_candidate" : "official_feed_media";
  const candidate = postCandidate(post, restaurant?.name || post.restaurantName, sourceKind);
  if (candidate) candidates.push(candidate);
}
for (const lead of publicSpecialPayload.records || []) {
  const restaurant = restaurantsById.get(lead.restaurantId);
  const candidate = publicSpecialImageCandidate(lead, restaurant?.name || lead.venueName);
  if (candidate) candidates.push(candidate);
}

for (const lead of directoryPayload.records || []) {
  const resolution = resolvedDirectoryByCandidateId.get(lead.id);
  const restaurant = restaurantsById.get(resolution?.matchedRestaurantId);
  const candidate = directoryImageCandidate(lead, resolution, restaurant?.name);
  if (candidate) candidates.push(candidate);
}
for (const candidate of existingThumbnailPayload.candidates || []) {
  if (!["approved_restaurant_media", "directory_source_image"].includes(candidate?.sourceKind)) candidates.push(candidate);
}
for (const submission of ownerSubmissionPayload.submissions || []) {
  const restaurant = restaurantsById.get(submission.restaurantId);
  for (const image of submission.images || []) {
    const candidate = ownerSubmittedImageCandidate(submission, image, restaurant?.name || submission.name);
    if (candidate) candidates.push(candidate);
  }
}

if (fetchOfficialPages && pageLimit > 0) {
  const preFetchNormalized = candidates.map(normalizeCandidate).filter(Boolean);
  const preFetchApprovedRestaurantIds = new Set(preFetchNormalized.filter((candidate) => candidate.eligibleForProduction).map((candidate) => candidate.restaurantId));
  const preFetchCandidateRestaurantIds = new Set(preFetchNormalized.map((candidate) => candidate.restaurantId));
  const crawlTargets = restaurants.filter((restaurant) => {
    if (discoveryScope === "all") return true;
    if (discoveryScope === "missing_approved") return !preFetchApprovedRestaurantIds.has(restaurant.id);
    return !preFetchCandidateRestaurantIds.has(restaurant.id);
  });
  let fetched = 0;
  let probed = 0;
  for (const restaurant of crawlTargets) {
    if (fetched >= pageLimit) break;
    const firstPartyRecord = firstPartyById.get(restaurant.id) || {};
    const pages = officialSubpageUrls(restaurant, firstPartyRecord);
    if (!pages.length) failures.push({ restaurantId: restaurant.id, pageUrl: restaurant.website || firstPartyRecord.website || null, reason: "no_first_party_pages_for_thumbnail_discovery" });
    for (const pageUrl of pages) {
      if (fetched >= pageLimit) break;
      fetched += 1;
      try {
        const response = await fetch(pageUrl, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.4" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) { failures.push({ restaurantId: restaurant.id, pageUrl, reason: `http_${response.status}` }); continue; }
        const html = await response.text();
        const images = [...extractMetaImages(html, response.url || pageUrl), ...extractHtmlContentImages(html, response.url || pageUrl)];
        for (const image of images) {
          const candidate = pageCandidate(restaurant, response.url || pageUrl, image, firstPartyRecord);
          if (imageProbeEnabled && probed < imageProbeLimit && ["first_party_image_host", "approved_cdn_image_host", "remote_image_host_needs_source_check"].includes(candidate.sourceHostValidation)) {
            candidate.imageProbe = await probeImage(candidate);
            candidate.width = candidate.imageProbe?.width || candidate.width;
            candidate.height = candidate.imageProbe?.height || candidate.height;
            probed += 1;
          }
          candidates.push(candidate);
        }
      } catch (error) {
        failures.push({ restaurantId: restaurant.id, pageUrl, reason: error.name === "TimeoutError" ? "timeout" : error.message });
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
const normalized = candidates
  .map(normalizeCandidate)
  .filter(Boolean)
  .filter((candidate, index, all) => all.findIndex((item) => item.restaurantId === candidate.restaurantId && item.thumbnailUrl === candidate.thumbnailUrl && item.sourceKind === candidate.sourceKind) === index);

const approvedRestaurantIds = new Set(normalized.filter((candidate) => candidate.eligibleForProduction).map((candidate) => candidate.restaurantId));
const candidateRestaurantIds = new Set(normalized.map((candidate) => candidate.restaurantId));
const missingApproved = restaurants.filter((restaurant) => !approvedRestaurantIds.has(restaurant.id)).map((restaurant) => ({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website || null, neighborhood: restaurant.neighborhood || null }));
const missingAnyCandidate = restaurants.filter((restaurant) => !candidateRestaurantIds.has(restaurant.id)).map((restaurant) => ({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website || null, neighborhood: restaurant.neighborhood || null }));
const sourceKindCounts = {};
const reviewStateCounts = {};
for (const candidate of normalized) {
  sourceKindCounts[candidate.sourceKind] = (sourceKindCounts[candidate.sourceKind] || 0) + 1;
  reviewStateCounts[candidate.reviewState] = (reviewStateCounts[candidate.reviewState] || 0) + 1;
}

const output = {
  version: 1,
  generatedAt,
  fetchOfficialPages,
  pageLimit,
  pagesPerRestaurant,
  counts: {
    restaurants: restaurants.length,
    thumbnailCandidates: normalized.length,
    restaurantsWithApprovedThumbnail: approvedRestaurantIds.size,
    restaurantsWithAnyCandidate: candidateRestaurantIds.size,
    restaurantsMissingApprovedThumbnail: missingApproved.length,
    restaurantsMissingAnyCandidate: missingAnyCandidate.length,
    sourceKindCounts,
    reviewStateCounts,
    failures: failures.length + (existingThumbnailPayload.failures || []).length
  },
  candidates: normalized.sort((a, b) => Number(b.eligibleForProduction) - Number(a.eligibleForProduction) || (b.reviewPriority || 0) - (a.reviewPriority || 0) || a.restaurantName.localeCompare(b.restaurantName)),
  missingApproved,
  missingAnyCandidate,
  failures: [...(existingThumbnailPayload.failures || []), ...failures].slice(0, 200)
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputJsonPath, JSON.stringify(output, null, 2));
await writeFile(outputScriptPath, `window.HALIFAX_THUMBNAIL_CANDIDATES = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Thumbnail candidates: total=${normalized.length}, approved-restaurants=${approvedRestaurantIds.size}, any-candidate-restaurants=${candidateRestaurantIds.size}, missing-approved=${missingApproved.length}, missing-any=${missingAnyCandidate.length}, fetch=${fetchOfficialPages}.`);
