import { useEffect, useRef } from 'react';
import type { ErrorBoundary } from 'react-error-boundary';

/** Retry ladder after consecutive failures; the last step repeats. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;
/** A failure this long after the previous one starts the ladder over. */
const FAILURE_STREAK_MS = 60_000;

const retryDelayMs = (failures: number): number =>
  RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1];

/**
 * Self-healing for a boundary nobody is watching: `scheduleRetry` (from
 * `onError`) resets the boundary behind `boundaryRef` after the next ladder
 * step; `resetLadder` drops a pending retry and the streak.
 */
export const useRetryLadder = () => {
  const boundaryRef = useRef<ErrorBoundary>(null);
  const stateRef = useRef({ timer: 0, failures: 0, lastAt: 0 });

  useEffect(() => () => window.clearTimeout(stateRef.current.timer), []);

  const scheduleRetry = (): void => {
    const state = stateRef.current;
    const now = Date.now();
    state.failures = now - state.lastAt > FAILURE_STREAK_MS ? 1 : state.failures + 1;
    state.lastAt = now;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(
      () => boundaryRef.current?.resetErrorBoundary(),
      retryDelayMs(state.failures),
    );
  };

  const resetLadder = (): void => {
    window.clearTimeout(stateRef.current.timer);
    stateRef.current = { timer: 0, failures: 0, lastAt: 0 };
  };

  return { boundaryRef, scheduleRetry, resetLadder };
};
