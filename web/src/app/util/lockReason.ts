/**
 * Why a race control is inert — **one map** (FREESTYLE_BOARD_UX §4.7), so the
 * button, its Tooltip and the handset that shares the same guard cannot word
 * the same lock two ways. Board-wide holds are not restated here: they carry
 * their `BoardHold` and render through `holdReason`, so a lane control and the
 * format controls it shares a blocker with read identically.
 *
 * The two `*Locks` functions are the interlock table itself: the button
 * `disabled` prop, the Tooltip and the gamepad guard all read one of these
 * fields, which is what keeps a screen press and a handset press inert at the
 * same instants (the audit found them diverging — S09/S23).
 */

import { holdReason, type BoardHold } from 'app/util/boardState';
import { canTakeBreak, type PlayerId } from 'app/util/breakState';
import type { TrySeriesState } from 'app/util/bestTrickSeries';
import type { LaneState } from 'app/util/battleMachine';
import { formatClock } from 'app/util/time';

/** A control-level lock: a board hold, or something only this control knows. */
export type Lock =
  | { kind: 'hold'; hold: BoardHold }
  | { kind: 'spent'; armedMs: number }
  | { kind: 'notRunning'; lane: PlayerId }
  | { kind: 'noBreaks'; lane: PlayerId }
  | { kind: 'triesSpent'; cap: number }
  | { kind: 'noTry' }
  | { kind: 'notArmed' };

export const lockReason = (lock: Lock): string => {
  switch (lock.kind) {
    case 'hold':
      return holdReason(lock.hold);
    case 'spent':
      return `budget spent — Reset re-arms ${formatClock(lock.armedMs)}`;
    case 'notRunning':
      return `Athlete ${lock.lane} is not running`;
    case 'noBreaks':
      return 'no breaks left';
    case 'triesSpent':
      return `all ${lock.cap} tries used`;
    case 'noTry':
      return 'no try is open';
    case 'notArmed':
      return 'best trick is not armed';
  }
};

const hold = (h: BoardHold): Lock => ({ kind: 'hold', hold: h });

export interface LaneLockInput {
  id: PlayerId;
  lane: LaneState;
  /** The lane a run is live on, or null — mutual exclusion, worded. */
  runningLane: PlayerId | null;
  /** A best-trick series is armed: the run board is done for this match. */
  bestTrickArmed: boolean;
}

/** Every lane control, with the lock that makes it inert (null = live). */
export interface LaneLocks {
  start: Lock | null;
  stop: Lock | null;
  reset: Lock | null;
  /** Quali's advisory break; in battle the same key ends the turn (= Stop). */
  takeBreak: Lock | null;
}

export const laneLocks = ({ id, lane, runningLane, bestTrickArmed }: LaneLockInput): LaneLocks => {
  // Precedence is the operator's reading order: the board-wide reason before
  // the lane's own, so a locked-out lane never blames its own phase for a lock
  // that belongs to the other lane or to best trick.
  const board =
    runningLane !== null && runningLane !== id
      ? hold({ kind: 'running', lane: runningLane })
      : bestTrickArmed
        ? hold({ kind: 'bestTrick' })
        : null;
  const running = lane.phase === 'running';

  return {
    // A break holds the run paused, so Start is the break cancel there
    // (ADR 0019 §2) — only a live run or a spent budget takes it away.
    start:
      board ??
      (running
        ? hold({ kind: 'running', lane: id })
        : lane.phase === 'finished'
          ? { kind: 'spent', armedMs: lane.armedMs }
          : null),
    stop: board ?? (running ? null : { kind: 'notRunning', lane: id }),
    // No exception for Reset (§4.7): the lanes are re-armed for the next match
    // after Leave best trick, so the series has one exit rather than a second
    // re-arm path reaching the clocks from behind the tries.
    reset: board,
    takeBreak:
      board ??
      (canTakeBreak(running, lane.breaksLeft)
        ? null
        : running
          ? { kind: 'noBreaks', lane: id }
          : { kind: 'notRunning', lane: id }),
  };
};

export interface ResetBothLockInput {
  lanes: Record<PlayerId, LaneState>;
  runningLane: PlayerId | null;
  bestTrickArmed: boolean;
}

/**
 * The score rail's `Reset lanes for the next match` (§4.9). It fires the two
 * per-lane RESETs, so it takes whatever locks either lane's own Reset — one
 * press cannot be live for a lane the board has closed. In practice that is the
 * board hold: while a series is armed the run board is re-armed *after* Leave
 * best trick (§4.7's one exit), and the rail foot is the other way to those
 * same clocks.
 *
 * The lanes' own phases are deliberately not a lock here: clearing a spent or a
 * fallen lane is what this button is for, and `laneResetNeedsConfirm` asks
 * about those (`resetGuard.ts`).
 */
export const resetBothLock = ({
  lanes,
  runningLane,
  bestTrickArmed,
}: ResetBothLockInput): Lock | null =>
  laneLocks({ id: 1, lane: lanes[1], runningLane, bestTrickArmed }).reset ??
  laneLocks({ id: 2, lane: lanes[2], runningLane, bestTrickArmed }).reset;

export interface BestTrickLockInput {
  /** The armed series, or null while the phase is off. */
  series: TrySeriesState | null;
  runningLane: PlayerId | null;
}

export interface BestTrickLocks {
  /** Arming the series (rendered only while disarmed). */
  begin: Lock | null;
  startTry: Record<PlayerId, Lock | null>;
  skip: Record<PlayerId, Lock | null>;
  endTry: Lock | null;
  /** The cap buttons and the try-window field — a live window owns both. */
  settings: Lock | null;
  /**
   * `Reset series` and `Leave best trick`. Best trick is the phase AFTER both
   * turns, so a live run holds them with the rest of the panel. An open try is
   * deliberately not one of their locks (§4.7 lists neither): both are the way
   * out of the series, `DISARM` stops the window with it, and what guards the
   * tally is the confirm they share (§4.8), not a lock.
   */
  series: Lock | null;
}

export const bestTrickLocks = ({ series, runningLane }: BestTrickLockInput): BestTrickLocks => {
  const laneRuns = runningLane === null ? null : hold({ kind: 'running', lane: runningLane });
  const tryOpen = series?.clock.running ? hold({ kind: 'tryOpen' }) : null;
  const side = (id: PlayerId): Lock | null => {
    if (laneRuns !== null) return laneRuns;
    // The panel renders Begin instead of these two while the series is off, but
    // the handset's orange key exists in every state and reads this map — so the
    // words live here, behind the run hold: Begin is the way past a missing
    // series, and a live run holds Begin shut too (§4.7 precedence).
    if (series === null) return { kind: 'notArmed' };
    if (tryOpen !== null) return tryOpen;
    if (series.used[id] >= series.cap) return { kind: 'triesSpent', cap: series.cap };
    return null;
  };

  return {
    begin: laneRuns,
    startTry: { 1: side(1), 2: side(2) },
    skip: { 1: side(1), 2: side(2) },
    endTry: tryOpen === null ? { kind: 'noTry' } : null,
    settings: laneRuns ?? tryOpen,
    series: laneRuns,
  };
};
