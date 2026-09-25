/**
 * The Freestyle board's two named predicates (FREESTYLE_BOARD_UX §4.5), and the
 * one thing they are both derived from: **what the board is holding**.
 *
 * The page used to answer "is this safe?" three different ways — `isTimerRunning`
 * for the budget button, `running || breakOpen` for the mode toggle, `running ||
 * pause` for the leave guard — so the same board was live for one control and
 * idle for the next, and the disagreement was invisible (audit S06). Here one
 * pure `boardHold` walks the whole board in precedence order and returns the
 * first thing that would be destroyed, or null. Both predicates read that:
 *
 *  - `boardLive` — something is ticking (a run, a break, the changeover, the
 *    warm-up, an open try). Drives `useRunGuard`, the tab-close guard.
 *  - `boardHoldsState` — something is destroyable: `boardLive`, plus an armed
 *    best-trick series and any lane that is no longer pristine. Drives the mode
 *    toggle and `Set both lanes` — the two controls that re-arm both lanes.
 *  - `athleteHold` — the same walk with the warm-up taken out, for the one
 *    control a board-wide channel must not lock: `Swap athletes`.
 *
 * Because every live hold outranks every merely-destroyable one, `boardLive`
 * ⇒ `boardHoldsState` by construction: the two can never invert.
 *
 * `holdReason` renders that same hold as the operator's blocker line, so a
 * locked control and its Tooltip cannot disagree (the `advanceRoute` /
 * `advanceLabel` split).
 *
 * What is deliberately NOT an input: the Run (s) field. It is a draft until
 * `Set both lanes` applies it (§4.5/§4.6) — a lane's `armedMs` is what says
 * whether it holds anything, so typing a new budget cannot lock the very button
 * that applies it.
 */

import { isPristine, runningLane, type BattleState } from 'app/util/battleMachine';
import type { TrySeriesState } from 'app/util/bestTrickSeries';
import type { PlayerId } from 'app/util/breakState';
import type { FreestyleMode } from 'app/state/freestyleModeMemory';

/** Everything the predicates look at — the three timer owners plus the mode
 * (the changeover pause is anchored mode-free but rendered, and held, only on
 * the battle board — ADR 0036). */
export interface Board {
  mode: FreestyleMode;
  battle: BattleState;
  trySeries: TrySeriesState | null;
  warmupRunning: boolean;
}

/**
 * What holds the board, most urgent first. The first five are **live** (a clock
 * is ticking); the last three are state a re-arm would silently discard.
 */
export type BoardHold =
  | { kind: 'running'; lane: PlayerId }
  | { kind: 'onBreak'; lane: PlayerId }
  | { kind: 'tryOpen' }
  | { kind: 'changeover' }
  | { kind: 'warmup' }
  | { kind: 'bestTrick' }
  | { kind: 'held'; lane: PlayerId }
  | { kind: 'spent'; lane: PlayerId };

const LANES = [1, 2] as const;

/** The first thing the board is holding, or null when it is pristine and idle. */
export const boardHold = (board: Board): BoardHold | null => {
  const { battle, trySeries } = board;

  const lane = runningLane(battle);
  if (lane !== null) return { kind: 'running', lane };

  const breaking = LANES.find((id) => battle[id].phase === 'onBreak');
  if (breaking !== undefined) return { kind: 'onBreak', lane: breaking };

  if (trySeries?.clock.running) return { kind: 'tryOpen' };
  if (board.mode === 'battle' && battle.pauseStartedAt !== null) return { kind: 'changeover' };
  if (board.warmupRunning) return { kind: 'warmup' };
  if (trySeries !== null) return { kind: 'bestTrick' };

  const touched = LANES.find((id) => !isPristine(battle[id]));
  if (touched !== undefined) {
    return battle[touched].phase === 'finished'
      ? { kind: 'spent', lane: touched }
      : { kind: 'held', lane: touched };
  }
  return null;
};

/** The holds that mean a clock is ticking — everything above `bestTrick`. */
const LIVE_KINDS: ReadonlySet<BoardHold['kind']> = new Set([
  'running',
  'onBreak',
  'tryOpen',
  'changeover',
  'warmup',
]);

/** Something is ticking: leaving the page loses it. */
export const boardLive = (board: Board): boolean => {
  const hold = boardHold(board);
  return hold !== null && LIVE_KINDS.has(hold.kind);
};

/** Something is destroyable: re-arming both lanes would discard it. */
export const boardHoldsState = (board: Board): boolean => boardHold(board) !== null;

/**
 * What the board is holding **on an athlete slot** — the same walk with the warm-up
 * taken out. `Swap athletes` exchanges the two athletes and their score panels
 * but neither the two lane clocks nor the try tally, both of which are keyed by
 * slot, so every other hold misattributes a swap: mid-turn it moves the athlete
 * off the clock timing them, and a held/spent lane hands the next athlete a
 * budget that is already gone. The warm-up is the exception — a board-wide
 * channel bound to neither athlete, and running over exactly the minutes the
 * next pair is set up in, so it must not take the setup convenience away.
 *
 * Asked of the whole board rather than of `boardHold`'s answer, because warm-up
 * OUTRANKS `bestTrick`/`held`/`spent` in that walk: skipping the reported hold
 * would unlock a swap over a spent lane whenever a warm-up happened to run.
 */
export const athleteHold = (board: Board): BoardHold | null =>
  boardHold({ ...board, warmupRunning: false });

/** The blocker line under (and Tooltip on) a control this hold locks. */
export const holdReason = (hold: BoardHold): string => {
  switch (hold.kind) {
    case 'running':
      return `locked while Athlete ${hold.lane} runs`;
    case 'onBreak':
      return `locked while Athlete ${hold.lane} is on break`;
    case 'tryOpen':
      return 'locked while a try is open';
    case 'changeover':
      return 'locked during the changeover';
    case 'warmup':
      return 'locked during the warm-up';
    case 'bestTrick':
      return 'locked during best trick — Leave best trick first';
    case 'held':
      return `locked while Athlete ${hold.lane} holds time — Reset Athlete ${hold.lane} first`;
    case 'spent':
      return `locked once Athlete ${hold.lane} ran — Reset Athlete ${hold.lane} first`;
  }
};
