import { useEffect, type Dispatch } from 'react';

import { laneRemainingMs, type BattleAction, type LaneState } from 'app/util/battleMachine';
import type { PlayerId } from 'app/util/breakState';

/**
 * Arm a single wall-clock timeout for a lane's zero-crossing, driven by the
 * reducer state (ADR 0032, effects as data). A `running` lane fires TIMEOUT at its budget end;
 * an `onBreak` lane fires BREAK_ZERO at its break end. Anchored to the reducer's
 * wall-clock anchors so a re-render/reconnect re-derives the same deadline; the
 * reducer guards the event so a stale fire after a phase change is a no-op.
 *
 * This is the single coordinator for lane expiry, as `useTryExpiry` and
 * `useWarmupExpiry` are for the other two channels; the control board's
 * `Countdown` is purely visual. The feed surfaces' `onExpire` only beeps off
 * their own tick and dispatches into no machine.
 */
export const useLaneExpiry = (
  lane: PlayerId,
  laneState: LaneState,
  dispatch: Dispatch<BattleAction>,
) => {
  // The DEADLINE identifies the timeout, not the anchor it was derived from:
  // a `PEER_SNAPSHOT` or a duplicate `PEER_START` corrects a live lane's
  // remaining without moving `startedAt`, and an anchor-keyed effect would hold
  // the stale crossing. Phase rides along because two phases can share one
  // deadline while dispatching different events.
  const phase = laneState.phase;
  const deadline =
    laneState.phase === 'running'
      ? laneState.startedAt + laneState.budgetMs
      : laneState.phase === 'onBreak'
        ? laneState.breakStartedAt + laneState.breakMs
        : null;
  useEffect(() => {
    if (laneState.phase === 'running') {
      const remaining = Math.max(0, laneRemainingMs(laneState, Date.now()));
      const id = setTimeout(() => dispatch({ type: 'TIMEOUT', lane, at: Date.now() }), remaining);
      return () => clearTimeout(id);
    }
    if (laneState.phase === 'onBreak') {
      const remaining = Math.max(0, laneState.breakMs - (Date.now() - laneState.breakStartedAt));
      const id = setTimeout(
        () => dispatch({ type: 'BREAK_ZERO', lane, at: Date.now() }),
        remaining,
      );
      return () => clearTimeout(id);
    }
  }, [phase, deadline]);
};
