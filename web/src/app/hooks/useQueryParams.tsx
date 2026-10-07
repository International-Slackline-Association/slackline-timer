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
 * The relay session id for the shared timer displays, mounted under two URL
 * conventions: the projector `/…/preview?sessionId=` and the broadcast
 * `/stream/timer*?compId=`. `compId` wins when present, else `sessionId`
 * (default `"default"`); compId === sessionId for the relay
 * (doc/dev/architecture.md → "Scoping"), so this only reconciles the two param
 * names. A broadcast overlay falling back to `"default"` would be rejected by
 * the read-token `$connect` authorizer (the token is scoped to its `compId`),
 * never reach OPEN, and paint a blank frame.
 */
export const useRelaySessionId = (): string => {
  const { search } = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get('compId') ?? params.get('sessionId') ?? 'default';
  }, [search]);
};
