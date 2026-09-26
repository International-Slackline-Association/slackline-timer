import { useEffect, type Dispatch } from 'react';

import type { TrySeriesAction, TrySeriesState } from 'app/util/bestTrickSeries';

/**
 * Arm a wall-clock timeout for the best-trick try window's zero-crossing (rule
 * F6), keyed on the computed deadline (the `useLaneExpiry` rule: a window
 * corrected in place at the anchor it already holds must re-arm). The reducer
 * guards a stale fire (a timeout that lands after the try already ended).
 */
export const useTryExpiry = (
  series: TrySeriesState | null,
  dispatch: Dispatch<TrySeriesAction>,
) => {
  const clock = series?.clock;
  const deadline = clock?.running ? clock.startedAt + clock.tryMs : null;
  useEffect(() => {
    if (!clock?.running) return;
    const remaining = Math.max(0, clock.tryMs - (Date.now() - clock.startedAt));
    const id = setTimeout(() => dispatch({ type: 'TRY_TIMEOUT', at: Date.now() }), remaining);
    return () => clearTimeout(id);
  }, [deadline]);
};
