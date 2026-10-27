// Reviewed occurrence-specific locations override the organizing venue, never identity.
function matchesReviewedSource(event, correction) {
  if (["official_library_location_calendar", "public_library_calendar"].includes(event.sourceKind)) {
    // Existing unscoped corrections remain library-only. An explicitly scoped
    // venue correction must never leak into a library import of the same URL.
    return correction.sourceKind === undefined && correction.sourceId === undefined;
  }
  // Only this reviewed official venue source is admitted. Both scope fields are
  // mandatory; a URL or title alone is not evidence of a reviewed occurrence.
  return event.sourceKind === "official_venue_calendar" && event.sourceId === "the-carleton"
    && correction.sourceKind === event.sourceKind && correction.sourceId === event.sourceId;
}

function coordinateStatus(correction) {
  return correction.sourceKind === "official_venue_calendar"
    ? 'unverified_offsite_venue_location' : 'unverified_non_branch_location';
}

export function reviewedEventLocation(event, corrections) {
  return corrections.find(item => matchesReviewedSource(event, item)
    && item.eventUrl === event.eventUrl
    && item.startAt === event.startAt && item.endAt === event.endAt) || null;
}

export function applyReviewedEventLocation(event, corrections) {
  const correction = reviewedEventLocation(event, corrections);
  if (!correction) return false;
  for (const key of ['venueName', 'address', 'city']) event[key] = correction[key];
  // An organizer's pin is not evidence for its off-site event. Do not invent a pin.
  for (const key of ['latitude', 'longitude', 'venueId', 'neighbourhood', 'restaurantId']) delete event[key];
  event.locationReview = {
    sourceUrl: correction.sourceUrl,
    reviewedAt: correction.reviewedAt,
    coordinateStatus: coordinateStatus(correction)
  };
  return true;
}

export function isReviewedUnpinnedLocation(event, corrections) {
  const correction = reviewedEventLocation(event, corrections);
  return !!correction
    && ['venueName', 'address', 'city'].every(key => event[key] === correction[key])
    && ['latitude', 'longitude', 'venueId', 'neighbourhood', 'restaurantId'].every(key => !Object.hasOwn(event, key))
    && event.locationReview?.sourceUrl === correction.sourceUrl
    && event.locationReview?.reviewedAt === correction.reviewedAt
    && event.locationReview?.coordinateStatus === coordinateStatus(correction);
}

export function validEventCoordinates(event) {
  return typeof event.latitude === 'number' && Number.isFinite(event.latitude) && Math.abs(event.latitude) <= 90
    && typeof event.longitude === 'number' && Number.isFinite(event.longitude) && Math.abs(event.longitude) <= 180;
}
