/**
 * The Freestyle battle **part-2 best-trick** series (rule F6) — a pure machine in
 * the `battleMachine.ts` idiom, but a *separate* one (two machines, two charts:
 * ADR 0032's battle reducer is left untouched). During best trick both lanes are
 * already finished/idle, so the battle machine's `runningLane` is null and its
 * expiry never arms — this additive layer owns its own clock, on the vacant wire
 * channel `timerId 3` (was battle-elapsed, deleted by ADR 0019 §3).
 *
 * The rule: after the two timed runs, each athlete gets a fixed number of
 * best-trick tries (3, or **5 in the final**), alternating, participant A first
 * (= athlete slot 1 — `selectMatch` maps athlete1 → slot 1), each with a 30 s window.
 * A try is *consumed on start* — opening a 30 s window is the attempt — so
 * landed/missed are transition-identical (no per-try outcome is modelled here;
 * the steal-halving stays judge arithmetic on the entered `bestTrick` Score
 * component, compliance §4.3).
 *
 * Turn enforcement is advisory: `suggestedNext` proposes who is up (software
 * advises, the operator decides — judges reorder tries in the field), and the
 * panel lets the operator start either side. No new persisted entity and no
 * server/parity change — the relay is opaque and `LiveSelection` is web-only.
 *
 * Design (per the HSM rules): state is a discriminated `clock` union (a running
 * clock carries its anchor + window, an idle clock carries nothing), the reducer
 * is pure `(state, event) -> { state, effects }` (no I/O, no `Date.now()` — wall
 * clock rides in on `at`), exhaustively switched, and side-effects (relay sends,
 * beeps) are returned as data for the page's existing drain to perform.
 */

import type { PlayerId } from 'app/util/breakState';
import { otherLane } from 'app/util/battleMachine';
import type { TimerEffect, CountdownDisplayState } from 'app/util/timerChannel';
import type { CountdownWSMessage, FreestyleSelection } from 'app/hooks/useWebSocket';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { remainingFrom } from 'app/util/time';
import { appendEffects, drainEffects } from 'app/util/effectStore';

/** The best-trick try clock: an orthogonal countdown channel (ADR 0015 §1). */
export const BEST_TRICK_TIMER_ID = 3;

/** Default per-try window (rule F6: max 30 s each). Operator-adjustable. */
export const DEFAULT_TRY_MS = 30_000;

/** Tries per athlete: 3 by default, 5 in the final (rule F6). */
export const DEFAULT_CAP = 3;
export const FINAL_CAP = 5;

/** A running clock carries its wall-clock anchor + window so the live remaining
 * is derived, never accumulated (rule 6). A resting clock carries `endedMs` —
 * the last try's frozen remaining (0 = the window expired, renders "TIME"), or
 * null when no try has run since the last arm/reset (the display then rests at
 * the armed window). It exists purely so the controlled display can derive the
 * between-tries numeral from state instead of replaying the stop message. */
export type TryClock =
  | { running: false; endedMs: number | null }
  | { running: true; side: PlayerId; startedAt: number; tryMs: number };

export interface TrySeriesState {
  /** Tries allowed per athlete (3, or 5 in the final). */
  cap: number;
  /** The per-try window applied to the next START_TRY. */
  tryMs: number;
  /** Tries consumed per side. */
  used: { 1: number; 2: number };
  clock: TryClock;
  /** The side of the last started/skipped try, for the alternation suggestion. */
  lastSide: PlayerId | null;
}

/** Events (domain verbs). Wall clock rides in on `at` so the reducer stays pure. */
export type TrySeriesEvent =
  | { type: 'START_TRY'; side: PlayerId; at: number }
  | { type: 'END_TRY'; at: number }
  | { type: 'TRY_TIMEOUT'; at: number }
  | { type: 'SKIP_TRY'; side: PlayerId }
  | { type: 'SET_CAP'; cap: number }
  | { type: 'SET_TRY_MS'; tryMs: number }
  | { type: 'RESET' };

export interface TrySeriesResult {
  state: TrySeriesState;
  effects: TimerEffect[];
}

/** A fresh series at the given cap/window: no tries used, clock idle. */
export const initialTrySeries = (cap: number, tryMs: number = DEFAULT_TRY_MS): TrySeriesState => ({
  cap,
  tryMs,
  used: { 1: 0, 2: 0 },
  clock: { running: false, endedMs: null },
  lastSide: null,
});

/** Whether a side still has tries left (its used count is below the cap). */
const hasTriesLeft = (state: TrySeriesState, side: PlayerId): boolean =>
  state.used[side] < state.cap;

/**
 * The side the software suggests goes next (advisory): participant A (athlete slot 1)
 * first; thereafter alternate from `lastSide`, but fall back to the same side
 * when the other is exhausted; `null` once both have used all their tries. A
 * running clock has no "next" — its side is current — so callers read the
 * running side directly for the live turn.
 */
export const suggestedNext = (state: TrySeriesState): PlayerId | null => {
  const left1 = hasTriesLeft(state, 1);
  const left2 = hasTriesLeft(state, 2);
  if (!left1 && !left2) return null;
  if (state.lastSide === null) return left1 ? 1 : 2;
  const other: PlayerId = state.lastSide === 1 ? 2 : 1;
  if (hasTriesLeft(state, other)) return other;
  return hasTriesLeft(state, state.lastSide) ? state.lastSide : null;
};

/** The series is over once both athletes have used all their tries. */
export const seriesDone = (state: TrySeriesState): boolean =>
  state.used[1] >= state.cap && state.used[2] >= state.cap;

/** The running try clock's live remaining, derived from its anchor (0 when idle). */
export const tryRemainingMs = (state: TrySeriesState, now: number): number =>
  state.clock.running ? remainingFrom(state.clock.tryMs, state.clock.startedAt, now) : 0;

/** The side whose try is live now, or — between tries — who is suggested next. */
export const currentTurn = (state: TrySeriesState): PlayerId | null =>
  state.clock.running ? state.clock.side : suggestedNext(state);

/**
 * The series as the board relays it (`updateSelection.bestTrick`) — the preview
 * hero's source and, since ADR 0038, the peer panels' tally/cap/turn mirror.
 * Lives here rather than in the board hook because `PEER_SELECTION` is its
 * inverse: every panel re-pushes what this derives, so the two must be read
 * side by side.
 */
export const bestTrickWire = (state: TrySeriesState | null): FreestyleSelection['bestTrick'] =>
  state === null
    ? undefined
    : {
        cap: state.cap,
        tries: { 1: state.used[1], 2: state.used[2] },
        turn: currentTurn(state),
        clockRunning: state.clock.running,
      };

/**
 * The try clock's controlled display, derived from the series (rule 2 — the
 * reducer state drives the control-page Countdown; no message replay, no
 * recovery side channel). Running derives from the anchor; at rest the numeral
 * holds the last try's frozen remaining (`endedMs`, 0 = expired → "TIME"), or
 * the armed window when no try has run since arm/reset.
 */
export const tryClockDisplay = (state: TrySeriesState): CountdownDisplayState => {
  if (state.clock.running) {
    return { kind: 'running', remainingMs: state.clock.tryMs, startedAt: state.clock.startedAt };
  }
  if (state.clock.endedMs === null) {
    return { kind: 'idle', remainingMs: state.tryMs };
  }
  return state.clock.endedMs <= 0
    ? { kind: 'expired' }
    : { kind: 'idle', remainingMs: state.clock.endedMs };
};

const startCountdown = (remainingMs: number, startedAt: number): TimerEffect => ({
  kind: 'ws',
  // `startedAt` is the shared wire anchor (the try's wall-clock start), so every
  // receiver derives the same remaining off it instead of its own receipt time.
  message: {
    type: 'start_countdown',
    timerId: BEST_TRICK_TIMER_ID,
    data: { remainingMs, startedAt },
  },
});

const resetCountdown = (remainingMs: number): TimerEffect => ({
  kind: 'ws',
  message: { type: 'reset_countdown', timerId: BEST_TRICK_TIMER_ID, data: { remainingMs } },
});

/**
 * The pure transition. `(state, event) -> { state, effects }`, exhaustive and
 * `never`-checked, no I/O. The try clock is anchored to the event wall clock so
 * both surfaces derive the same remaining off it (rule 6).
 */
export const reduce = (state: TrySeriesState, event: TrySeriesEvent): TrySeriesResult => {
  switch (event.type) {
    case 'START_TRY': {
      // Guard: never start over a live clock, and never over an exhausted side.
      // A try is consumed on start — opening the 30 s window IS the attempt.
      if (state.clock.running || !hasTriesLeft(state, event.side)) {
        return { state, effects: [] };
      }
      const tryMs = state.tryMs;
      return {
        state: {
          ...state,
          used: { ...state.used, [event.side]: state.used[event.side] + 1 },
          clock: { running: true, side: event.side, startedAt: event.at, tryMs },
          lastSide: event.side,
        },
        effects: [startCountdown(tryMs, event.at), { kind: 'audio', sound: 'short' }],
      };
    }

    case 'END_TRY': {
      // Landed and missed are transition-identical: both surfaces already scored
      // the try by eye. Ending a try switches to the other athlete, so RESET the
      // clock to the full window for them (rested at the armed `tryMs` via
      // endedMs=null) rather than freezing at the leftover time — a frozen
      // leftover reads as if the next athlete only gets that much. A window that
      // runs out on its own (TRY_TIMEOUT) still rests at 0 → red 00:00.
      if (!state.clock.running) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, clock: { running: false, endedMs: null } },
        effects: [resetCountdown(state.tryMs)],
      };
    }

    case 'TRY_TIMEOUT': {
      // The window crossed zero. Only the control-surface beep — the preview
      // beeps off its own Countdown onExpire (the warm-up precedent, ADR 0015 §3),
      // so no stop_countdown is broadcast. `short`, not `long`: a 30 s try window
      // closing is the smallest of the four expiries and must not sound like a
      // run budget running out (audit S14). A stale fire after END_TRY is a no-op.
      if (!state.clock.running) {
        return { state, effects: [] };
      }
      return {
        state: { ...state, clock: { running: false, endedMs: 0 } },
        effects: [{ kind: 'audio', sound: 'short' }],
      };
    }

    case 'SKIP_TRY': {
      // Pass an athlete's try without running the clock (they forfeit it). Guarded
      // like START_TRY: not over a live clock, not over an exhausted side.
      if (state.clock.running || !hasTriesLeft(state, event.side)) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          used: { ...state.used, [event.side]: state.used[event.side] + 1 },
          lastSide: event.side,
        },
        effects: [],
      };
    }

    case 'SET_CAP': {
      // Config change (3 ↔ 5). Only meaningful while idle; a lowered cap simply
      // exhausts a side whose used count now meets it (the `>=` guards handle it).
      if (state.clock.running) {
        return { state, effects: [] };
      }
      return { state: { ...state, cap: Math.max(0, event.cap) }, effects: [] };
    }

    case 'SET_TRY_MS': {
      // Per-try window preset. Applies to the NEXT try — a running clock keeps its
      // captured window — so it is a no-op mid-try. Broadcast the new window (as a
      // reset_countdown of the resting clock) so a second control panel adopts it
      // at once via PEER_TRY_RESET, rather than diverging until the next ARM/RESET.
      if (state.clock.running) {
        return { state, effects: [] };
      }
      const tryMs = Math.max(0, event.tryMs);
      return { state: { ...state, tryMs }, effects: [resetCountdown(tryMs)] };
    }

    case 'RESET': {
      // Clear the tally back to zero, keep the config (cap/window), and reset the
      // wire clock so the preview hero reads the full window again.
      return {
        state: {
          cap: state.cap,
          tryMs: state.tryMs,
          used: { 1: 0, 2: 0 },
          clock: { running: false, endedMs: null },
          lastSide: null,
        },
        effects: [resetCountdown(state.tryMs)],
      };
    }

    default: {
      return ((_exhaustive: never): TrySeriesResult => ({ state, effects: [] }))(event);
    }
  }
};

/**
 * `useReducer` store. Like `battleMachine`, the series can be **disarmed**
 * (`null` — the phase is not active); ARM/DISARM are page-level and the pure
 * events only apply while armed. Effects queue for the page's existing drain.
 *
 * The PEER_* actions (ADR 0038) mirror another control panel's best-trick
 * phase and never emit a `ws` effect (a re-broadcast would loop the panels).
 * The tally/cap/turn ride the peer's `updateSelection.bestTrick`
 * (PEER_SELECTION — arms/disarms this store to match, silently); the try
 * clock rides the `timerId 3` countdown messages (PEER_TRY_*). The acting
 * panel's two frames are NOT ordered (the selection push and the effect drain
 * are separate effects), so a PEER_TRY_START may land before the selection that
 * names its side: it guesses from `lastSide`, and PEER_SELECTION corrects it.
 * Both orders converge, and neither can regress the acting panel's own state —
 * the `bestTrickSeries` round-trip test pins that.
 */
export interface TrySeriesStore {
  series: TrySeriesState | null;
  /** The board context the phase belongs to — `null` until the board reports
   * one (see `TrySeriesContext`). */
  context: TrySeriesContext | null;
  effects: TimerEffect[];
}

/**
 * The board state an armed series belongs to: the selected match (ADR 0017 §3 —
 * the phase belongs to the match that was live when it was armed) and the board
 * mode (ADR 0036 — best trick is a battle-only surface). Held BY the machine so
 * the reset rule is a transition rather than a page effect racing a ref.
 */
export interface TrySeriesContext {
  /** The recorder's selected match id; `''` when no match is selected. */
  matchId: string;
  mode: FreestyleMode;
}

const sameContext = (a: TrySeriesContext | null, b: TrySeriesContext): boolean =>
  a !== null && a.matchId === b.matchId && a.mode === b.mode;

export type TrySeriesAction =
  | { type: 'ARM'; cap: number; tryMs?: number }
  | { type: 'DISARM' }
  | { type: 'DRAIN' }
  /** The board's own context, observed after every change: a real change is the
   * reset rule firing (disarm + freeze the wire clock). */
  | { type: 'CONTEXT'; context: TrySeriesContext }
  /** The peer twin (ADR 0038): a mirrored panel's context change, which drops
   * the mirrored series SILENTLY (the peer's `bestTrick`, riding the same
   * frame, re-arms it when the phase survived the change). */
  | { type: 'PEER_CONTEXT'; context: TrySeriesContext }
  | { type: 'PEER_SELECTION'; bestTrick: FreestyleSelection['bestTrick'] }
  | { type: 'PEER_TRY_START'; at: number; startedAt: number; remainingMs: number }
  | { type: 'PEER_TRY_STOP'; remainingMs: number }
  | { type: 'PEER_TRY_RESET'; remainingMs: number }
  | TrySeriesEvent;

/** Leave best trick: clear the phase and freeze the wire clock. Identity when
 * already disarmed. Shared by DISARM and the CONTEXT reset rule. */
const disarm = (store: TrySeriesStore): TrySeriesStore =>
  store.series === null
    ? store
    : { ...store, series: null, effects: [...store.effects, resetCountdown(0)] };

export const trySeriesReducer = (
  store: TrySeriesStore,
  action: TrySeriesAction,
): TrySeriesStore => {
  switch (action.type) {
    case 'ARM':
      // Begin best trick: a fresh tally, and a reset of the wire clock so the
      // preview hero shows the full window the moment it appears. Queued behind
      // whatever is still pending (the edge drains once per render, so a disarm
      // and the re-arm that replaces it can land in one tick) — the ordered
      // queue then ends on this window, where discarding lost the disarm's own
      // reset and left the preview hero on the previous match's clock.
      return {
        ...store,
        series: initialTrySeries(action.cap, action.tryMs),
        effects: appendEffects(store.effects, [resetCountdown(action.tryMs ?? DEFAULT_TRY_MS)]),
      };
    case 'DISARM':
      return disarm(store);
    case 'CONTEXT': {
      // The reset rule (ADR 0017 §3 / ADR 0036): a match or mode change the
      // board has not already been told about disarms. The FIRST context — the
      // page's mount observation — is adopted silently; there is nothing armed
      // to lose, and disarming on mount would be a broadcast about nothing.
      if (sameContext(store.context, action.context)) return store;
      const next = store.context === null ? store : disarm(store);
      return { ...next, context: action.context };
    }
    case 'PEER_CONTEXT': {
      // The peer twin of the reset rule. The room moved to another match/mode,
      // so the series this panel mirrors belongs to a context the room has
      // left: drop it — but SILENTLY, where the local rule broadcasts. A
      // `reset_countdown(0)` from the mirrored path would freeze the acting
      // panel's own clock, and it has already sent its own.
      //
      // The peer's `bestTrick` still decides the outcome — the `PEER_SELECTION`
      // riding the SAME frame re-arms this store when the peer's phase survived
      // — it just no longer has to ARRIVE for the stale series to go. That is
      // what makes the mirror proof against the frame order (the acting panel
      // sends its selection and its drained `timerId 3` clock as two
      // unordered frames): the clock frames then find nothing to keep or
      // re-arm whichever side of the selection they land on, and this panel can
      // never re-push an armed `bestTrick` stamped with the peer's NEW match —
      // the push that re-armed the acting panel on the series it had just left
      // (`peer-match-disarm-reorder-race`).
      //
      // The FIRST context is adopted silently for the same reason as `CONTEXT`:
      // a mount observation has nothing armed to lose.
      if (sameContext(store.context, action.context)) return store;
      const next = store.context === null ? store : { ...store, series: null };
      return { ...next, context: action.context };
    }
    case 'DRAIN':
      return drainEffects(store);
    case 'PEER_SELECTION': {
      const bt = action.bestTrick;
      if (!bt) {
        // The peer board carries no best-trick phase: mirror the disarm
        // silently — unlike DISARM, no reset broadcast (the peer already sent
        // its own, or was never armed).
        return store.series === null ? store : { ...store, series: null };
      }
      // Arm to match (a peer armed while we were not), then take the wire
      // tally/cap. `lastSide` is reconstructed so `currentTurn` reproduces the
      // wire `turn`: a running clock's side IS the acting panel's lastSide;
      // between tries the suggestion is other(lastSide).
      const current = store.series ?? initialTrySeries(bt.cap);
      // The clock channel (PEER_TRY_*) owns the clock; the selection only
      // corrects a running one's SIDE — the one fact PEER_TRY_START has to
      // guess. It may NOT stop one: every panel re-pushes this payload, so a
      // `clockRunning: false` echo is usually a peer that has not applied our
      // start_countdown yet, and stopping on it killed the acting panel's own
      // try (peer-mirroring smoke). A real stop rides reset/stop_countdown, or
      // — for a window that runs out — each surface's own expiry off the
      // shared anchor.
      const clock: TryClock =
        current.clock.running &&
        bt.clockRunning &&
        bt.turn !== null &&
        current.clock.side !== bt.turn
          ? { ...current.clock, side: bt.turn }
          : current.clock;
      // A wire tally nothing has been spent on has no history to reconstruct:
      // `turn` there is a suggestion, and reading `otherLane` out of it invented
      // a `lastSide` on a freshly armed mirror. PEER_TRY_START then guessed that
      // side for the acting panel's first try, and the side correction above fed
      // the guess back — flipping the acting panel onto the wrong side and
      // stranding its consumed try (both panels stuck at 0 / 3, peer-mirroring).
      const noTriesYet = bt.tries[1] === 0 && bt.tries[2] === 0;
      const lastSide = clock.running
        ? clock.side
        : bt.clockRunning
          ? (bt.turn ?? current.lastSide)
          : noTriesYet
            ? null
            : bt.turn !== null
              ? otherLane(bt.turn)
              : current.lastSide;
      // A try is consumed on start, so a panel whose clock is running has
      // already spent that side's try — while both ends agree a window is open,
      // a lower wire count is a mirror lagging by one (it anchors off
      // start_countdown but takes `used` from the selection), never a decrement.
      // A lagging echo that still reads `clockRunning: false` slips past this
      // and CAN roll the tally back; widening the guard to every wire clock
      // state was tried and measured worse, because a peer RESET's all-zero
      // wire is indistinguishable from a pre-start lag.
      const used = { 1: bt.tries[1], 2: bt.tries[2] };
      if (clock.running && bt.clockRunning) {
        used[clock.side] = Math.max(used[clock.side], current.used[clock.side]);
      }
      const next: TrySeriesState = { ...current, cap: bt.cap, used, lastSide, clock };
      // Value-guarded: an equal mirror returns the same store, so the
      // cross-panel selection echo dies out instead of re-rendering forever.
      const unchanged =
        store.series !== null &&
        store.series.cap === next.cap &&
        store.series.used[1] === next.used[1] &&
        store.series.used[2] === next.used[2] &&
        store.series.lastSide === next.lastSide &&
        store.series.clock === next.clock;
      return unchanged ? store : { ...store, series: next };
    }
    case 'PEER_TRY_START': {
      // A peer opened a try window: anchor the mirrored clock to the shared wire
      // epoch (`start_countdown.data.startedAt`, receipt fallback) with the wire
      // window (mid-window at snapshot catch-up), so both surfaces derive the
      // same remaining. Arms implicitly when disarmed (snapshot order: the
      // timer-3 clock precedes the selection) — cap/tally are corrected by the
      // PEER_SELECTION riding the same batch. The try is NOT consumed here:
      // `used` mirrors via the selection only.
      const current = store.series ?? initialTrySeries(DEFAULT_CAP);
      const side: PlayerId = current.clock.running
        ? current.clock.side
        : (current.lastSide ?? suggestedNext(current) ?? 1);
      return {
        ...store,
        series: {
          ...current,
          clock: { running: true, side, startedAt: action.startedAt, tryMs: action.remainingMs },
          lastSide: side,
        },
        effects: [...store.effects, { kind: 'audio', sound: 'short' }],
      };
    }
    case 'PEER_TRY_STOP': {
      if (store.series === null || !store.series.clock.running) {
        return store;
      }
      // The wire remaining is authoritative — it freezes the mirrored display
      // at the acting panel's value (the ~RTT drift of the local anchor dies).
      return {
        ...store,
        series: { ...store.series, clock: { running: false, endedMs: action.remainingMs } },
      };
    }
    case 'PEER_TRY_RESET': {
      // A peer's ARM/RESET/SET_TRY_MS (window broadcast) or DISARM (0). Freeze the
      // clock; adopt a real window as the next-try config. Never arms by itself.
      if (store.series === null) {
        return store;
      }
      return {
        ...store,
        series: {
          ...store.series,
          clock: { running: false, endedMs: null },
          tryMs: action.remainingMs > 0 ? action.remainingMs : store.series.tryMs,
        },
      };
    }
    default: {
      // The pure events only apply while armed.
      if (store.series === null) {
        return store;
      }
      const { state, effects } = reduce(store.series, action);
      return { ...store, series: state, effects: appendEffects(store.effects, effects) };
    }
  }
};

export const initialTrySeriesStore: TrySeriesStore = { series: null, context: null, effects: [] };

/**
 * Translate a peer panel's relayed `timerId 3` clock message into its PEER_TRY_*
 * action, stamped with the receipt wall clock (ADR 0038). Null for every other
 * channel/type — lanes mirror via `battleMachine.peerBattleEvent`, the warm-up
 * via page state. The break family never rides this channel.
 */
export const peerTryAction = (message: CountdownWSMessage, at: number): TrySeriesAction | null => {
  if (!('timerId' in message) || message.timerId !== BEST_TRICK_TIMER_ID) {
    return null;
  }
  switch (message.type) {
    case 'start_countdown':
      return {
        type: 'PEER_TRY_START',
        at,
        startedAt: message.data.startedAt ?? at,
        remainingMs: message.data.remainingMs,
      };
    case 'stop_countdown':
      return { type: 'PEER_TRY_STOP', remainingMs: message.data.remainingMs };
    case 'reset_countdown':
      return { type: 'PEER_TRY_RESET', remainingMs: message.data.remainingMs };
    default:
      return null;
  }
};
