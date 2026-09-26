/**
 * The `Countdown` display's internal clock machine — the pure core behind the
 * most-mounted timer leaf (HSM rules; the leaf-level completion of ADR 0032).
 * The domain truth is ONE discriminated union — the same
 * `CountdownDisplayState` shape the control page already hands a controlled
 * clock (rule 1: `running && onBreak`, `expired && onBreak` are
 * unrepresentable, and each variant carries only the fields valid in it) —
 * so a controlled `display` prop applies verbatim instead of being exploded
 * into booleans. Every other input is a pure `→ CountdownDisplayState`
 * mapper: wire messages via `clockFromMessage`, a recovered snapshot lane via
 * `clockFromRecovery`.
 *
 * Transitions are a pure `(store, event) → store` reducer (rule 3): no I/O,
 * no `Date.now()` — wall clock rides in on `at` — exhaustively switched with
 * `never` checks. The component's interval is plumbing at the edge: it
 * dispatches `TICK` and detects the zero-crossings (`RUN_ZERO`/`BREAK_ZERO`
 * + the onExpire/onBreakExpire callbacks); both crossings are guarded here so
 * a stale fire after a raced stop/apply is a no-op.
 */

import type {
  CountdownTimerRow,
  CountdownWSMessage,
  DistributiveOmit,
} from 'app/hooks/useWebSocket';
import type { CountdownDisplayState } from 'app/util/timerChannel';
import { remainingCeilSecond, remainingFrom } from 'app/util/time';

/**
 * The lane-scoped members of the countdown wire union — session-scoped
 * messages carry no `timerId` (ws-session-message-family) and never reach a
 * clock; the component's `'timerId' in message` filter narrows to exactly this.
 */
export type CountdownLaneMessage = Extract<
  DistributiveOmit<CountdownWSMessage, 'sessionId'>,
  { timerId: number }
>;

export interface ClockStore {
  /** The domain truth: which face the clock shows, with its wall-clock anchor. */
  state: CountdownDisplayState;
  /**
   * The live numeral (a display projection, rule 6 — never domain state): the
   * ticking clock's rendered ms — the run clock while `running`, the break
   * clock while `onBreak`. Seeded to the whole second IN PROGRESS (ceil) when
   * a state applies — a fresh anchor is a few ms old by then and `formatClock`
   * floors, so a raw seed would flash `01:59` for a `02:00` start — then
   * re-derived RAW from the same anchor per tick, so every receiver sharing a
   * wire anchor lands on the same whole second (the smear regression). The
   * static faces (idle budget, held run, expired 0) render off `state`.
   */
  liveMs: number;
}

export type ClockEvent =
  /** An input determined the whole next state (controlled display change, a
   * wire message, a recovered snapshot lane) — replace and re-seed. */
  | { type: 'APPLY'; state: CountdownDisplayState; at: number }
  /** A display tick: re-derive the live numeral off the state's anchor. */
  | { type: 'TICK'; at: number }
  /** The run clock crossed zero (detected at the edge, fired exactly once). */
  | { type: 'RUN_ZERO' }
  /** The break clock crossed zero: hold the run paused for a manual Start. */
  | { type: 'BREAK_ZERO' };

/** The live numeral a freshly applied state seeds with (whole-second ceil). */
const seed = (state: CountdownDisplayState, at: number): number => {
  switch (state.kind) {
    case 'idle':
      return state.remainingMs;
    case 'running':
      return remainingCeilSecond(state.remainingMs, state.startedAt, at);
    case 'onBreak':
      return remainingCeilSecond(state.breakMs, state.breakStartedAt, at);
    case 'expired':
      return 0;
    default:
      return ((_exhaustive: never): number => 0)(state);
  }
};

export const initClockStore = (state: CountdownDisplayState, at: number): ClockStore => ({
  state,
  liveMs: seed(state, at),
});

/** Pure transition. Same-value events return the SAME store (no re-render). */
export const reduceClock = (store: ClockStore, event: ClockEvent): ClockStore => {
  switch (event.type) {
    case 'APPLY': {
      const next = initClockStore(event.state, event.at);
      return next.state === store.state && next.liveMs === store.liveMs ? store : next;
    }
    case 'TICK': {
      const s = store.state;
      const liveMs =
        s.kind === 'running'
          ? remainingFrom(s.remainingMs, s.startedAt, event.at)
          : s.kind === 'onBreak'
            ? remainingFrom(s.breakMs, s.breakStartedAt, event.at)
            : store.liveMs;
      return liveMs === store.liveMs ? store : { ...store, liveMs };
    }
    case 'RUN_ZERO':
      return store.state.kind === 'running' ? { state: { kind: 'expired' }, liveMs: 0 } : store;
    case 'BREAK_ZERO':
      return store.state.kind === 'onBreak'
        ? {
            state: { kind: 'idle', remainingMs: store.state.heldMs },
            liveMs: store.state.heldMs,
          }
        : store;
    default:
      return ((_exhaustive: never): ClockStore => store)(event);
  }
};

/**
 * A frozen clock at a known remaining: spent means `expired` — an
 * authoritative stop at/below zero lands on the same face the local crossing
 * would show (`warmupChannel.restingClock` semantics), so surfaces converge
 * instead of racing the wire against their own tick.
 */
const resting = (remainingMs: number): CountdownDisplayState =>
  remainingMs <= 0 ? { kind: 'expired' } : { kind: 'idle', remainingMs };

/**
 * Wire message → next state (message-driven preview surfaces). `at` is the
 * receipt wall clock — the anchor fallback for a pre-feature sender that
 * omits the shared wire epoch (the old receipt-anchored behaviour).
 */
export const clockFromMessage = (
  message: CountdownLaneMessage,
  at: number,
): CountdownDisplayState => {
  switch (message.type) {
    case 'start_countdown':
      // Doubles as the break cancel (an early Start resumes the run).
      return {
        kind: 'running',
        remainingMs: message.data.remainingMs,
        startedAt: message.data.startedAt ?? at,
      };
    case 'stop_countdown':
      return resting(message.data.remainingMs);
    case 'reset_countdown':
      // An explicit re-arm — never expired, even at zero.
      return { kind: 'idle', remainingMs: message.data.remainingMs };
    case 'start_break':
      return {
        kind: 'onBreak',
        heldMs: message.data.runRemainingMs,
        breakMs: message.data.breakMs,
        breakStartedAt: message.data.startedAt ?? at,
        breaksLeft: message.data.breaksLeft,
      };
    case 'end_break':
      // Clear the break; hold the run paused (manual resume — operator Starts).
      return { kind: 'idle', remainingMs: message.data.runRemainingMs };
    default:
      return ((_exhaustive: never): CountdownDisplayState => ({ kind: 'expired' }))(message);
  }
};

/**
 * Recovered snapshot lane → state (peer-to-peer state recovery, preview
 * surfaces). Anchors prefer the shared send epoch on the row and fall back to
 * receipt (`at`). On break the run is held — the union cannot represent the
 * old bag's `isRunning && onBreak` combo (both clocks ticking at once). A
 * resting row at/below zero recovers as `expired` (`resting`, matching the
 * authoritative-stop mapping above): the row cannot carry the idle/expired
 * distinction, and rendering a spent budget as an idle 00:00 would clobber a
 * label face ('TIME'/'WARM-UP OVER') when a row refresh lands on a mounted
 * clock — the spent-row-counts-as-expired reading the athlete display already
 * applies.
 */
export const clockFromRecovery = (
  row: Omit<CountdownTimerRow, 'timerId'>,
  at: number,
): CountdownDisplayState => {
  if (row.onBreak) {
    return {
      kind: 'onBreak',
      heldMs: row.remainingMs,
      breakMs: row.breakRemainingMs ?? 0,
      breakStartedAt: row.breakStartedAt ?? at,
      breaksLeft: row.breaksLeft ?? 0,
    };
  }
  if (row.isRunning) {
    return { kind: 'running', remainingMs: row.remainingMs, startedAt: row.startedAt ?? at };
  }
  return resting(row.remainingMs);
};
