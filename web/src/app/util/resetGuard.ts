import { isPristine, laneRemainingMs, type LaneState } from 'app/util/battleMachine';
import type { TrySeriesState } from 'app/util/bestTrickSeries';
import type { PlayerId } from 'app/util/breakState';
import { formatClock } from 'app/util/time';

// ---- Speedline -------------------------------------------------------------
// Guard for the Speedline Reset action. Reset wipes the current run (start
// time, both lanes, displayed text) with no undo, and historically fired
// instantly from both the button and gamepad button 1 — including mid-race,
// where one stray press destroys a run in progress.
//
// `resetNeedsConfirm` is the single decision used by both the button and the
// gamepad path: a reset is "dangerous" (asks for confirmation) while the run
// is live — the start-light sequence is armed/running, or at least one lane is
// still timing. Once every lane has stopped the reset is the ordinary "clear for
// the next run" action and confirms instantly. The false-start state
// (signalPhase === -1) is the safe post-abort clear and does NOT need confirmation.
//
// Any positive phase counts as live, so this also covers PRE_BEEP_PHASE (0.5) —
// the armed T-5s window before the first light, where a stray reset would
// otherwise silently wipe the queued start.

export interface ResetGuardState {
  /** Current start-signal phase: 0 idle, 0.5 armed pre-beep, 1/2/3 the 3-2-1 lights, -1 false start. */
  signalPhase: number;
  /** Lanes still actively timing (0 once both have stopped). */
  runningTimerCount: number;
}

export const resetNeedsConfirm = ({ signalPhase, runningTimerCount }: ResetGuardState): boolean =>
  runningTimerCount > 0 || signalPhase > 0;

// ---- Freestyle -------------------------------------------------------------
// Two more no-undo Resets, here for the same reason as the Speedline one above:
// the button and the handset key must not diverge (FREESTYLE_BOARD_UX §4.8).

/**
 * A lane Reset asks whenever the lane holds a turn a re-arm would force the
 * athlete to **re-time**: running, paused on a break, or idle below what it was
 * armed to after a fall (`idle` alone is not the safe case).
 *
 * A **finished** lane is deliberately not one of them: it holds nothing to
 * re-time (freestyle records no time, the budget is spent) while its Reset is
 * the board's most-repeated press — it ends every quali athlete cycle and every
 * battle. A question there would train the operator to click through the one
 * that matters (FREESTYLE_BOARD_UX §4.8, rubric C04).
 */
export const laneResetNeedsConfirm = (lane: LaneState): boolean => {
  switch (lane.phase) {
    case 'running':
    case 'onBreak':
      return true;
    case 'finished':
      return false;
    case 'idle':
      return !isPristine(lane);
  }
};

/**
 * The best-trick tally is at risk once **any** try has been spent: a try is
 * consumed on start (`bestTrickSeries.ts`), so the per-side counts are the only
 * record that it happened — nothing restores them.
 *
 * Both series-wide presses ask on it, because both discard it: `Reset series`
 * (re-arm) and `Leave best trick` (`DISARM` drops the series outright, and the
 * next `ARM` starts a fresh tally). One question, one safe answer (§4.8).
 */
export const seriesTallyNeedsConfirm = (series: TrySeriesState): boolean =>
  series.used[1] > 0 || series.used[2] > 0;

/**
 * How a reset question names the turn it would cost: `Athlete 1 holds 02:28 of
 * 02:30` (FREESTYLE_BOARD_UX §4.8 — the text names the value at risk).
 *
 * Both confirms that re-arm a lane open on this clause — the card's own Reset
 * and the score rail's `Reset lanes for the next match`, which composes one per
 * holding lane (§4.9) — so the two cannot word the same risk two ways. Only the
 * clause is shared: each question's tail names its own reach, and §4.9 pins
 * both.
 *
 * `now` is the stamp the question was asked at; the lane comes from the store
 * at render, so a peer event landing mid-question restates the number.
 */
export const laneHoldsPhrase = (id: PlayerId, lane: LaneState, now: number): string =>
  `Athlete ${id} holds ${formatClock(laneRemainingMs(lane, now))} of ${formatClock(lane.armedMs)}`;
