/**
 * The Freestyle cross-lane battle state machine (ADR 0032, respec'd by 0036).
 *
 * A single pure reducer that owns the two performance lanes' state, replacing
 * the triple-copied state that used to be smeared across the page
 * (`runningTimerId` + `laneStateRef`), each `CountdownControl` (local
 * `isRunning`/`remainingMs`/`startTime`/`breaksLeft` + a self-echo effect that
 * re-consumed the lane's own looped-back relay messages), and each `Countdown`
 * tick copy. Here the state lives in exactly one place; the controls and the
 * relay snapshot are derived from it.
 *
 * Design (per the HSM rules):
 *  - Lane state is a discriminated union on `phase` — illegal states (e.g. a
 *    break clock on an idle lane, a stop-time on a running lane) are
 *    unrepresentable.
 *  - The reducer is pure `(state, event) -> { state, effects }`: no I/O, no
 *    `Date.now()` (wall-clock arrives on the event as `at`), exhaustively
 *    switched with a `never` check. Side-effects (relay sends, audio) are
 *    returned as data for the edge to perform, never fired here.
 *  - It reuses `breakState.ts` verbatim (`takeBreak`, `canTakeBreak`) as its
 *    guard/transition helpers for the quali advisory break.
 *
 * Per-athlete active budgets are first-class (ADR 0019 §6): each lane carries a
 * `budgetMs` that persists across its turns (frozen on stop, resumed on the
 * next start), rather than being reconstructed from a held-remaining mirror.
 *
 * Battle has NO break clock (ADR 0036): a STOP (fall) / TIMEOUT just ends the
 * turn, and `pauseStartedAt` anchors the judge-facing changeover count-up —
 * control-local only, never relayed, not in the snapshot. It is set whenever a
 * turn ends while some lane still holds budget (a next turn is possible) and
 * cleared by the next START/RESET. The quali advisory break (TAKE_BREAK /
 * BREAK_ZERO, hold-at-zero) is the only break left.
 *
 * Warm-up (`timerId 0`) is an orthogonal channel outside this machine (ADR 0015
 * §1) and stays on the page. This module knows only lanes 1 and 2.
 */

import { MAX_BREAKS, canTakeBreak, takeBreak, type PlayerId } from 'app/util/breakState';
import type { CountdownSnapshot, CountdownWSMessage } from 'app/hooks/useWebSocket';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';
// The two shapes every timer channel speaks (`timerChannel`), re-exported here
// because the lane reducer is where a lane-side reader meets them.
import type { TimerEffect, CountdownDisplayState } from 'app/util/timerChannel';
export type { TimerEffect, CountdownDisplayState };
import { countdownLaneState, type CountdownControlRow } from 'app/util/timerSnapshot';
import { remainingFrom } from 'app/util/time';
import { appendEffects, drainEffects } from 'app/util/effectStore';

/**
 * One lane's state. `budgetMs` is the athlete's active budget (persists across
 * turns). A `running` lane anchors its budget to `startedAt` (wall clock) so the
 * live remaining is derived, never accumulated. An `onBreak` lane (quali
 * advisory only) holds its budget paused and runs a break clock anchored at
 * `breakStartedAt`. `finished` means the budget is spent (reached zero) — it
 * never re-enters `running` without a RESET.
 *
 * `armedMs` (ADR 0046 §2) is the budget the lane was last **armed** to — set by
 * RESET / PEER_RESET / SET_BUDGETS / PEER_SNAPSHOT and by nothing else, so
 * START/STOP/breaks spend `budgetMs` away from it and the gap is the evidence
 * that a turn was run. It rides every variant (a spent lane still knows what a
 * Reset would re-arm it to) and every snapshot row: the room owns it, not the
 * panel, because a panel holding a stale one re-arms the room to that stale
 * value on its next Reset (`laneFromSnapshot`).
 */
export type LaneState =
  | { phase: 'idle'; budgetMs: number; armedMs: number; breaksLeft: number }
  | { phase: 'running'; budgetMs: number; armedMs: number; startedAt: number; breaksLeft: number }
  | {
      phase: 'onBreak';
      budgetMs: number;
      armedMs: number;
      breakMs: number;
      breakStartedAt: number;
      breaksLeft: number;
    }
  | { phase: 'finished'; armedMs: number; breaksLeft: number };

/**
 * A lane with nothing to lose: idle at exactly the budget it was last armed to,
 * so no turn has been run off it since. The re-arm paths key off this — a
 * pristine lane can be re-armed without asking, a held one (idle *below* its
 * armed budget: a fall mid-turn) never silently (brief §4.5/§4.6).
 */
export const isPristine = (lane: LaneState): boolean =>
  lane.phase === 'idle' && lane.budgetMs === lane.armedMs;

/**
 * The two lanes plus the changeover pause anchor (ADR 0036): `pauseStartedAt`
 * is the wall-clock epoch of the last turn end while a next turn was still
 * possible, or null (no pause running / match over / a lane is live).
 * `lastRan` (ADR 0037) is the lane the last START fired on — it survives the
 * turn end (STOP/TIMEOUT) so the one-button ADVANCE can alternate, and clears
 * whenever a lane is re-armed (RESET, or a SET_BUDGETS that re-armed something —
 * a re-armed board restarts the cycle at lane 1). Like the pause anchor it is
 * control-local: never relayed, not in the snapshot — a panel joining mid-match
 * rebuilds it from PEER_SNAPSHOT / PEER_HINT instead (brief §4.11).
 */
export type BattleState = {
  1: LaneState;
  2: LaneState;
  pauseStartedAt: number | null;
  lastRan: PlayerId | null;
};

/** Events (domain verbs). Wall-clock time rides in on `at` so the reducer stays
 * pure — on the events whose transition needs it: the two mirrored *starts*
 * anchor to the wire epoch (`startedAt`, receipt-substituted upstream by
 * `peerBattleEvent`), so a receipt stamp beside it would be a field no arm
 * reads. `breakMs` (the quali advisory break length) is per-competition config
 * passed on the events that can open a break. The one-button ADVANCE press
 * (ADR 0037) is NOT an event here: `app/util/advanceRoute.ts` routes it to one
 * of these transitions, so the board can render the very event it will dispatch.
 *
 * The PEER_* family (ADR 0038) applies another control panel's relayed
 * countdown messages. A dedicated family — not an `origin: 'peer'` flag on the
 * local events — because the semantics differ: the wire values are the truth
 * (a peer stop's `remainingMs` overrides the local derivation, a peer start's
 * budget rides the message), the guards invert (last-writer-wins, not
 * operator-error rejection), and none of them may emit a `ws` effect — the
 * page's effect drain would re-broadcast and loop the panels. Audio effects
 * stay (ADR 0015 §3: every surface beeps), deduped on the prior phase so
 * the local expiry timers — which also arm off mirrored state — can't
 * double-beep. `lastRan`/`pauseStartedAt` never ride the wire (ADR 0036/0037),
 * so the peer transitions maintain each panel's own copies off the mirrored
 * START/STOP family. A panel joining mid-match saw no START to maintain them
 * from, so two transitions rebuild `lastRan` from what IS relayed: PEER_SNAPSHOT
 * (a lane running in the snapshot is the lane that last started) and PEER_HINT,
 * which inverts the `LiveSelection.nextUp` every board already broadcasts —
 * alternation recovers with no wire change (brief §4.11). */
export type BattleEvent =
  | { type: 'START'; lane: PlayerId; at: number }
  | { type: 'STOP'; lane: PlayerId; at: number }
  | { type: 'TIMEOUT'; lane: PlayerId; at: number }
  | { type: 'TAKE_BREAK'; lane: PlayerId; at: number; breakMs: number }
  | { type: 'BREAK_ZERO'; lane: PlayerId; at: number }
  | { type: 'RESET'; lane: PlayerId; budgetMs: number }
  | { type: 'SET_BUDGETS'; budgetMs: number }
  | { type: 'PEER_START'; lane: PlayerId; startedAt: number; remainingMs: number }
  | { type: 'PEER_STOP'; lane: PlayerId; at: number; remainingMs: number }
  | { type: 'PEER_RESET'; lane: PlayerId; remainingMs: number }
  | {
      type: 'PEER_BREAK_START';
      lane: PlayerId;
      startedAt: number;
      runRemainingMs: number;
      breakMs: number;
      breaksLeft: number;
    }
  | { type: 'PEER_BREAK_END'; lane: PlayerId; runRemainingMs: number }
  | { type: 'PEER_SNAPSHOT'; at: number; timers: CountdownSnapshot['timers'] }
  | { type: 'PEER_HINT'; nextUp: PlayerId | null; mode: FreestyleMode };

export interface BattleResult {
  state: BattleState;
  effects: TimerEffect[];
}

/** The lane currently running, or null — derived, not stored (single owner). */
export const runningLane = (state: BattleState): PlayerId | null => {
  if (state[1].phase === 'running') return 1;
  if (state[2].phase === 'running') return 2;
  return null;
};

export const otherLane = (lane: PlayerId): PlayerId => (lane === 1 ? 2 : 1);

/**
 * The lane a battle ADVANCE would start next (ADR 0037) — a pure *suggestion*
 * consumed by the press (and the board's "Next:" hint), never routing: the
 * other lane than the one that last ran unless it is spent, else the same lane
 * unless spent, else null (both budgets spent = battle over). Before anything
 * ran, lane 1 leads (participant A first).
 */
export const advanceTarget = (state: BattleState): PlayerId | null => {
  const candidates: PlayerId[] =
    state.lastRan === null ? [1, 2] : [otherLane(state.lastRan), state.lastRan];
  return candidates.find((lane) => state[lane].phase !== 'finished') ?? null;
};

/**
 * Whether the next turn goes back to the lane that just took one — the partner
 * is spent, so the ADVANCE cycle stops alternating and nobody changes over.
 * The board's two "between turns" surfaces (the plate's state word, the gutter
 * caption) read it from here, so the gap the plate promised as `start … again`
 * cannot be announced as a handover a press later.
 */
export const sameLaneAgain = (state: BattleState): boolean =>
  state.lastRan !== null && advanceTarget(state) === state.lastRan;

/** The initial state: both lanes idle at (and armed to) the per-athlete budget. */
export const initialBattleState = (budgetMs: number, breaksLeft: number): BattleState => ({
  1: { phase: 'idle', budgetMs, armedMs: budgetMs, breaksLeft },
  2: { phase: 'idle', budgetMs, armedMs: budgetMs, breaksLeft },
  pauseStartedAt: null,
  lastRan: null,
});

/** The live remaining of a lane at wall-clock `now` — derived from its anchor,
 * never accumulated. Idle/finished lanes report their stored budget (0 when
 * finished). */
export const laneRemainingMs = (lane: LaneState, now: number): number => {
  switch (lane.phase) {
    case 'idle':
      return lane.budgetMs;
    case 'running':
      return remainingFrom(lane.budgetMs, lane.startedAt, now);
    case 'onBreak':
      return lane.budgetMs;
    case 'finished':
      return 0;
  }
};

/**
 * One lane's contribution to a `request_state` snapshot (ADR 0011). The reducer
 * state IS the snapshot source (replacing the old `laneStateRef`): the builder
 * (`buildCountdownSnapshot`) adjusts a running lane for wall-clock elapsed at
 * send, so a running lane hands over its budget + anchor unadjusted here. An
 * `onBreak` lane hands over the paused budget plus the break clock so a quali
 * mid-break reconnect resumes (gotcha §4.3). The pause anchor is deliberately
 * NOT here — it is control-local judge information (ADR 0036).
 *
 * The row shape is the canonical `CountdownControlRow` (timerSnapshot) — the
 * same pre-send builder-input shape `buildCountdownSnapshot` consumes, so this
 * producer and that consumer share one definition.
 */
export const laneSnapshot = (timerId: PlayerId, lane: LaneState): CountdownControlRow => {
  // Every phase hands over `breaksLeft` AND `armedMs` (not only onBreak / not
  // only idle), so a panel joining mid-quali-run adopts the true remaining
  // allowance instead of assuming the full one until the next relayed
  // start_break, and adopts the room's armed budget instead of its own format
  // default — a joiner that kept its default would read a mirrored lane as held
  // and re-arm the whole room to that default on its next Reset (ADR 0046 §2).
  switch (lane.phase) {
    case 'idle':
      return {
        timerId,
        lastRemainingMs: lane.budgetMs,
        isRunning: false,
        startedAt: null,
        armedMs: lane.armedMs,
        breaksLeft: lane.breaksLeft,
      };
    case 'running':
      return {
        timerId,
        lastRemainingMs: lane.budgetMs,
        isRunning: true,
        startedAt: lane.startedAt,
        armedMs: lane.armedMs,
        breaksLeft: lane.breaksLeft,
      };
    case 'onBreak':
      return {
        timerId,
        lastRemainingMs: lane.budgetMs,
        isRunning: false,
        startedAt: null,
        onBreak: true,
        breakMs: lane.breakMs,
        breakStartedAt: lane.breakStartedAt,
        armedMs: lane.armedMs,
        breaksLeft: lane.breaksLeft,
      };
    case 'finished':
      return {
        timerId,
        lastRemainingMs: 0,
        isRunning: false,
        startedAt: null,
        armedMs: lane.armedMs,
        breaksLeft: lane.breaksLeft,
      };
  }
};

/** One lane's controlled display, derived from its machine state (rule 2). */
export const laneDisplay = (lane: LaneState): CountdownDisplayState => {
  switch (lane.phase) {
    case 'idle':
      return { kind: 'idle', remainingMs: lane.budgetMs };
    case 'running':
      return { kind: 'running', remainingMs: lane.budgetMs, startedAt: lane.startedAt };
    case 'onBreak':
      return {
        kind: 'onBreak',
        heldMs: lane.budgetMs,
        breakMs: lane.breakMs,
        breakStartedAt: lane.breakStartedAt,
        breaksLeft: lane.breaksLeft,
      };
    case 'finished':
      return { kind: 'expired' };
  }
};

/** A lane's held budget as a plain number (a finished lane holds nothing). */
const laneBudget = (lane: LaneState): number => (lane.phase === 'finished' ? 0 : lane.budgetMs);

/** Replace one lane, leaving the rest untouched. */
const withLane = (state: BattleState, lane: PlayerId, next: LaneState): BattleState => ({
  ...state,
  [lane]: next,
});

/*
 * Lane-state builders shared by each local transition and its PEER twin
 * (ADR 0038). The twins legitimately differ in value source (local derivation
 * vs the authoritative wire), guards, and effect list — but the state they
 * build is one definition, so local and peer can't drift.
 */

/** Begin a turn: the lane runs anchored at `startedAt`, the changeover pause
 * (if any) ends, and ADVANCE remembers the runner (ADR 0037). Shared by START
 * and PEER_START (which anchors to the wire epoch and rides the wire budget). */
const beginTurn = (
  state: BattleState,
  lane: PlayerId,
  budgetMs: number,
  startedAt: number,
): BattleState => ({
  ...withLane(state, lane, {
    phase: 'running',
    budgetMs,
    armedMs: state[lane].armedMs,
    startedAt,
    breaksLeft: state[lane].breaksLeft,
  }),
  pauseStartedAt: null,
  lastRan: lane,
});

/** A lane after its turn ended: finished when the budget is spent, else idle
 * holding the frozen remaining. Shared by endTurn and PEER_STOP. */
const stoppedLane = (remainingMs: number, armedMs: number, breaksLeft: number): LaneState =>
  remainingMs <= 0
    ? { phase: 'finished', armedMs, breaksLeft }
    : { phase: 'idle', budgetMs: remainingMs, armedMs, breaksLeft };

/** Whether a next turn is still possible after `lane` stops at `remainingMs` —
 * some lane still holds budget; both-spent means match over, no changeover
 * pause (ADR 0036). Shared by endTurn and PEER_STOP. */
const nextTurnPossible = (state: BattleState, lane: PlayerId, remainingMs: number): boolean =>
  remainingMs > 0 || laneBudget(state[otherLane(lane)]) > 0;

/** Re-arm a lane to `budgetMs` with a fresh allowance; the pause and the
 * ADVANCE cycle restart. The new budget becomes the lane's `armedMs`, so the
 * lane reads pristine again. RESET, PEER_RESET and SET_BUDGETS' per-lane re-arm
 * differ only in who broadcasts and which lanes they touch. */
const resetLane = (state: BattleState, lane: PlayerId, budgetMs: number): BattleState => ({
  ...withLane(state, lane, {
    phase: 'idle',
    budgetMs,
    armedMs: budgetMs,
    breaksLeft: MAX_BREAKS,
  }),
  pauseStartedAt: null,
  lastRan: null,
});

/** A lane on the quali advisory break: budget held at `budgetMs`, the break
 * clock anchored at `breakStartedAt`. Shared by TAKE_BREAK and PEER_BREAK_START. */
const breakLane = (
  budgetMs: number,
  armedMs: number,
  breakMs: number,
  breakStartedAt: number,
  breaksLeft: number,
): LaneState => ({ phase: 'onBreak', budgetMs, armedMs, breakMs, breakStartedAt, breaksLeft });

/** A lane held paused after its break ended, awaiting the manual Start
 * (ADR 0036). Shared by BREAK_ZERO and PEER_BREAK_END. */
const endBreakLane = (budgetMs: number, armedMs: number, breaksLeft: number): LaneState => ({
  phase: 'idle',
  budgetMs,
  armedMs,
  breaksLeft,
});

/**
 * End a lane's turn (a fall on STOP, or a TIMEOUT). Freezes the spent budget,
 * marks the lane finished when the budget hit zero, broadcasts the stop, and
 * anchors the changeover pause iff a next turn is still possible. No break is
 * opened and nothing auto-resumes.
 */
const endTurn = (
  state: BattleState,
  lane: PlayerId,
  remainingMs: number,
  at: number,
  stopEffects: TimerEffect[],
): BattleResult => ({
  state: {
    ...withLane(state, lane, stoppedLane(remainingMs, state[lane].armedMs, state[lane].breaksLeft)),
    pauseStartedAt: nextTurnPossible(state, lane, remainingMs) ? at : null,
  },
  effects: [
    ...stopEffects,
    {
      kind: 'ws',
      message: { type: 'stop_countdown', timerId: lane, data: { remainingMs } },
    },
  ],
});

/**
 * The pure transition. `(state, event) -> { state, effects }` — exhaustive over
 * the event union, `never`-checked, no I/O. Guards reuse `breakState.ts`.
 */
export const reduce = (state: BattleState, event: BattleEvent): BattleResult => {
  switch (event.type) {
    case 'START': {
      const lane = state[event.lane];
      // Guard: never start over the other lane's live run, and never re-anchor
      // an already-running clock (a gamepad double-press). A finished lane can't
      // start (no budget). Start doubles as the break cancel (ADR 0019 §2).
      if (runningLane(state) === otherLane(event.lane)) {
        return { state, effects: [] };
      }
      if (lane.phase === 'running' || lane.phase === 'finished') {
        return { state, effects: [] };
      }
      const budgetMs = lane.budgetMs;
      return {
        state: beginTurn(state, event.lane, budgetMs, event.at),
        effects: [
          {
            kind: 'ws',
            message: {
              type: 'start_countdown',
              timerId: event.lane,
              // The shared wire anchor (the lane's wall-clock start), so every
              // receiver derives off one epoch instead of its own receipt time.
              data: { remainingMs: budgetMs, startedAt: event.at },
            },
          },
        ],
      };
    }

    case 'STOP': {
      const lane = state[event.lane];
      // Only a running lane can be stopped (a fall). Freeze the derived budget.
      if (lane.phase !== 'running') {
        return { state, effects: [] };
      }
      const remainingMs = laneRemainingMs(lane, event.at);
      return endTurn(state, event.lane, remainingMs, event.at, []);
    }

    case 'TIMEOUT': {
      const lane = state[event.lane];
      // The active clock crossed zero mid-performance. Long beep (rule F7),
      // budget spent.
      if (lane.phase !== 'running') {
        return { state, effects: [] };
      }
      return endTurn(state, event.lane, 0, event.at, [{ kind: 'audio', sound: 'long' }]);
    }

    case 'TAKE_BREAK': {
      const lane = state[event.lane];
      // Quali advisory break: only while running and with allowance left. Freeze
      // the budget, decrement the allowance, hold the lane paused (manual resume).
      if (lane.phase !== 'running') {
        return { state, effects: [] };
      }
      if (!canTakeBreak(true, lane.breaksLeft)) {
        return { state, effects: [] };
      }
      const runRemainingMs = laneRemainingMs(lane, event.at);
      const result = takeBreak(runRemainingMs, event.breakMs, lane.breaksLeft);
      return {
        state: withLane(
          state,
          event.lane,
          breakLane(runRemainingMs, lane.armedMs, event.breakMs, event.at, result.breaksLeft),
        ),
        effects: [
          { kind: 'audio', sound: 'short' },
          {
            kind: 'ws',
            message: {
              type: 'start_break',
              timerId: event.lane,
              data: {
                runRemainingMs,
                breakMs: result.breakMs,
                breaksLeft: result.breaksLeft,
                // Shared break-clock anchor (the break's wall-clock start).
                startedAt: event.at,
              },
            },
          },
        ],
      };
    }

    case 'BREAK_ZERO': {
      const lane = state[event.lane];
      if (lane.phase !== 'onBreak') {
        return { state, effects: [] };
      }
      // The advisory break expired: `alert2` — its own tone, so break-over is
      // never mistaken for a run reaching zero (`long`, audit S14). The lane
      // holds paused for a manual Start (end_break); nothing auto-resumes
      // (ADR 0036).
      return {
        state: withLane(
          state,
          event.lane,
          endBreakLane(lane.budgetMs, lane.armedMs, lane.breaksLeft),
        ),
        effects: [
          { kind: 'audio', sound: 'alert2' },
          {
            kind: 'ws',
            message: {
              type: 'end_break',
              timerId: event.lane,
              data: { runRemainingMs: lane.budgetMs },
            },
          },
        ],
      };
    }

    case 'RESET': {
      return {
        state: resetLane(state, event.lane, event.budgetMs),
        effects: [
          {
            kind: 'ws',
            message: {
              type: 'reset_countdown',
              timerId: event.lane,
              data: { remainingMs: event.budgetMs },
            },
          },
        ],
      };
    }

    case 'SET_BUDGETS': {
      // Re-arm to a new default budget (the "Set both lanes" action / the mode
      // switch), but only where nothing is lost: a **pristine** lane. "Idle" was
      // not enough — a lane held after a fall is idle too (`stoppedLane`), so
      // the old re-arm silently discarded a run the operator had to re-time.
      // Live, on-break and spent lanes are likewise left alone, which makes the
      // guard the reducer's own rather than the caller's.
      // Each re-armed lane broadcasts the `reset_countdown` RESET already sends,
      // so peers apply PEER_RESET and the preview mirrors — no wire change.
      const reArmed: PlayerId[] = ([1, 2] as const).filter((lane) => isPristine(state[lane]));
      return {
        state: reArmed.reduce((acc, lane) => resetLane(acc, lane, event.budgetMs), state),
        effects: reArmed.map((lane): TimerEffect => ({
          kind: 'ws',
          message: {
            type: 'reset_countdown',
            timerId: lane,
            data: { remainingMs: event.budgetMs },
          },
        })),
      };
    }

    case 'PEER_START': {
      // A peer panel started this lane: mirror it verbatim, anchored to the
      // shared wire epoch (`start_countdown.data.startedAt`) so this panel
      // derives the identical remaining the acting panel does — no per-receipt
      // skew (`peerBattleEvent` substitutes receipt for a pre-feature sender
      // that omits it). Applied unguarded (last-writer-wins, ADR 0038 §4).
      return {
        state: beginTurn(state, event.lane, event.remainingMs, event.startedAt),
        effects: [],
      };
    }

    case 'PEER_STOP': {
      // A peer ended this lane's turn. The wire remaining is authoritative
      // (freezes any sub-RTT drift of the local mirror). The changeover pause
      // only applies when the lane was live HERE — a duplicate stop (both
      // panels' expiry timers fire the same crossing) must not re-anchor the
      // judge count-up. The run-zero horn is NOT mirrored: it sounds on the
      // panel whose own clock crossed zero (TIMEOUT), so two panels at one
      // judges' desk are one horn, not two. Ownership, not dedupe — the relay
      // carries no presence to dedupe with (ADR 0038); the header's
      // `Sound on this panel` chip moves it when the PA hangs off the other
      // panel. Venue surfaces keep beeping on every channel (ADR 0015 §3).
      const wasRunning = state[event.lane].phase === 'running';
      const pauseStartedAt = wasRunning
        ? nextTurnPossible(state, event.lane, event.remainingMs)
          ? event.at
          : null
        : state.pauseStartedAt;
      return {
        state: {
          ...withLane(
            state,
            event.lane,
            stoppedLane(event.remainingMs, state[event.lane].armedMs, state[event.lane].breaksLeft),
          ),
          pauseStartedAt,
        },
        effects: [],
      };
    }

    case 'PEER_RESET': {
      // Mirror of RESET without the broadcast (the peer already broadcast it).
      return { state: resetLane(state, event.lane, event.remainingMs), effects: [] };
    }

    case 'PEER_BREAK_START': {
      // A peer opened the quali advisory break: mirror the held budget, the
      // break window (anchored to the shared wire epoch, receipt fallback) and
      // the wire allowance. Short beep (every surface beeps on break open),
      // deduped if already on break.
      const wasOnBreak = state[event.lane].phase === 'onBreak';
      return {
        state: withLane(
          state,
          event.lane,
          breakLane(
            event.runRemainingMs,
            state[event.lane].armedMs,
            event.breakMs,
            event.startedAt,
            event.breaksLeft,
          ),
        ),
        effects: wasOnBreak ? [] : [{ kind: 'audio', sound: 'short' }],
      };
    }

    case 'PEER_BREAK_END': {
      // A peer's break expired. No-op unless on break HERE: the local
      // BREAK_ZERO usually loses the race only by ~RTT, and when it won, the
      // lane is already idle. Silent for the same reason PEER_STOP is: the
      // break-over horn belongs to the panel whose own break clock ran out.
      const lane = state[event.lane];
      if (lane.phase !== 'onBreak') {
        return { state, effects: [] };
      }
      return {
        state: withLane(
          state,
          event.lane,
          endBreakLane(event.runRemainingMs, lane.armedMs, lane.breaksLeft),
        ),
        effects: [],
      };
    }

    case 'PEER_SNAPSHOT': {
      // Catch-up hydration off a peer's state_snapshot (mirror-on-open, gated
      // live-beats-snapshot upstream). `pauseStartedAt` stays — it is
      // control-local and not in the snapshot (ADR 0036/0037)…
      const hydrate = (laneId: PlayerId): LaneState => {
        const timer = event.timers.find((t) => t.timerId === laneId);
        return timer ? laneFromSnapshot(timer, event.at, state[laneId]) : state[laneId];
      };
      const hydrated = { ...state, 1: hydrate(1), 2: hydrate(2) };
      // ...except the one `lastRan` the snapshot does imply: a lane running in
      // it is the lane that last started, so the joiner's next press after that
      // turn ends alternates instead of re-targeting lane 1 (brief §4.11).
      const live = runningLane(hydrated);
      return {
        state: live === null ? hydrated : { ...hydrated, lastRan: live },
        effects: [],
      };
    }

    case 'PEER_HINT': {
      // The room's `nextUp` names the lane that has NOT run, so its other lane
      // is `lastRan` — the whole of the rejoin recovery, off a field the board
      // already relays. Three guards (brief §4.11): a room with nothing to
      // suggest says `null`; quali has no alternation to reproduce; and a live
      // turn already owns `lastRan` locally (the mirrored START set it), so a
      // hint minted before that START must not walk it back.
      if (event.nextUp === null || event.mode !== 'battle' || runningLane(state) !== null) {
        return { state, effects: [] };
      }
      // Every relayed selection re-carries `nextUp`, so most hints say what this
      // panel already holds: keep the identity and the board doesn't re-render.
      const lastRan = otherLane(event.nextUp);
      return state.lastRan === lastRan
        ? { state, effects: [] }
        : { state: { ...state, lastRan }, effects: [] };
    }

    default: {
      return ((_exhaustive: never): BattleResult => ({ state, effects: [] }))(event);
    }
  }
};

/**
 * One snapshot timer as a lane state (PEER_SNAPSHOT). A running lane's
 * remaining was epoch-adjusted at send and the send epoch rides on `startedAt`,
 * so it anchors to that shared wire epoch (every joiner converges) rather than
 * to its own receipt time; a pre-feature snapshot omits it and falls back to
 * receipt (`at`). An on-break lane resumes the break window anchored the same
 * way. The wire `breaksLeft` is authoritative in every phase (the snapshot
 * source carries it whether or not the lane is on break); only a pre-feature
 * peer omits it, in which case the local allowance stands until the next
 * relayed break. The wire `armedMs` is authoritative the same way (ADR 0046 §2):
 * the room owns the armed budget, and a joiner that kept its own format default
 * would read a mirrored lane as held — locking its format controls, and, worse,
 * broadcasting THAT default on its next Reset, which every peer applies as
 * PEER_RESET. A pre-feature peer omits it, and only an **idle** lane has a safe
 * fallback: its remaining IS an armed budget, so the lane reads pristine rather
 * than inventing a held turn. Running / on-break / finished carry a spent-down
 * remaining (0 when finished), which says nothing about the armed value, so
 * there the local one stands until the next re-arm.
 */
const laneFromSnapshot = (
  timer: CountdownSnapshot['timers'][number],
  at: number,
  local: LaneState,
): LaneState => {
  const t = countdownLaneState(timer);
  const breaksLeft = t.breaksLeft ?? local.breaksLeft;
  const armedMs = t.armedMs ?? local.armedMs;
  if (t.onBreak) {
    return {
      phase: 'onBreak',
      budgetMs: t.remainingMs,
      armedMs,
      breakMs: t.breakRemainingMs ?? 0,
      breakStartedAt: t.breakStartedAt ?? at,
      breaksLeft,
    };
  }
  if (t.isRunning) {
    return {
      phase: 'running',
      budgetMs: t.remainingMs,
      armedMs,
      startedAt: t.startedAt ?? at,
      breaksLeft,
    };
  }
  if (t.remainingMs <= 0) {
    return { phase: 'finished', armedMs, breaksLeft };
  }
  // The idle fallback: with no wire value, the lane's own budget is the only
  // honest answer to "what would a Reset re-arm this to?".
  return {
    phase: 'idle',
    budgetMs: t.remainingMs,
    armedMs: t.armedMs ?? t.remainingMs,
    breaksLeft,
  };
};

/**
 * Translate a peer panel's relayed lane message (timerId 1/2) into its
 * PEER_* event, stamped with the receipt wall clock. Returns null for the
 * warm-up (0) and best-trick (3) channels and for session-scoped messages —
 * those mirror elsewhere (page state / `bestTrickSeries.peerTryAction`). Pure,
 * so the wire→event table is unit-testable off the page.
 */
export const peerBattleEvent = (message: CountdownWSMessage, at: number): BattleEvent | null => {
  if (!('timerId' in message) || (message.timerId !== 1 && message.timerId !== 2)) {
    return null;
  }
  const lane: PlayerId = message.timerId;
  switch (message.type) {
    case 'start_countdown':
      return {
        type: 'PEER_START',
        lane,
        // Prefer the shared wire anchor; a pre-feature sender omits it, so fall
        // back to receipt (`at`) — the old ~RTT-anchored behaviour.
        startedAt: message.data.startedAt ?? at,
        remainingMs: message.data.remainingMs,
      };
    case 'stop_countdown':
      return { type: 'PEER_STOP', lane, at, remainingMs: message.data.remainingMs };
    case 'reset_countdown':
      return { type: 'PEER_RESET', lane, remainingMs: message.data.remainingMs };
    case 'start_break':
      return {
        type: 'PEER_BREAK_START',
        lane,
        startedAt: message.data.startedAt ?? at,
        runRemainingMs: message.data.runRemainingMs,
        breakMs: message.data.breakMs,
        breaksLeft: message.data.breaksLeft,
      };
    case 'end_break':
      return { type: 'PEER_BREAK_END', lane, runRemainingMs: message.data.runRemainingMs };
  }
};

/**
 * `useReducer` adapter. The store carries the pure `battle` state plus a queue of
 * pending `effects` for the edge to drain (effects-as-data, so the transition
 * itself stays pure and the drain is order-independent even if several events
 * land before a render). A `DRAIN` action clears the queue after the edge has
 * performed it.
 */
export interface BattleStore {
  battle: BattleState;
  effects: TimerEffect[];
}

export type BattleAction = BattleEvent | { type: 'DRAIN' };

export const battleReducer = (store: BattleStore, action: BattleAction): BattleStore => {
  if (action.type === 'DRAIN') {
    return drainEffects(store);
  }
  const { state, effects } = reduce(store.battle, action);
  return { battle: state, effects: appendEffects(store.effects, effects) };
};

export const initialBattleStore = (budgetMs: number, breaksLeft: number): BattleStore => ({
  battle: initialBattleState(budgetMs, breaksLeft),
  effects: [],
});
