// Offline review-only schema. Never import this backlog into a collector.
// A new interface or admission requires reviewed evidence and a separate change,
// not flipping enabled or supplying an inferred feed URL here.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const privateText = /(?:^|[\s"'`])\/(?:tmp|workspace|home)\/|\bturn\d+(?:view|search|fetch)\d+\b/i;
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000 && !/[\x00-\x1f]/.test(value) && !privateText.test(value);
const fail = message => { throw new Error(`Source onboarding backlog: ${message}`); };
function keys(value, expected, context) {
  if (!object(value) || Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value))) fail(`${context} has unexpected or missing fields`);
}
function strings(value, fields, context) {
  for (const key of fields) if (!text(value[key])) fail(`${context}.${key} must be sanitized nonempty text`);
}
function url(value, context, optional = false) {
  if (optional && value === null) return;
  try {
    const parsed = new URL(value);
    if (!text(value) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || [...parsed.searchParams.keys()].some(key => !['region','locations','ical','page','tribe-bar-date'].includes(key))) throw new Error();
  } catch { fail(`${context} must be a public HTTPS URL without credentials or private parameters`); }
}
function list(value, context) { if (!Array.isArray(value)) fail(`${context} must be an array`); }
export function validateOnboardingBacklog(payload) {
  keys(payload,['version','enabled','status','reviewedOn','scope','formatPolicy','candidates','holds','existingSources'],'registry');
  if (payload.version !== 1 || payload.enabled !== false || payload.status !== 'disabled_review_required') fail('registry must remain disabled and review-required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.reviewedOn)) fail('reviewedOn must be a review date, not an attempt clock');
  strings(payload,['scope','formatPolicy'],'registry');
  for (const key of ['candidates','holds','existingSources']) list(payload[key],key);
  const ids = new Set(), ranks = new Set();
  function identity(row) {
    if (typeof row.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id || '') || ids.has(row.id)) fail('IDs must be unique stable slugs');
    ids.add(row.id);
    if (row.enabled !== false) fail(`${row.id} must remain disabled`);
  }
  const distinctions = new Set(['new_direct_source_candidate','direct_source_upgrade_existing_tourism_event','direct_source_upgrade_existing_organizer_events','direct_source_upgrade_existing_two_tourism_events','direct_news_upgrade_existing_restaurant_evidence','automated_interface_upgrade_existing_manual_news']);
  for (const row of payload.candidates) {
    keys(row,['id','name','url','enabled','status','priority','rank','interface','geography','categories','distinction','existingRepresentation','format','evidence','additionalOfficialUrls','accessLimitations','rightsLimitations','nextSafeAction'],'candidate');
    identity(row); url(row.url,`${row.id}.url`);
    if (row.status !== 'disabled_review_required' || ![1,2,3].includes(row.priority) || !distinctions.has(row.distinction)) fail(`${row.id} has invalid review status, priority or distinction`);
    if (row.rank !== null) {
      if (!Number.isInteger(row.rank) || row.rank < 1 || ranks.has(row.rank)) fail('ranks must be unique positive integers or null');
      ranks.add(row.rank);
    }
    strings(row,['name','interface','geography','existingRepresentation','accessLimitations','rightsLimitations','nextSafeAction'],row.id);
    list(row.categories,`${row.id}.categories`);
    if (!row.categories.length || row.categories.some(category => !text(category))) fail(`${row.id} must describe categories`);
    keys(row.format,['observed','rss','ical','api','jsonLd'],`${row.id}.format`);
    strings(row.format,['observed'],`${row.id}.format`);
    for (const key of ['rss','ical','api','jsonLd']) if (row.format[key] !== null) fail(`${row.id}: unverified ${key} must remain null; do not invent feeds`);
    list(row.evidence,`${row.id}.evidence`); list(row.additionalOfficialUrls,`${row.id}.additionalOfficialUrls`);
    if (!row.evidence.length) fail(`${row.id} needs a factual observation`);
    for (const item of row.evidence) { keys(item,['url','observation'],'evidence'); url(item.url,'evidence.url'); strings(item,['observation'],'evidence'); }
    for (const item of row.additionalOfficialUrls) { keys(item,['url','verification'],'additionalOfficialUrls'); url(item.url,'additionalOfficialUrls.url'); strings(item,['verification'],'additionalOfficialUrls'); }
  }
  const reasons = new Set(['robots_denial','http_403','permission_hold','uncertain_transport_timeout']);
  for (const row of payload.holds) {
    keys(row,['id','name','url','enabled','status','holdReason','evidence','nextSafeAction'],'hold');
    identity(row); url(row.url,`${row.id}.url`,true);
    if (row.status !== 'mandatory_hold' || !reasons.has(row.holdReason)) fail(`${row.id} has an invalid mandatory hold`);
    strings(row,['name','evidence','nextSafeAction'],row.id);
  }
  for (const row of payload.existingSources) {
    keys(row,['name','url','distinction','evidence','nextSafeAction'],'existing source');
    url(row.url,'existing source.url'); strings(row,['name','distinction','evidence','nextSafeAction'],'existing source');
  }
  return payload;
}
