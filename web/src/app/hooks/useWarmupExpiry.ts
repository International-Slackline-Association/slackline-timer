import { useEffect, type Dispatch } from 'react';

import { remainingFrom } from 'app/util/time';
import type { WarmupAction, WarmupClock } from 'app/util/warmupChannel';

/**
 * Arm a single wall-clock timeout for the warm-up window's zero-crossing,
 * driven by the machine's own clock (HSM rule 4) — the `useLaneExpiry` /
 * `useTryExpiry` shape, keyed on the computed deadline so a re-render
 * re-derives the same one — and a wire correction that moves the crossing
 * without moving the anchor re-arms it.
 *
 * This is the single coordinator for warm-up expiry: the channel expires
 * because its clock ran out, never because a `WarmupCard` happened to be
 * mounted (its `Countdown` is purely visual, like the lane cards'). The
 * reducer guards the event, so a stale fire landing after a stop/reset is a
 * no-op.
 */
export const useWarmupExpiry = (clock: WarmupClock, dispatch: Dispatch<WarmupAction>) => {
  // Kind + deadline identify the timeout; only re-arm when they change.
  const kind = clock.kind;
  const deadline = clock.kind === 'running' ? clock.startedAt + clock.remainingMs : null;
  useEffect(() => {
    if (clock.kind !== 'running') {
      return;
    }
    const remaining = remainingFrom(clock.remainingMs, clock.startedAt, Date.now());
    const id = setTimeout(() => dispatch({ type: 'EXPIRE' }), remaining);
    return () => clearTimeout(id);
  }, [kind, deadline]);
};
