/**
 * The shared expiry window for event-scoped credentials: read tokens and
 * CloudFront-signed photo URLs both die when the competition is over. Photo
 * URLs are additionally capped at 12–18 h (`computePhotoUrlExpiry`).
 *
 * Expiry = end of the competition's `endDate` (UTC) + 1 day grace, capped at
 * 10 days from now (the same cap as the read token). After that moment the
 * overlay token stops verifying and every photo URL dies at the edge — the
 * "archived / no longer publicly available" state needs no cleanup job.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Grace period after the competition's end date. */
export const EVENT_GRACE_MS = 1 * DAY_MS;

/** Hard cap from "now", mirroring MAX_READ_TOKEN_TTL_SECONDS. */
export const EVENT_MAX_TTL_MS = 10 * DAY_MS;

/**
 * Epoch ms at which event-scoped credentials expire.
 * `endDateIso` is the competition's end date (YYYY-MM-DD, interpreted UTC).
 */
export const computeEventExpiry = (endDateIso: string, now: number): number => {
  const endOfEndDate = Date.parse(endDateIso) + DAY_MS; // midnight UTC after endDate
  if (Number.isNaN(endOfEndDate)) {
    throw new Error(`invalid endDate: ${endDateIso}`);
  }
  return Math.min(endOfEndDate + EVENT_GRACE_MS, now + EVENT_MAX_TTL_MS);
};

const PHOTO_URL_MIN_TTL_MS = 12 * HOUR_MS;
const PHOTO_URL_QUANTUM_MS = 6 * HOUR_MS;

/**
 * Epoch ms at which a signed photo URL expires: at least 12 h out, rounded up
 * to a 6 h UTC boundary so every read in the same window signs a byte-identical
 * URL (the browser and CloudFront cache keys stay stable), never past the
 * event window. Signed URLs can't be revoked, so they stay short; reads re-mint
 * them and the stream overlays refetch well inside the 12 h floor.
 */
export const computePhotoUrlExpiry = (endDateIso: string, now: number): number => {
  const quantised =
    Math.ceil((now + PHOTO_URL_MIN_TTL_MS) / PHOTO_URL_QUANTUM_MS) * PHOTO_URL_QUANTUM_MS;
  return Math.min(computeEventExpiry(endDateIso, now), quantised);
};
