import { useEffect, useState } from 'react';
import { ReadyState } from 'react-use-websocket';

/** Longer than the early reconnect delays, so only a real outage surfaces. */
export const GRACE_MS = 5_000;

/**
 * Derives "the relay link has been down long enough to matter" from a socket's
 * `readyState`. Reconnect attempts are unbounded (ADR 0024), so this is not a
 * give-up signal — it flips true once the link has been continuously non-OPEN
 * past `GRACE_MS` (so a routine token-refresh / keepalive reconnect blip never
 * trips it) and clears the instant the socket reopens.
 *
 * Shared by `ConnectionLostBadge` (the corner overlay indicator) and the H2R
 * bridge status panel so both read the same staleness.
 */
export const useStaleAfterGrace = (readyState: ReadyState): boolean => {
  const isOpen = readyState === ReadyState.OPEN;
  const [stale, setStale] = useState(false);

  // Keyed on `isOpen` (not readyState) so CLOSED→CONNECTING retry flaps don't
  // restart the grace clock — it measures continuous time without a live link.
  useEffect(() => {
    if (isOpen) {
      setStale(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setStale(true), GRACE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  return stale;
};
