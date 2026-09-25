/**
 * Why a Speedline race control is inert — **one map**, the Freestyle board's
 * §4.7 interlock table applied to the second desk (FREESTYLE_BOARD_UX §7, the
 * P3 sibling note). The button's `disabled`, the why-line printed under it and
 * the handset guard all read the same field, which is what keeps a screen press
 * and a buzzer press inert at the same instants.
 *
 * The map renders the operator's words rather than a lock union: the Speedline
 * board has one consumer and its vocabulary is the manual's ("Lane 1", not
 * "Player 1"), so the words live here and the page holds no mapping code.
 */

import type { SpeedlineLaneState } from 'app/util/timerSnapshot';

export type LaneId = 1 | 2;

/**
 * How long after the LAST lane stops a mis-pressed Stop can still be undone
 * (`speedline-resume-stopped-lane`). The other lane still running is what
 * normally says the run is live; a solo quali run has no second clock, so the
 * window is a grace instead — long enough for the operator to see the frozen
 * numeral and reach the button, short enough that the run is plainly over
 * before it closes and Void takes over.
 */
export const RESUME_GRACE_MS = 10_000;

/** What a control is waiting for, most urgent first. */
type SpeedlineLock =
  | { kind: 'offline' }
  | { kind: 'lights' }
  | { kind: 'racing' }
  | { kind: 'aborted' }
  | { kind: 'spent' }
  | { kind: 'noSequence' }
  | { kind: 'laneIdle'; lane: LaneId }
  | { kind: 'laneNotStopped'; lane: LaneId }
  | { kind: 'runDead' };

const reason = (lock: SpeedlineLock): string => {
  switch (lock.kind) {
    case 'offline':
      return 'locked while the console is not connected';
    case 'lights':
      return 'locked while the start sequence runs';
    case 'racing':
      return 'locked while a lane runs';
    case 'aborted':
      return 'start aborted — Reset to re-arm';
    case 'spent':
      return 'sequence finished — Reset to re-arm';
    case 'noSequence':
      return 'no start sequence to abort';
    case 'laneIdle':
      return `Lane ${lock.lane} is not running`;
    case 'laneNotStopped':
      return `Lane ${lock.lane} is not stopped`;
    case 'runDead':
      return 'run has resolved — Void or re-run instead';
  }
};

const line = (lock: SpeedlineLock | null): string | null => (lock === null ? null : reason(lock));

export interface SpeedlineLockInput {
  /** The relay socket is OPEN. */
  connected: boolean;
  /** The board's EFFECTIVE start-light phase — a mirrored peer sequence gates
   * this panel exactly like a local one (ADR 0038); -1 is a sequence that has
   * ENDED, either way (see `aborted`). */
  signalPhase: number;
  /**
   * Whether the -1 the board holds is an ABORT rather than a sequence run to
   * its end. The schedule's terminal phase and the abort latch are the same
   * wire value (`useStartSignalTimer`, and changing that is a protocol change),
   * so the distinction rides beside it: without it the board blamed a start
   * abort after every clean run (`speedline-lock-says-aborted-after-a-clean-run`).
   * Both wordings wait on the same Reset — only what the operator is told differs.
   */
  aborted: boolean;
  /** The clock the time-bounded locks are graded against (the resume grace).
   * Passed in rather than read here so the map stays pure and the page owns
   * when it re-derives — one timer at the window's close, not a ticker. */
  now: number;
  laneState: Record<LaneId, SpeedlineLaneState>;
}

/** Every race control, with the reason it is inert (null = live). */
export interface SpeedlineLocks {
  start: string | null;
  abort: string | null;
  reset: string | null;
  stop: Record<LaneId, string | null>;
  /** The result rail's lane swap. It is in this map because it is interlocked
   * by the race — the stopwatches are lane-fixed, so a swap under a live run
   * would attribute the running clocks to the wrong athletes at stop — and a
   * control the race locks owes the same why-line as the rest (§4.7). */
  swap: string | null;
  /** Per-lane undo of a mis-pressed Stop (`speedline-resume-stopped-lane`).
   * Graded by the run, like `stop` and `swap` — a dead link may not take it
   * either: the athlete it un-freezes is still on the line. */
  resume: Record<LaneId, string | null>;
}

/**
 * When the resume window closes, or null while nothing bounds it — a lane is
 * still away (the run is live by the clock), or no lane has stopped at all.
 * Exported so the page can arm ONE timer at that instant instead of ticking.
 */
export const resumeWindowDeadline = (
  laneState: Record<LaneId, SpeedlineLaneState>,
): number | null => {
  const stops = ([1, 2] as const).flatMap((lane) => {
    const state = laneState[lane];
    if (state.kind === 'running') return [Number.POSITIVE_INFINITY];
    return state.kind === 'finished' ? [state.stopTime] : [];
  });
  if (stops.length === 0) return null;
  const last = Math.max(...stops);
  return Number.isFinite(last) ? last + RESUME_GRACE_MS : null;
};

export const speedlineLocks = ({
  connected,
  signalPhase,
  aborted,
  now,
  laneState,
}: SpeedlineLockInput): SpeedlineLocks => {
  const isRunning = (lane: LaneId) => laneState[lane].kind === 'running';
  // A lane Stop is the one control the link may not take away: the clocks are
  // browser-local (§4.13), so a reconnecting relay must not strand a finishing
  // athlete on a dead button.
  const stop = {
    1: line(isRunning(1) ? null : { kind: 'laneIdle', lane: 1 }),
    2: line(isRunning(2) ? null : { kind: 'laneIdle', lane: 2 }),
  };

  // Precedence is the operator's reading order: the sequence before the lanes,
  // so a board mid-countdown never blames a clock that has not left yet.
  const live: SpeedlineLock | null =
    signalPhase > 0 ? { kind: 'lights' } : isRunning(1) || isRunning(2) ? { kind: 'racing' } : null;
  // Graded by the run alone: the swap sends nothing the relay owes an answer to
  // (the next selection broadcast carries it), so a dead link may no more take
  // it than it may take a lane's Stop — and an abort leaves it live, which is
  // the moment the sides actually get fixed.
  const swap = line(live);

  // The run is still the board's live run while a clock is away, or for one
  // grace past the last stop — the window in which a frozen lane is a mis-press
  // rather than a result. Outside it the run has resolved and Void owns the undo.
  const deadline = resumeWindowDeadline(laneState);
  const resumable = isRunning(1) || isRunning(2) || (deadline !== null && now < deadline);
  const resumeLock = (lane: LaneId): SpeedlineLock | null => {
    if (laneState[lane].kind !== 'finished') return { kind: 'laneNotStopped', lane };
    return resumable ? null : { kind: 'runDead' };
  };
  const resume = { 1: line(resumeLock(1)), 2: line(resumeLock(2)) };

  if (!connected) {
    const offline = line({ kind: 'offline' });
    return { start: offline, abort: offline, reset: offline, stop, swap, resume };
  }

  if (live !== null) {
    return { start: line(live), abort: null, reset: line(live), stop, swap, resume };
  }

  return {
    // A sequence that has ENDED latches the phase at -1 until a Reset re-arms
    // the board: the one lock with no clock behind it. Which ending it was is
    // the `aborted` latch's to say — an abort is a fault the operator must
    // read as one, a spent sequence is just a board waiting to be re-armed.
    start: line(signalPhase === -1 ? { kind: aborted ? 'aborted' : 'spent' } : null),
    abort: line({ kind: 'noSequence' }),
    reset: null,
    stop,
    swap,
    resume,
  };
};
