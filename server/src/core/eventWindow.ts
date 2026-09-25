/**
 * The shared expiry window for event-scoped credentials: read tokens and
 * CloudFront-signed photo URLs both die when the competition is over.
 *
 * Expiry = end of the competition's `endDate` (UTC) + 1 day grace, capped at
 * 10 days from now (the same cap as the read token). After that moment the
 * overlay token stops verifying and every photo URL dies at the edge — the
 * "archived / no longer publicly available" state needs no cleanup job.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

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
