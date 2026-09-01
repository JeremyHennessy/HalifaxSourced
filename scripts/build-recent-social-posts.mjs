import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const outputJsonPath = new URL("../data/build/recent-social-posts.json", import.meta.url);
const outputScriptPath = new URL("../data/recent-social-posts.js", import.meta.url);
const lookbackDays = Number(process.env.RECENT_POST_LOOKBACK_DAYS ?? 180);
const summaryLimit = Math.max(120, Math.min(700, Number(process.env.RECENT_POST_SUMMARY_CHARS ?? 420)));
const generatedAt = new Date().toISOString();
const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

const taxonomy = {
  happy_hour: {
    label: "Happy hour",
    priority: 98,
    terms: ["happy hour", "buck a shuck", "oyster hour", "half price", "drink special", "cocktail special"]
  },
  specials: {
    label: "Special",
    priority: 95,
    terms: ["special", "specials", "daily feature", "feature menu", "deal", "deals", "offer", "offers", "promo", "promotion", "2 for 1", "two for one", "prix fixe", "under $", "$", "limited time"]
  },
  events: {
    label: "Event",
    priority: 90,
    terms: ["event", "events", "ticket", "tickets", "launch party", "party", "tasting", "dinner series", "pop-up", "popup", "collab", "guest chef", "market", "festival"]
  },
  live_music: {
    label: "Live music",
    priority: 88,
    terms: ["live music", "dj", "karaoke", "show", "concert", "acoustic", "vinyl night", "open mic", "band", "trivia"]
  },
  openings: {
    label: "Opening",
    priority: 84,
    terms: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened", "reopening"]
  },
  menu: {
    label: "Menu update",
    priority: 74,
    terms: ["menu", "new dish", "seasonal menu", "tasting menu", "new item", "feature dish", "chef special", "brunch menu", "dinner menu", "lunch menu"]
  },
  patio: {
    label: "Patio",
    priority: 70,
    terms: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk seating"]
  },
  brunch: {
    label: "Brunch",
    priority: 68,
    terms: ["brunch", "breakfast", "eggs benny", "mimosa", "caesar bar"]
  },
  seasonal: {
    label: "Seasonal",
    priority: 58,
    terms: ["seasonal", "summer", "fall menu", "winter menu", "spring menu", "holiday", "valentine", "mother's day", "new year's", "christmas"]
  },
  reservations: {
    label: "Reservations",
    priority: 42,
    terms: ["reservation", "reservations", "book now", "book a table", "tables available", "walk-ins"]
  }
};
const signalToCategory = {
  specials: "specials",
  events: "events",
  openings: "openings",
  brunch: "brunch",
  menu: "menu",
  patio: "patio"
};

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

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function cleanText(value, limit = summaryLimit) {
  const text = String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[#@][\w.-]+/g, (token) => token.length > 36 ? " " : token)
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}

function titleFromPost(post, platformLabel) {
  return cleanText(post.title || post.summary || post.excerpt || `${platformLabel} update`, 150) || `${platformLabel} update`;
}

function hashId(parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|"), "utf8").digest("hex").slice(0, 18);
}

function categoryHits(text, signalMatches = {}) {
  const haystack = String(text ?? "").toLowerCase();
  const hits = new Map();

  for (const [signalKind, signalTerms] of Object.entries(signalMatches || {})) {
    const mapped = signalToCategory[signalKind] || signalKind;
    if (!taxonomy[mapped]) continue;
    const terms = Array.isArray(signalTerms) ? signalTerms.map(String).filter(Boolean) : [];
    hits.set(mapped, new Set([...(hits.get(mapped) || []), ...terms]));
  }

  for (const [category, config] of Object.entries(taxonomy)) {
    const matchedTerms = config.terms.filter((term) => haystack.includes(term));
    if (matchedTerms.length) hits.set(category, new Set([...(hits.get(category) || []), ...matchedTerms]));
  }

  return [...hits.entries()]
    .map(([id, terms]) => ({ id, label: taxonomy[id]?.label || id, terms: [...terms].slice(0, 12), priority: taxonomy[id]?.priority ?? 0 }))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}

function platformLabel(platform) {
  const labels = { website_feed: "Official website", official_page: "Official page", public_source: "Public source", facebook: "Facebook", instagram: "Instagram" };
  return labels[String(platform || "").toLowerCase()] || "Official update";
}

function recencyState(publishedAt) {
  const stamp = Date.parse(String(publishedAt ?? ""));
  if (!Number.isFinite(stamp)) return { ageDays: null, isRecent: false };
  const ageDays = Math.max(0, Math.round((Date.now() - stamp) / (24 * 60 * 60 * 1000)));
  return { ageDays, isRecent: stamp >= cutoff };
}

function normalizePost(post, sourceFamily) {
  const platform = String(post.platform || (sourceFamily === "feed" ? "website_feed" : "social")).toLowerCase();
  const label = platformLabel(platform);
  const title = titleFromPost(post, label);
  const summarySource = post.summary || post.excerpt || post.title || "";
  const summary = cleanText(summarySource, summaryLimit) || title;
  const categories = categoryHits(`${title} ${summary}`, post.signalMatches);
  const primary = categories[0] || { id: "general_update", label: "General update", terms: [], priority: 0 };
  const postUrl = validUrl(post.postUrl);
  const profileUrl = validUrl(post.profileUrl);
  const feedUrl = validUrl(post.feedUrl);
  const mediaUrl = validUrl(post.mediaUrl);
  const thumbnailUrl = validUrl(post.thumbnailUrl);
  const { ageDays, isRecent } = recencyState(post.publishedAt);
  const sourceIdentifier = post.postId || post.platformObjectId || postUrl || title;
  const reviewState = post.reviewState === "needs_date_review" || !post.publishedAt
    ? "needs_date_review"
    : primary.id === "general_update"
      ? "needs_category_review"
      : (post.reviewState || "source_signal");
  const confidenceScore = post.sourceKind?.startsWith("meta_graph_api") ? 0.9 : post.sourceKind === "official_feed" ? 0.84 : post.sourceKind === "official_page_html" ? 0.78 : 0.7;

  if (!post.restaurantId || !postUrl) return null;
  return {
    id: `${platform}-${hashId([post.restaurantId, platform, sourceIdentifier])}`,
    restaurantId: post.restaurantId,
    restaurantName: post.restaurantName || "Unknown restaurant",
    platform,
    sourceFamily,
    sourceLabel: label,
    sourceKind: post.sourceKind || (sourceFamily === "feed" ? "official_feed" : "unknown_social_source"),
    postId: post.postId || null,
    platformObjectId: post.platformObjectId || null,
    profileHandle: post.profileHandle || null,
    profileUrl,
    feedUrl,
    postUrl,
    mediaUrl,
    thumbnailUrl,
    mediaType: post.mediaType || null,
    title,
    summary,
    primaryCategory: primary.id,
    primaryCategoryLabel: primary.label,
    categories: categories.map(({ id, label, terms }) => ({ id, label, terms })),
    matchedTerms: [...new Set(categories.flatMap((category) => category.terms))].slice(0, 30),
    publishedAt: post.publishedAt || null,
    observedAt: post.observedAt || generatedAt,
    ageDays,
    isRecent,
    lookbackDays,
    confidenceScore,
    confidence: post.confidence || (sourceFamily === "feed" || sourceFamily === "website_page" ? "official_source_signal" : "official_social_api_signal"),
    reviewState,
    associationBasis: post.associationBasis || null
  };
}

function normalizePublicSpecialLead(lead) {
  const title = cleanText(lead.title || lead.dealType || "Public special", 150);
  const priceValue = Number(lead.price);
  const price = Number.isFinite(priceValue) && priceValue > 0 ? `$${priceValue} CAD` : null;
  const timing = lead.recurrence || (lead.startTime && lead.endTime ? `${lead.startTime}-${lead.endTime}` : null);
  const summary = [lead.description, price ? `Price from ${price}.` : null, timing || null].filter(Boolean).join(" ");
  const category = lead.specialType === "happy_hour" ? "happy_hour" : "specials";
  return normalizePost({
    restaurantId: lead.restaurantId,
    restaurantName: lead.venueName,
    platform: "public_source",
    postUrl: lead.sourceUrl,
    mediaUrl: lead.sourceImageUrl,
    thumbnailUrl: lead.sourceImageUrl,
    title,
    summary,
    publishedAt: lead.validFrom || lead.sourceUpdatedAt || lead.observedAt,
    observedAt: lead.observedAt,
    sourceKind: lead.sourceKind,
    confidence: "matched_public_directory_signal",
    reviewState: "source_signal",
    associationBasis: lead.matchMethod || null,
    signalMatches: {
      [category]: [lead.dealType, lead.specialType].filter(Boolean)
    }
  }, "public_directory");
}

const feedPayload = await loadJson("../data/build/website-feed-signals.json", null)
  || await loadWindowScript("data/website-feed-signals.js", "HALIFAX_WEBSITE_FEED_SIGNALS", { posts: [], signals: [] });
const websitePagePayload = await loadJson("../data/build/website-page-intelligence.json", null)
  || await loadWindowScript("data/website-page-intelligence.js", "HALIFAX_WEBSITE_PAGE_INTELLIGENCE", { records: [], signals: [] });
const socialPayload = await loadJson("../data/build/social-signals.json", null)
  || await loadWindowScript("data/social-signals.js", "HALIFAX_SOCIAL_SIGNALS", { posts: [], signals: [] });
const publicSpecialPayload = await loadJson("../data/build/public-special-source-leads.json", null)
  || await loadWindowScript("data/public-special-source-leads.js", "HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS", { records: [] });

const feedPosts = Array.isArray(feedPayload.posts) ? feedPayload.posts : (Array.isArray(feedPayload.signals) ? feedPayload.signals : []);
const websitePagePosts = Array.isArray(websitePagePayload.records) ? websitePagePayload.records : (Array.isArray(websitePagePayload.signals) ? websitePagePayload.signals : []);
const socialPosts = Array.isArray(socialPayload.posts) ? socialPayload.posts : (Array.isArray(socialPayload.signals) ? socialPayload.signals : []);
const publicSpecialPosts = Array.isArray(publicSpecialPayload.records) ? publicSpecialPayload.records.filter((lead) => lead.restaurantId) : [];
const records = [
  ...feedPosts.map((post) => normalizePost(post, "feed")),
  ...websitePagePosts.map((post) => normalizePost(post, "website_page")),
  ...socialPosts.map((post) => normalizePost(post, "social_api")),
  ...publicSpecialPosts.map(normalizePublicSpecialLead)
].filter(Boolean)
  .filter((post) => post.isRecent || post.reviewState === "needs_date_review")
  .filter((post, index, all) => all.findIndex((item) => item.restaurantId === post.restaurantId && item.platform === post.platform && item.postUrl === post.postUrl) === index)
  .sort((a, b) => String(b.publishedAt || b.observedAt).localeCompare(String(a.publishedAt || a.observedAt)));

const categoryCounts = {};
const restaurantCounts = {};
const platformCounts = {};
const reviewStateCounts = {};
for (const record of records) {
  categoryCounts[record.primaryCategory] = (categoryCounts[record.primaryCategory] || 0) + 1;
  restaurantCounts[record.restaurantId] = (restaurantCounts[record.restaurantId] || 0) + 1;
  platformCounts[record.platform] = (platformCounts[record.platform] || 0) + 1;
  reviewStateCounts[record.reviewState] = (reviewStateCounts[record.reviewState] || 0) + 1;
}

const output = {
  version: 1,
  generatedAt,
  lookbackDays,
  summaryLimit,
  inputCounts: {
    websiteFeedPosts: feedPosts.length,
    websitePagePosts: websitePagePosts.length,
    socialApiPosts: socialPosts.length,
    publicSpecialPosts: publicSpecialPosts.length,
    websiteFeedSignals: Array.isArray(feedPayload.signals) ? feedPayload.signals.length : 0,
    websitePageSignals: Array.isArray(websitePagePayload.signals) ? websitePagePayload.signals.length : 0,
    socialApiSignals: Array.isArray(socialPayload.signals) ? socialPayload.signals.length : 0
  },
  sourceState: {
    websiteFeedsGeneratedAt: feedPayload.generatedAt || null,
    websitePagesGeneratedAt: websitePagePayload.generatedAt || null,
    metaSocialGeneratedAt: socialPayload.generatedAt || null,
    metaCredentialState: socialPayload.credentialState || null,
    metaProfilesAttempted: socialPayload.profilesAttempted ?? null,
    metaPostsObserved: socialPayload.postsObserved ?? null,
    publicSpecialSourceGeneratedAt: publicSpecialPayload.generatedAt || null,
    publicSpecialSourceRecords: Array.isArray(publicSpecialPayload.records) ? publicSpecialPayload.records.length : 0
  },
  counts: {
    records: records.length,
    restaurantsWithRecentPosts: Object.keys(restaurantCounts).length,
    categoryCounts,
    platformCounts,
    reviewStateCounts
  },
  records
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputJsonPath, JSON.stringify(output, null, 2));
await writeFile(outputScriptPath, `window.HALIFAX_RECENT_SOCIAL_POSTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Recent post intelligence: records=${records.length}, restaurants=${output.counts.restaurantsWithRecentPosts}, platforms=${JSON.stringify(platformCounts)}, categories=${JSON.stringify(categoryCounts)}.`);
