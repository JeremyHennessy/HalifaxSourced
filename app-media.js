"use strict";

// Restaurant imagery is intentionally opt-in. A URL alone is not enough: the
// record must carry explicit rights/source metadata before the UI will render it.
const PERMITTED_IMAGE_SOURCE_TYPES = new Set([
  "owner",
  "owner_submission",
  "restaurant_owner",
  "first_party",
  "official_site_permitted",
  "licensed"
]);

function normalizeImageSourceType(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeImageUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw.startsWith("./") ? raw : `./${raw}`;
  return safeUrl(raw);
}

function permittedImageFor(restaurant) {
  const candidates = [];
  if (restaurant?.image && typeof restaurant.image === "object") candidates.push(restaurant.image);
  if (Array.isArray(restaurant?.images)) candidates.push(...restaurant.images.filter((image) => image && typeof image === "object"));

  for (const image of candidates) {
    const sourceType = normalizeImageSourceType(image.sourceType ?? image.sourceKind ?? image.source ?? image.permissionSource);
    const permission = normalizeImageSourceType(image.permission ?? image.usageRights ?? image.rights);
    const explicitlyPermitted = image.permitted === true || image.ownerApproved === true || permission === "permitted" || permission === "owner_approved";
    if (!explicitlyPermitted && !PERMITTED_IMAGE_SOURCE_TYPES.has(sourceType)) continue;

    const url = safeImageUrl(image.url ?? image.src);
    if (!url) continue;
    return {
      url,
      alt: String(image.alt ?? restaurant?.name ?? "Restaurant image"),
      sourceType: sourceType || permission || "permitted"
    };
  }
  return null;
}

function mediaImageMarkup(restaurant, options = {}) {
  const image = permittedImageFor(restaurant);
  if (!image) return "";
  const loading = options.loading === "eager" ? "eager" : "lazy";
  const className = options.className || "media-photo";
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(image.url)}" alt="${escapeHtml(options.alt ?? image.alt)}" loading="${loading}" decoding="async" />`;
}

function permittedImageClass(restaurant) {
  return permittedImageFor(restaurant) ? " has-permitted-image" : "";
}
