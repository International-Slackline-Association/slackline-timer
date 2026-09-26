import { useCallback, useMemo, useReducer } from 'react';

import type { CountdownSnapshot, CountdownWSMessage } from 'app/hooks/useWebSocket';
import {
  initialWarmupStore,
  peerWarmupEvent,
  warmupCardState,
  warmupDisplay,
  warmupReducer,
  warmupSnapshotRow,
} from 'app/util/warmupChannel';

/**
 * The Freestyle control page's warm-up channel (`timerId 0`): a `useReducer`
 * adapter over the pure `warmupChannel` machine, the third owner beside the
 * battle-lane and best-trick reducers (ADR 0015 §1 — an orthogonal,
 * shared countdown, so it neither disables a lane nor is disabled by one).
 *
 * The page wires `effects`/`dispatch` into its existing `useEffectDrain` (the
 * machines share `timerChannel`'s `TimerEffect`), so relay sends and beeps run at
 * the edge, because state changed — never inside the transitions. Everything
 * the card renders (`display`, `card`, `running`, `defaultSeconds`) and
 * the `request_state` contribution (`snapshotRow`) is derived from the one
 * machine state.
 *
 * The zero-crossing is the board's `useWarmupExpiry` (the sibling of
 * `useLaneExpiry`/`useTryExpiry`): the window expires because its clock ran
 * out, not because a card's `Countdown` was mounted to notice.
 */
export const useWarmupChannel = (initialDefaultSeconds: number) => {
  const [store, dispatch] = useReducer(warmupReducer, initialDefaultSeconds, initialWarmupStore);
  const { warmup } = store;

  const start = useCallback(() => dispatch({ type: 'START', at: Date.now() }), []);
  const stop = useCallback(() => dispatch({ type: 'STOP', at: Date.now() }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);
  const setDefaultSeconds = useCallback(
    (seconds: number) => dispatch({ type: 'SET_DEFAULT', seconds }),
    [],
  );

  /** Apply a peer panel's relayed message (ADR 0038); false = not this
   * channel's (`timerId 0`), so the caller can fall through. */
  const applyPeerMessage = useCallback((message: CountdownWSMessage, at: number): boolean => {
    const event = peerWarmupEvent(message, at);
    if (event === null) return false;
    dispatch(event);
    return true;
  }, []);

  /** Hydrate off a peer's `state_snapshot` (mirror-on-open catch-up). */
  const hydrate = useCallback(
    (timers: CountdownSnapshot['timers'], at: number) =>
      dispatch({ type: 'PEER_SNAPSHOT', at, timers }),
    [],
  );

  // Identity-stable per machine state, so the controlled Countdown's
  // `[display]` effect re-runs only on real transitions.
  const display = useMemo(() => warmupDisplay(warmup), [warmup]);
  const snapshotRow = useMemo(() => warmupSnapshotRow(warmup), [warmup]);
  const card = useMemo(() => warmupCardState(warmup), [warmup]);

  return {
    running: warmup.clock.kind === 'running',
    defaultSeconds: warmup.defaultSeconds,
    display,
    card,
    snapshotRow,
    start,
    stop,
    reset,
    setDefaultSeconds,
    applyPeerMessage,
    hydrate,
    effects: store.effects,
    dispatch,
  };
};

export type WarmupChannel = ReturnType<typeof useWarmupChannel>;
