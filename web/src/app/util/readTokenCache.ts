import type { ReadTokenResponse } from 'app/api/readTokens';

/**
 * Per-competition localStorage cache for the `/admin/overlays` read token.
 *
 * Minting is not free: every regenerate is a fresh credential, and an overlay
 * URL already pasted into OBS keeps working only until the operator mints a
 * *new* token for the same competition. So the admin page reuses the last token
 * across visits instead of minting one each time — but only through the FIRST
 * HALF of the token's lifetime, so whatever overlay picks the cached token up
 * still has at least half the validity window left before it must be refreshed.
 * Past the halfway mark the cache reads as absent and a fresh token is minted.
 *
 * Only the token response is persisted; the overlay URLs are pure functions of
 * it plus the compId, so there is nothing else worth storing.
 */

interface CachedReadToken extends ReadTokenResponse {
  /** Epoch ms the token was cached — the start of its usable half-life window. */
  storedAt: number;
}

const storageKey = (compId: string) => `speedline.overlayReadToken.${compId}`;

/** localStorage can throw (privacy mode / disabled storage) — degrade to no cache. */
const store = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The cached token IFF still inside the first half of its lifetime, else null. */
export const readCachedReadToken = (compId: string, now: number): ReadTokenResponse | null => {
  const raw = store()?.getItem(storageKey(compId));
  if (!raw) return null;
  try {
    const { token, expiresAt, storedAt } = JSON.parse(raw) as CachedReadToken;
    const midpoint = storedAt + (expiresAt - storedAt) / 2;
    return now < midpoint ? { token, expiresAt } : null;
  } catch {
    return null; // Malformed entry — treat as no cache.
  }
};

export const writeCachedReadToken = (
  compId: string,
  response: ReadTokenResponse,
  now: number,
): void => {
  store()?.setItem(storageKey(compId), JSON.stringify({ ...response, storedAt: now }));
};

export const clearCachedReadToken = (compId: string): void => {
  store()?.removeItem(storageKey(compId));
};
