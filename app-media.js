"use strict";

// Restaurant imagery is opt-in and provenance-gated. Public accessibility is
// not permission. The UI renders only media that has an approved review state,
// an allowed source type, explicit permission confirmation, and a rights basis.
const PERMITTED_IMAGE_SOURCE_TYPES = new Set([
  "owner",
  "owner_submission",
  "restaurant_owner_submission",
  "restaurant_owner",
  "first_party",
  "official_site_permitted",
  "licensed"
]);

const PERMITTED_IMAGE_PERMISSION_VALUES = new Set([
  "permitted",
  "owner_approved",
  "written_permission",
  "owner_submitted",
  "licensed"
]);

function normalizeImageToken(value) {
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

function mediaManifestCandidates(restaurant) {
  const payload = window.HALIFAX_RESTAURANT_MEDIA ?? null;
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.filter((image) => image?.restaurantId === restaurant?.id);
}

function imageCandidates(restaurant) {
  const candidates = [...mediaManifestCandidates(restaurant)];
  if (restaurant?.image && typeof restaurant.image === "object") candidates.push(restaurant.image);
  if (Array.isArray(restaurant?.images)) candidates.push(...restaurant.images.filter((image) => image && typeof image === "object"));
  return candidates;
}

function permittedImageFor(restaurant) {
  for (const image of imageCandidates(restaurant)) {
    if (!hasMediaPermission(image)) continue;
    const sourceType = normalizeImageToken(image.sourceType ?? image.sourceKind ?? image.source ?? image.permissionSource);
    const permission = normalizeImageToken(image.permission ?? image.usageRights ?? image.rights);
    const reviewState = normalizeImageToken(image.reviewState ?? image.reviewStatus);
    const rightsBasis = String(image.rightsBasis ?? image.rightsNote ?? "").trim();
    const creator = String(image.creator ?? "").trim();
    const license = String(image.license ?? image.licence ?? "").trim();
    const permissionConfirmed = image.permissionConfirmed === true || image.ownerApproved === true;

    if (reviewState !== "approved") continue;
    if (!PERMITTED_IMAGE_SOURCE_TYPES.has(sourceType)) continue;
    if (!PERMITTED_IMAGE_PERMISSION_VALUES.has(permission)) continue;
    if (!permissionConfirmed || !rightsBasis || !creator || !license) continue;

    const url = safeImageUrl(image.url ?? image.src);
    const sourceUrl = safeUrl(image.sourceUrl ?? image.provenanceUrl ?? image.pageUrl);
    if (!url || !sourceUrl) continue;

    return {
      url,
      alt: String(image.alt ?? restaurant?.name ?? "Restaurant image"),
      sourceType,
      sourceUrl,
      rightsBasis,
      creator,
      license,
      attribution: String(image.attribution ?? "").trim() || null
    };
  }
  return null;
}

// A public source reference documents a fact, not an image licence. Denials and
// uncertain rights take precedence over legacy approval flags.
function hasMediaPermission(image) {
  if (!image || typeof image !== "object") return false;
  const state = normalizeImageToken(image.rightsState);
  if (state && !["licensed", "owner_authorized", "permission_verified"].includes(state)) return false;
  const license = String(image.license ?? image.licence ?? "").trim();
  const basis = String(image.rightsBasis ?? image.rightsNote ?? "").trim();
  if (["unknown", "unverified", "restricted", "public_reference_not_media_licence"].includes(normalizeImageToken(license))) return false;
  if (/first-party official site media/i.test(license) || /remote thumbnail reference only|not rehosted/i.test(basis)) return false;
  return normalizeImageToken(image.reviewState ?? image.reviewStatus) === "approved"
    && PERMITTED_IMAGE_SOURCE_TYPES.has(normalizeImageToken(image.sourceType ?? image.permissionSource))
    && PERMITTED_IMAGE_PERMISSION_VALUES.has(normalizeImageToken(image.permission ?? image.usageRights ?? image.rights))
    && (image.permissionConfirmed === true || image.ownerApproved === true)
    && Boolean(license && basis && String(image.creator ?? "").trim())
    && Boolean(safeUrl(image.sourceUrl ?? image.provenanceUrl ?? image.pageUrl ?? image.postUrl));
}

function permittedPostMediaUrl(post) {
  return hasMediaPermission(post) ? safeImageUrl(post.mediaUrl || post.thumbnailUrl) : null;
}

function mediaImageMarkup(restaurant, options = {}) {
  const image = permittedImageFor(restaurant);
  if (!image) return "";
  const loading = options.loading === "eager" ? "eager" : "lazy";
  const className = options.className || "media-photo";
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(image.url)}" alt="${escapeHtml(options.alt ?? image.alt)}" loading="${loading}" decoding="async" data-media-source="${escapeHtml(image.sourceType)}" onerror="this.parentElement?.querySelector('.media-attribution')?.remove();this.closest('.has-permitted-image')?.classList.remove('has-permitted-image');this.remove()" />`;
}

function mediaAttributionMarkup(restaurant) {
  const image = permittedImageFor(restaurant);
  if (!image?.sourceUrl || !image.attribution) return "";
  return `<a class="media-attribution" href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noreferrer">Photo: ${escapeHtml(image.attribution)} ↗</a>`;
}

function permittedImageClass(restaurant) {
  return permittedImageFor(restaurant) ? " has-permitted-image" : "";
}
