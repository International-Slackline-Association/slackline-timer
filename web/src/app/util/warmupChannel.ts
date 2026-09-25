/**
 * The Freestyle warm-up channel (`timerId 0`) — a pure machine in the
 * `battleMachine.ts` idiom, but a *separate* one (three channels, three
 * charts): warm-up is a shared countdown independent of the two performance
 * lanes' mutual exclusion and of the best-trick series (ADR 0015 §1).
 * It used to live as ~100 lines of `useState` smeared across five regions of
 * the Freestyle ControlPage, re-implementing by hand the
 * owner + controlled-display + peer-apply + snapshot-hydrate shape the lanes
 * get from their reducer; now the state lives here in exactly one place and
 * the page consumes it through `useWarmupChannel`.
 *
 * Design (per the HSM rules): the clock is a discriminated union — a running
 * clock carries its wall-clock anchor plus the remaining AT that anchor, so
 * the live value is derived, never accumulated — the reducer is pure
 * `(state, event) -> { state, effects }` (no I/O, no `Date.now()`: wall clock
 * rides in on `at`), exhaustively switched with a `never` check, and
 * side-effects (relay sends, control-surface beeps) are returned as data for
 * the page's existing `useEffectDrain` to perform.
 */

import type { TimerEffect } from 'app/util/timerChannel';
import type { CountdownSnapshot, CountdownWSMessage } from 'app/hooks/useWebSocket';
import { countdownLaneState, type CountdownControlRow } from 'app/util/timerSnapshot';
import { formatClock, remainingFrom } from 'app/util/time';
import { appendEffects, drainEffects } from 'app/util/effectStore';

/** Warm-up shares the countdown channel as timerId 0 (ADR 0015 §1). */
export const WARMUP_TIMER_ID = 0;

/**
 * The warm-up clock. `expired` is a real phase (the card's WARM-UP OVER
 * face), not an `remainingMs === 0` convention — re-arming it is an explicit
 * RESET / default edit, so a spent clock can never be started into a
 * zero-length broadcast.
 */
export type WarmupClock =
  | { kind: 'idle'; remainingMs: number }
  | { kind: 'running'; remainingMs: number; startedAt: number }
  | { kind: 'expired' };

export interface WarmupState {
  /** The armed default (the Setup strip's "Warm-up (s)" field). */
  defaultSeconds: number;
  clock: WarmupClock;
}

/** Events (domain verbs). Wall clock rides in on `at` so the reducer stays
 * pure. The PEER_* family (ADR 0038) applies another control panel's relayed
 * `timerId 0` messages — the wire values are the truth and none of them may
 * emit a `ws` effect (the page's drain would re-broadcast and loop the
 * panels); audio effects stay (every surface beeps, ADR 0015 §3). */
export type WarmupEvent =
  | { type: 'START'; at: number }
  | { type: 'STOP'; at: number }
  | { type: 'RESET' }
  | { type: 'EXPIRE' }
  | { type: 'SET_DEFAULT'; seconds: number }
  | { type: 'PEER_START'; startedAt: number; remainingMs: number }
  | { type: 'PEER_STOP'; remainingMs: number }
  | { type: 'PEER_RESET'; remainingMs: number }
  | { type: 'PEER_SNAPSHOT'; at: number; timers: CountdownSnapshot['timers'] };

export interface WarmupResult {
  state: WarmupState;
  effects: TimerEffect[];
}

/** A fresh channel: idle at the given default. */
export const initialWarmupState = (defaultSeconds: number): WarmupState => ({
  defaultSeconds,
  clock: { kind: 'idle', remainingMs: defaultSeconds * 1000 },
});

/** The controlled display for the card's `Countdown` (rule 2 — derived, the
 * clock union IS the display shape; warm-up has no break variant, so the
 * narrow union is what leaves here and the `Countdown` call site is where it
 * gets checked against `CountdownDisplayState`). */
export const warmupDisplay = (state: WarmupState): WarmupClock => state.clock;

/** The card's visual tier — its frame stroke and its state word's colour tier.
 * `held` is the lane cards' own tier name (`LaneCardTier`): the left rail says
 * a used channel the way the run deck says one. */
export type WarmupCardTier = 'armed' | 'running' | 'held' | 'over';

export interface WarmupCardState {
  tier: WarmupCardTier;
  /** The always-rendered state word (§4.12: never an empty slot). */
  word: string;
}

/**
 * The warm-up card's state word + tier, the `laneCard` sibling (§3/§6), so the
 * word, the frame and the hue cannot disagree and the card stays a pure
 * function of the channel.
 *
 * `clock.kind` alone is not enough, for the reason `laneCard` needs `armedMs`:
 * a stopped window is `idle` too, so a warm-up used down to 04:59 rendered
 * pixel-identical to a fresh 05:00 one but for the digits (audit S02). The
 * distance to the armed default is what separates them.
 */
export const warmupCardState = (state: WarmupState): WarmupCardState => {
  switch (state.clock.kind) {
    case 'idle':
      return state.clock.remainingMs === state.defaultSeconds * 1000
        ? { tier: 'armed', word: 'ARMED' }
        : { tier: 'held', word: `STOPPED · ${formatClock(state.clock.remainingMs)} LEFT` };
    case 'running':
      return { tier: 'running', word: 'RUNNING' };
    case 'expired':
      return { tier: 'over', word: 'WARM-UP OVER' };
  }
};

/**
 * The channel's contribution to a `request_state` snapshot (ADR 0011) — the
 * machine state IS the snapshot source. Same canonical pre-send row the lanes
 * produce (`laneSnapshot`); `buildCountdownSnapshot` adjusts a running clock
 * for wall-clock elapsed at send, so a running clock hands over its target +
 * anchor unadjusted here. Still no `breaksLeft` — warm-up is an allowance-free
 * channel — but it DOES carry `armedMs` (ADR 0046 §2, amended): the armed
 * default is what tells a joining audience surface a stopped window from a fresh
 * one, the same distance `warmupCardState` reads for the operator's
 * ARMED / STOPPED · 04:59 LEFT.
 */
export const warmupSnapshotRow = (state: WarmupState): CountdownControlRow => {
  const armedMs = state.defaultSeconds * 1000;
  switch (state.clock.kind) {
    case 'idle':
      return {
        timerId: WARMUP_TIMER_ID,
        lastRemainingMs: state.clock.remainingMs,
        isRunning: false,
        startedAt: null,
        armedMs,
      };
    case 'running':
      return {
        timerId: WARMUP_TIMER_ID,
        lastRemainingMs: state.clock.remainingMs,
        isRunning: true,
        startedAt: state.clock.startedAt,
        armedMs,
      };
    case 'expired':
      return {
        timerId: WARMUP_TIMER_ID,
        lastRemainingMs: 0,
        isRunning: false,
        startedAt: null,
        armedMs,
      };
  }
};

/** A stopped/recovered clock at a known remaining: spent means `expired`. */
const restingClock = (remainingMs: number): WarmupClock =>
  remainingMs <= 0 ? { kind: 'expired' } : { kind: 'idle', remainingMs };

/**
 * The pure transition. `(state, event) -> { state, effects }` — exhaustive
 * over the event union, `never`-checked, no I/O.
 */
export const reduce = (state: WarmupState, event: WarmupEvent): WarmupResult => {
  switch (event.type) {
    case 'START': {
      // Only an armed (idle) clock starts: a running clock ignores a re-press,
      // and a spent one must be re-armed first (RESET / a default edit) —
      // starting it would broadcast a zero-length window.
      if (state.clock.kind !== 'idle') {
        return { state, effects: [] };
      }
      const remainingMs = state.clock.remainingMs;
      return {
        state: { ...state, clock: { kind: 'running', remainingMs, startedAt: event.at } },
        effects: [
          { kind: 'audio', sound: 'short' },
          {
            kind: 'ws',
            // One epoch for BOTH the local display anchor and the wire anchor,
            // so this control's own clock and every receiver derive off the
            // identical start.
            message: {
              type: 'start_countdown',
              timerId: WARMUP_TIMER_ID,
              data: { remainingMs, startedAt: event.at },
            },
          },
        ],
      };
    }

    case 'STOP': {
      if (state.clock.kind !== 'running') {
        return { state, effects: [] };
      }
      // Freeze the derived remaining and broadcast it (a stop at exactly zero
      // lands as expired, same as the crossing would).
      const remainingMs = remainingFrom(state.clock.remainingMs, state.clock.startedAt, event.at);
      return {
        state: { ...state, clock: restingClock(remainingMs) },
        effects: [
          {
            kind: 'ws',
            message: { type: 'stop_countdown', timerId: WARMUP_TIMER_ID, data: { remainingMs } },
          },
        ],
      };
    }

    case 'RESET': {
      const remainingMs = state.defaultSeconds * 1000;
      return {
        state: { ...state, clock: { kind: 'idle', remainingMs } },
        effects: [
          {
            kind: 'ws',
            message: { type: 'reset_countdown', timerId: WARMUP_TIMER_ID, data: { remainingMs } },
          },
        ],
      };
    }

    case 'EXPIRE': {
      // The local Countdown crossed zero: freeze at 0 and sound `alert` — the
      // warm-up's own tone, so it is never mistaken for a run budget running out
      // (`long`) or a break ending (`alert2`). Nothing on the card moves: the
      // transport slot swaps Start/Stop/Reset for the same-size Re-arm and the
      // state word becomes WARM-UP OVER in place (audit S14/S19). No broadcast —
      // every receiving surface beeps off its own Countdown's onExpire
      // (ADR 0015 §3). A stale fire after a stop/reset is a no-op.
      if (state.clock.kind !== 'running') {
        return { state, effects: [] };
      }
      return {
        state: { ...state, clock: { kind: 'expired' } },
        effects: [{ kind: 'audio', sound: 'alert' }],
      };
    }

    case 'SET_DEFAULT': {
      // Keep the clock pinned to the default while it isn't running, so editing
      // the field re-arms it (a spent clock included). A running clock keeps
      // its anchor; the new default applies from the next RESET.
      const next = { ...state, defaultSeconds: event.seconds };
      if (state.clock.kind === 'running') {
        return { state: next, effects: [] };
      }
      return {
        state: { ...next, clock: { kind: 'idle', remainingMs: event.seconds * 1000 } },
        effects: [],
      };
    }

    case 'PEER_START': {
      // A peer panel started the warm-up: mirror it verbatim, anchored to the
      // shared wire epoch (receipt fallback upstream in `peerWarmupEvent`) so
      // both panels' clocks converge. Applied unguarded (last-writer-wins,
      // ADR 0038 §4).
      return {
        state: {
          ...state,
          clock: { kind: 'running', remainingMs: event.remainingMs, startedAt: event.startedAt },
        },
        effects: [{ kind: 'audio', sound: 'short' }],
      };
    }

    case 'PEER_STOP': {
      // The wire remaining is authoritative (freezes any sub-RTT drift of the
      // local mirror).
      return { state: { ...state, clock: restingClock(event.remainingMs) }, effects: [] };
    }

    case 'PEER_RESET': {
      return { state: { ...state, clock: restingClock(event.remainingMs) }, effects: [] };
    }

    case 'PEER_SNAPSHOT': {
      // Catch-up hydration off a peer's state_snapshot (mirror-on-open, gated
      // live-beats-snapshot upstream). A snapshot without the channel leaves
      // the local state standing.
      const row = event.timers.find((t) => t.timerId === WARMUP_TIMER_ID);
      if (!row) {
        return { state, effects: [] };
      }
      const w = countdownLaneState(row);
      // The room owns the armed budget (ADR 0046 §2, the `laneFromSnapshot`
      // rule one channel over): a joiner keeping its own `defaultSeconds` reads
      // a HELD window as ARMED — `warmupCardState` separates the two by the
      // distance to the default — and then re-arms the whole room to that
      // default on its next RESET, which every peer applies as PEER_RESET. Rides
      // every phase, because the joiner's next RESET does too. A pre-feature
      // peer omits it and the local default stands (unlike a lane, this channel
      // always holds one, so there is nothing to invent).
      const next =
        w.armedMs != null ? { ...state, defaultSeconds: w.armedMs / 1000 } : { ...state };
      if (w.isRunning) {
        // Anchor to the shared wire epoch (the snapshot's send time, the
        // `laneFromSnapshot` precedent) so every joiner converges; a
        // pre-feature snapshot omits it — fall back to receipt (`at`).
        return {
          state: {
            ...next,
            clock: {
              kind: 'running',
              remainingMs: w.remainingMs,
              startedAt: w.startedAt ?? event.at,
            },
          },
          effects: [],
        };
      }
      return { state: { ...next, clock: restingClock(w.remainingMs) }, effects: [] };
    }

    default: {
      return ((_exhaustive: never): WarmupResult => ({ state, effects: [] }))(event);
    }
  }
};

/**
 * Translate a peer panel's relayed `timerId 0` message into its PEER_* event,
 * stamped with the receipt wall clock (ADR 0038). Null for every other channel
 * and for session-scoped messages — lanes mirror via
 * `battleMachine.peerBattleEvent`, the try clock via
 * `bestTrickSeries.peerTryAction`. The break family never rides this channel.
 */
export const peerWarmupEvent = (message: CountdownWSMessage, at: number): WarmupEvent | null => {
  if (!('timerId' in message) || message.timerId !== WARMUP_TIMER_ID) {
    return null;
  }
  switch (message.type) {
    case 'start_countdown':
      return {
        type: 'PEER_START',
        // Prefer the shared wire anchor; a pre-feature sender omits it, so fall
        // back to receipt — the old ~RTT-anchored behaviour.
        startedAt: message.data.startedAt ?? at,
        remainingMs: message.data.remainingMs,
      };
    case 'stop_countdown':
      return { type: 'PEER_STOP', remainingMs: message.data.remainingMs };
    case 'reset_countdown':
      return { type: 'PEER_RESET', remainingMs: message.data.remainingMs };
    default:
      return null;
  }
};

/**
 * `useReducer` adapter, byte-compatible with the other two machines' stores:
 * the pure `warmup` state plus a queue of pending `effects` for the page's
 * `useEffectDrain` (effects-as-data; `DRAIN` clears the queue after the edge
 * has performed it).
 */
export interface WarmupStore {
  warmup: WarmupState;
  effects: TimerEffect[];
}

export type WarmupAction = WarmupEvent | { type: 'DRAIN' };

export const warmupReducer = (store: WarmupStore, action: WarmupAction): WarmupStore => {
  if (action.type === 'DRAIN') {
    return drainEffects(store);
  }
  const { state, effects } = reduce(store.warmup, action);
  return { warmup: state, effects: appendEffects(store.effects, effects) };
};

export const initialWarmupStore = (defaultSeconds: number): WarmupStore => ({
  warmup: initialWarmupState(defaultSeconds),
  effects: [],
});
