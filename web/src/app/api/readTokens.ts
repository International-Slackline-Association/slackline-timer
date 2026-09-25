import { useEffect, useState } from 'react';

import { useMutation } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import {
  clearCachedReadToken,
  readCachedReadToken,
  writeCachedReadToken,
} from 'app/util/readTokenCache';

/**
 * Read-token mutations (admin only). A read token is the credential OBS/H2R
 * overlays carry in their `/stream/*` URL — read-only, competition-scoped,
 * expiring with the event. Revoking bumps the competition's tokenVersion, which
 * invalidates every outstanding token at once. See server/src/core/readToken.ts.
 */

export interface ReadTokenResponse {
  token: string;
  /** Epoch milliseconds the token (and the overlay URLs) stop working. */
  expiresAt: number;
}

export const useCreateReadToken = (compId: string) =>
  useMutation({
    mutationFn: () =>
      apiFetch<ReadTokenResponse>(`/competitions/${compId}/read-tokens`, { method: 'POST' }),
  });

export const useRevokeReadTokens = (compId: string) =>
  useMutation({
    mutationFn: () =>
      apiFetch<{ revoked: boolean }>(`/competitions/${compId}/revoke-read-tokens`, {
        method: 'POST',
      }),
  });

/**
 * The read token backing the overlay links, reused from localStorage across
 * visits (see readTokenCache) so revisiting `/admin/overlays` doesn't churn a
 * fresh credential and break already-pasted OBS URLs. `token`/`expiresAt` come
 * from the cache on mount (null once past the token's half-life), `generate`
 * mints + caches a new one, and `clear` drops the cache — call it on revoke,
 * since the bumped tokenVersion has killed the stored token server-side.
 */
export const usePersistentReadToken = (compId: string) => {
  const create = useCreateReadToken(compId);
  const [cached, setCached] = useState<ReadTokenResponse | null>(() =>
    readCachedReadToken(compId, Date.now()),
  );

  useEffect(() => setCached(readCachedReadToken(compId, Date.now())), [compId]);

  const generate = () =>
    create.mutate(undefined, {
      onSuccess: (response) => {
        writeCachedReadToken(compId, response, Date.now());
        setCached(response);
      },
    });

  const clear = () => {
    clearCachedReadToken(compId);
    setCached(null);
  };

  return {
    token: cached?.token,
    expiresAt: cached?.expiresAt,
    generate,
    clear,
    isPending: create.isPending,
    isError: create.isError,
    error: create.error,
  };
};
