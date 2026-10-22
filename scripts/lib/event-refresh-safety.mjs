import { canonicalEventKey, preservePublishedEventIds, assertUniqueEventIds } from "./canonical-event-dedupe.mjs";

const DAY = 86400000;
const normalize = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cancelled = event => Boolean(event.cancelled || event.canceled || event.cancelledAt || event.canceledAt)
  || [event.eventStatus, event.status, event.reviewState].some(value => /cancelled|canceled|withdrawn|superseded/i.test(String(value || "")));

function timestamp(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== match.slice(1, 4).join("-")) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function url(value) {
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch { return null; }
}

function eventDates(event) {
  return { start: timestamp(event.startAt), end: timestamp(event.endAt || event.startAt) };
}

function hasEnded(event, end, now) {
  const endValue = String(event.endAt || event.startAt);
  if (/^\d{4}-\d{2}-\d{2}$/.test(endValue)) {
    // A date-only listing remains unexpired throughout its Halifax calendar
    // day. Do not treat its parsed UTC midnight as a precise ending time.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(now));
    const part = type => parts.find(item => item.type === type).value;
    return endValue < `${part("year")}-${part("month")}-${part("day")}`;
  }
  return end < now;
}

function sameListing(previous, current) {
  const previousUrl = url(previous.eventUrl);
  if (!previousUrl || previousUrl !== url(current.eventUrl)) return false;
  if (normalize(previous.title) !== normalize(current.title)) return false;
  if (previous.venueId && current.venueId && previous.venueId !== current.venueId) return false;
  if (previous.venueName && current.venueName && normalize(previous.venueName) !== normalize(current.venueName)) return false;
  const a = eventDates(previous), b = eventDates(current);
  if (a.start === null || a.end === null || b.start === null || b.end === null) return false;
  // Overlap can identify a corrected observation of an ongoing listing.
  // A separate same-day performance is not evidence of a replacement.
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Guard removals before publishing a refresh. This does not call a source or
 * manufacture a new observation of an old event.
 */
export function reconcileFutureEventLosses(current, previous, options = {}) {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("Invalid refresh guard clock");
  const recentStartCutoff = now - Number(options.pastGraceHours ?? 6) * 3600000;
  const maxTime = now + Number(options.futureDays ?? 400) * DAY;
  const previousEvents = previous.events || [];
  const currentEvents = preservePublishedEventIds(current.events || [], previousEvents);
  current = { ...current, events: currentEvents };
  const representedIds = new Set(currentEvents.flatMap(event => [
    event.id, ...(event.duplicateEventIds || []), ...(event.supersedesEventIds || [])
  ]).filter(Boolean));
  const canonicalKeys = new Set(currentEvents.map(canonicalEventKey).filter(Boolean));
  const sourceStats = new Map((current.sourceStats || []).map(stat => [stat.sourceId, stat]));
  const failureIds = new Set((current.failures || []).map(failure => failure.sourceId));
  const retained = [], heldRemovals = [], ignoredPrevious = [];
  const consideredIds = new Set();

  for (const event of previousEvents) {
    const details = { eventId: event.id || null, title: event.title || null, sourceId: event.sourceId || null, startAt: event.startAt || null, endAt: event.endAt || event.startAt || null, observedAt: event.observedAt || null };
    if (consideredIds.has(event.id)) continue;
    consideredIds.add(event.id);
    const key = canonicalEventKey(event);
    const listingMatches = currentEvents.filter(next => sameListing(event, next));
    const uniqueListingReplacement = listingMatches.length === 1
      && previousEvents.filter(prior => sameListing(prior, listingMatches[0])).length === 1;
    if (representedIds.has(event.id) || key && canonicalKeys.has(key) || uniqueListingReplacement) continue;
    if (cancelled(event)) {
      ignoredPrevious.push({ ...details, reason: "previous_event_cancelled_or_superseded" });
      continue;
    }
    const { start, end } = eventDates(event);
    const observed = timestamp(event.observedAt);
    if (!event.id || !event.title || !event.sourceId || !url(event.sourceUrl) || observed === null || observed > now
      || start === null || end === null || end < start) {
      ignoredPrevious.push({ ...details, reason: "invalid_previous_record" });
      continue;
    }
    // Dataset retention grace is not event expiry: an event that ended an
    // hour ago is no longer a future-event loss, even if still in the dataset.
    const expired = hasEnded(event, end, now);
    if (expired || start > maxTime) {
      ignoredPrevious.push({ ...details, reason: expired ? "expired_previous_event" : "outside_future_horizon" });
      continue;
    }
    const stat = sourceStats.get(event.sourceId);
    const failed = stat?.status === "failed" || (!stat && failureIds.has(event.sourceId));
    // Ongoing listings with an old start can contain mistaken, stretched end
    // dates. Hold for review instead of automatically reviving those records.
    if (start < recentStartCutoff) {
      heldRemovals.push({ ...details, reason: "missing_ongoing_event_requires_review", currentSourceStatus: stat?.status || "missing" });
      continue;
    }
    if (!failed) {
      heldRemovals.push({ ...details, reason: stat?.status === "ok" ? "successful_source_omitted_future_event" : "missing_or_uncertain_source_status", currentSourceStatus: stat?.status || "missing" });
      continue;
    }
    const failure = (current.failures || []).find(item => item.sourceId === event.sourceId);
    // Keep the complete accepted record and its observation/evidence dates.
    // The refresh attempt has separate metadata and never makes it look new.
    retained.push({
      ...event,
      refreshState: "retained_after_source_failure",
      retainedAt: event.retainedAt || new Date(now).toISOString(),
      sourceFailure: {
        sourceId: event.sourceId,
        reason: stat?.reason || failure?.reason || "source_failed",
        attemptedAt: stat?.observedAt || failure?.observedAt || null,
        previousGeneratedAt: previous.generatedAt || null
      }
    });
  }

  const retainedBySource = new Map();
  for (const event of retained) retainedBySource.set(event.sourceId, (retainedBySource.get(event.sourceId) || 0) + 1);
  const events = [...currentEvents, ...retained];
  assertUniqueEventIds(events);
  return {
    payload: {
      ...current,
      events,
      eventCount: events.length,
      sourceStats: (current.sourceStats || []).map(stat => retainedBySource.has(stat.sourceId)
        ? { ...stat, retainedEventCount: retainedBySource.get(stat.sourceId) }
        : stat)
    },
    retained,
    heldRemovals,
    ignoredPrevious,
    blocked: heldRemovals.length > 0
  };
}
