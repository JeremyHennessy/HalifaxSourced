// Candidate extraction is not verification. Never infer event dates from post dates,
// resolve relative dates, assign dollar currency, or turn profile identity into venue identity.
const unique = values => [...new Set(values)].slice(0, 12);
const matches = (text, pattern) => unique([...text.matchAll(pattern)].map(match => match[0]));
export function extractSocialFactCandidate(text, context = {}) {
  const input = String(text || '').slice(0, 20000);
  const signals = context.signalMatches || {};
  const kinds = ['specials', 'events'].filter(kind => signals[kind]?.length);
  if (!kinds.length) return null;
  const dates = matches(input, /\b(?:20\d{2}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? \d{1,2}(?:st|nd|rd|th)?(?:,? 20\d{2})?)\b/gi);
  const times = matches(input, /\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s?(?:a\.?m\.?|p\.?m\.?)\b/gi);
  const prices = matches(input, /(?:\b(?:CAD|USD)\s*)?\$\s?(?:\d{1,3}(?:,\d{3}){1,2}|\d{1,9})(?:\.\d{1,2})?(?![\d.,])(?:\s*(?:CAD|USD))?/gi);
  const relativeDates = matches(input, /\b(?:today|tonight|tomorrow|this weekend|next week|every (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/gi);
  const conditions = [
    ['dine_in_only', /\bdine[ -]in only\b/i], ['while_supplies_last', /\bwhile supplies last\b/i],
    ['reservation_required', /\breservations? required\b/i], ['tax_extra', /\b(?:plus tax|tax(?:es)? extra)\b/i],
    ['age_restriction_19_plus', /\b19\s*\+/], ['limited_time', /\blimited time\b/i]
  ].filter(([, pattern]) => pattern.test(input)).map(([condition]) => condition);
  const status = /\bcancell?ed\b/i.test(input) ? 'possible_cancellation' : /\bpostponed\b/i.test(input) ? 'possible_postponement' : /\bsold out\b/i.test(input) ? 'possible_sold_out' : 'unverified';
  return {
    version: 1, kinds, sourceUrl: context.postUrl || null,
    sourceAuthority: 'official_profile_link_not_verified_claim',
    observedAt: context.observedAt || null, publishedAt: context.publishedAt || null,
    restaurantId: context.restaurantId || null,
    locationState: 'needs_exact_branch_review',
    dateMentions: dates, timeMentions: times, priceMentions: prices,
    relativeDateMentions: relativeDates, conditionSignals: conditions,
    currency: null, startsAt: null, endsAt: null, expiresAt: null,
    timezone: 'America/Halifax', timezoneBasis: 'target_region_not_source_confirmation',
    status, reviewState: 'needs_fact_review', publishable: false,
    mediaReuseAuthorized: false,
    reviewReasons: ['exact_branch_unconfirmed', 'dates_times_and_expiry_unconfirmed', 'price_currency_and_complete_terms_unconfirmed', 'source_cancellation_and_freshness_check_required']
  };
}
export function factOnlyPost(text, context) {
  const facts = extractSocialFactCandidate(text, context);
  const categories = Object.keys(context.signalMatches || {}).join(', ');
  return {
    title: `${context.platform === 'facebook' ? 'Facebook' : 'Instagram'} source lead`,
    summary: categories ? `Possible ${categories.replaceAll('_', ' ')} update. Check the original source for current details.` : 'Source update. Check the original source for details.',
    factCandidate: facts,
    contentPolicy: 'factual_candidates_no_caption_or_media',
    reviewState: 'needs_fact_review'
  };
}

export function validSocialReviewState(post) {
  if (post.reviewState === "api_observed") return true; // Historical snapshots.
  if (post.reviewState !== "needs_fact_review" || post.contentPolicy !== "factual_candidates_no_caption_or_media" || post.mediaUrl || post.thumbnailUrl) return false;
  if (!post.factCandidate) return true; // Non-deal/event source update.
  return post.factCandidate.publishable === false && post.factCandidate.mediaReuseAuthorized === false
    && post.factCandidate.reviewState === "needs_fact_review" && post.factCandidate.expiresAt === null;
}

