// Reviewed occurrence-specific locations override the organizing branch, never identity.
export function reviewedEventLocation(event, corrections) {
  if (!["official_library_location_calendar", "public_library_calendar"].includes(event.sourceKind)) return null;
  return corrections.find(item => item.eventUrl === event.eventUrl
    && item.startAt === event.startAt && item.endAt === event.endAt) || null;
}

export function applyReviewedEventLocation(event, corrections) {
  const correction = reviewedEventLocation(event, corrections);
  if (!correction) return false;
  for (const key of ['venueName', 'address', 'city']) event[key] = correction[key];
  // A library's pin is not evidence for its off-site event. Do not invent a pin.
  for (const key of ['latitude', 'longitude', 'venueId', 'neighbourhood', 'restaurantId']) delete event[key];
  event.locationReview = {
    sourceUrl: correction.sourceUrl,
    reviewedAt: correction.reviewedAt,
    coordinateStatus: 'unverified_non_branch_location'
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
    && event.locationReview?.coordinateStatus === 'unverified_non_branch_location';
}

export function validEventCoordinates(event) {
  return typeof event.latitude === 'number' && Number.isFinite(event.latitude) && Math.abs(event.latitude) <= 90
    && typeof event.longitude === 'number' && Number.isFinite(event.longitude) && Math.abs(event.longitude) <= 180;
}
