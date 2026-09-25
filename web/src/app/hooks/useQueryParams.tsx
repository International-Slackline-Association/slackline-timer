import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const parseInt10 = (value: string | null): number | undefined => {
  if (value === null) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
};

/**
 * Query params derived straight from `location.search`. Deriving (not mirroring
 * into state) means a removed param clears instead of sticking, and a `0` margin
 * survives rather than being dropped by a falsy guard.
 */
export const useQueryParams = () => {
  const { search } = useLocation();

  return useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      timerId: parseInt10(params.get('timer')) ?? 1,
      sessionId: params.get('sessionId') ?? 'default',
      bottomMargin: parseInt10(params.get('bottomMargin')),
      sideMargin: parseInt10(params.get('sideMargin')),
    };
  }, [search]);
};

/**
 * The relay session id for the shared timer displays, which are mounted under two
 * URL conventions: the projector `/…/preview?sessionId=` and the broadcast
 * `/stream/timer*?compId=`. The `/stream/*` overlays are addressed by `compId`
 * (every sibling overlay reads it via StreamLayout's `useStreamCompId`, and the
 * event read token is scoped to that `compId`), so a broadcast timer overlay MUST
 * open its WS on `compId` — otherwise it connects on the `"default"` sessionId
 * fallback and the read-token `$connect` authorizer rejects the handshake
 * ("scoped to <compId>, not session default"), the socket never reaches OPEN, and
 * the OPEN-gated display paints a blank frame. `compId` wins when present, else
 * the projector's `sessionId` (default `"default"`). compId === sessionId for the
 * relay by design (doc/dev/architecture.md → "Scoping"), so this only reconciles
 * the two param names.
 */
export const useRelaySessionId = (): string => {
  const { search } = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get('compId') ?? params.get('sessionId') ?? 'default';
  }, [search]);
};
