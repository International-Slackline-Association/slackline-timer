import { describe, expect, it } from 'vitest';

import {
  bestTrickLocks,
  laneLocks,
  lockReason,
  resetBothLock,
  type Lock,
} from 'app/util/lockReason';
import type { LaneState } from 'app/util/battleMachine';
import { initialTrySeries, type TrySeriesState } from 'app/util/bestTrickSeries';
import { holdReason } from 'app/util/boardState';

import { EVERY_HOLD } from '../../util/boardHolds';

const BUDGET = 150_000;

const lane = (phase: LaneState['phase'], breaksLeft = 2): LaneState => {
  switch (phase) {
    case 'idle':
      return { phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft };
    case 'running':
      return { phase: 'running', budgetMs: BUDGET, armedMs: BUDGET, startedAt: 0, breaksLeft };
    case 'onBreak':
      return {
        phase: 'onBreak',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        breakMs: 30_000,
        breakStartedAt: 0,
        breaksLeft,
      };
    case 'finished':
      return { phase: 'finished', armedMs: BUDGET, breaksLeft };
  }
};

const openTry = (used = { 1: 1, 2: 0 }): TrySeriesState => ({
  ...initialTrySeries(3),
  used,
  clock: { running: true, side: 1, startedAt: 0, tryMs: 30_000 },
  lastSide: 1,
});

/** The locks only a control knows — the words that live in this map alone. Keyed
 * by kind, and each row typed to its own kind, so a lock added to the union
 * cannot skip the assertion or land under the wrong key. */
const CONTROL_REASONS: {
  [K in Exclude<Lock['kind'], 'hold'>]: [lock: Extract<Lock, { kind: K }>, reason: string];
} = {
  spent: [{ kind: 'spent', armedMs: BUDGET }, 'budget spent — Reset re-arms 02:30'],
  notRunning: [{ kind: 'notRunning', lane: 1 }, 'Athlete 1 is not running'],
  noBreaks: [{ kind: 'noBreaks', lane: 2 }, 'no breaks left'],
  triesSpent: [{ kind: 'triesSpent', cap: 5 }, 'all 5 tries used'],
  noTry: [{ kind: 'noTry' }, 'no try is open'],
  notArmed: [{ kind: 'notArmed' }, 'best trick is not armed'],
};

describe('lockReason — one map, one set of words', () => {
  it.each(Object.values(CONTROL_REASONS))('%o reads "%s"', (lock, reason) => {
    expect(lockReason(lock)).toBe(reason);
  });

  // The words for a board hold live in `holdReason` and nowhere else: the setup
  // rail renders them straight, a lane card reaches them through its `Lock`, and
  // the two must read identically (brief §4.7). Asserted against `holdReason`
  // itself rather than a literal, so a restated case here fails even when both
  // copies are edited to agree.
  it.each(Object.values(EVERY_HOLD))("renders %o with the board's own words", (hold) => {
    expect(lockReason({ kind: 'hold', hold })).toBe(holdReason(hold));
  });
});

describe('laneLocks — the lane transport', () => {
  const idleLane = { id: 1 as const, lane: lane('idle') };

  it('locks nothing on an armed, idle lane in quali but Stop and Take break', () => {
    const locks = laneLocks({ ...idleLane, runningLane: null, bestTrickArmed: false });

    expect(locks.start).toBeNull();
    expect(locks.reset).toBeNull();
    expect(locks.stop).toEqual({ kind: 'notRunning', lane: 1 });
    expect(locks.takeBreak).toEqual({ kind: 'notRunning', lane: 1 });
  });

  it('opens Stop and Take break while the lane runs', () => {
    const locks = laneLocks({
      ...idleLane,
      lane: lane('running'),
      runningLane: 1,
      bestTrickArmed: false,
    });

    expect(locks.stop).toBeNull();
    expect(locks.takeBreak).toBeNull();
    expect(locks.start).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 1 } });
  });

  // Mutual exclusion, worded: the other lane's controls name WHO is running.
  it('locks the whole lane while the other lane runs, Reset included', () => {
    const locks = laneLocks({ ...idleLane, runningLane: 2, bestTrickArmed: false });
    const otherRuns = { kind: 'hold', hold: { kind: 'running', lane: 2 } };

    expect(locks.start).toEqual(otherRuns);
    expect(locks.stop).toEqual(otherRuns);
    expect(locks.reset).toEqual(otherRuns);
    expect(locks.takeBreak).toEqual(otherRuns);
  });

  // Brief §4.7: while the series is armed the whole lane transport goes inert,
  // Reset included — the run board is not re-armed mid-series.
  it('locks the whole lane transport while best trick is armed, Reset included', () => {
    const locks = laneLocks({ ...idleLane, runningLane: null, bestTrickArmed: true });
    const bestTrick = { kind: 'hold', hold: { kind: 'bestTrick' } };

    expect(locks.start).toEqual(bestTrick);
    expect(locks.stop).toEqual(bestTrick);
    expect(locks.takeBreak).toEqual(bestTrick);
    expect(locks.reset).toEqual(bestTrick);
  });

  it('names the re-arm value on a spent lane', () => {
    const locks = laneLocks({
      ...idleLane,
      lane: lane('finished'),
      runningLane: null,
      bestTrickArmed: false,
    });

    expect(locks.start).toEqual({ kind: 'spent', armedMs: BUDGET });
    expect(lockReason(locks.start!)).toBe('budget spent — Reset re-arms 02:30');
  });

  it('locks Take break once the allowance is spent', () => {
    const locks = laneLocks({
      ...idleLane,
      lane: lane('running', 0),
      runningLane: 1,
      bestTrickArmed: false,
    });

    expect(locks.takeBreak).toEqual({ kind: 'noBreaks', lane: 1 });
  });

  // Start doubles as the break cancel (DECISIONS 0019 §2) — it stays live.
  it('keeps Start live on a lane paused on a break', () => {
    const locks = laneLocks({
      ...idleLane,
      lane: lane('onBreak'),
      runningLane: null,
      bestTrickArmed: false,
    });

    expect(locks.start).toBeNull();
  });
});

describe('bestTrickLocks — the try series', () => {
  it('locks Begin best trick while a lane runs', () => {
    const locks = bestTrickLocks({ series: null, runningLane: 2 });

    expect(locks.begin).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 2 } });
  });

  it('opens Begin best trick once both lanes rest', () => {
    expect(bestTrickLocks({ series: null, runningLane: null }).begin).toBeNull();
  });

  it('locks both sides, the cap and the window while a try is open', () => {
    const locks = bestTrickLocks({ series: openTry(), runningLane: null });
    const tryOpen = { kind: 'hold', hold: { kind: 'tryOpen' } };

    expect(locks.startTry[1]).toEqual(tryOpen);
    expect(locks.startTry[2]).toEqual(tryOpen);
    expect(locks.skip[1]).toEqual(tryOpen);
    expect(locks.skip[2]).toEqual(tryOpen);
    expect(locks.settings).toEqual(tryOpen);
  });

  it('opens both sides between tries and leaves the settings live', () => {
    const locks = bestTrickLocks({ series: initialTrySeries(3), runningLane: null });

    expect(locks.startTry[1]).toBeNull();
    expect(locks.startTry[2]).toBeNull();
    expect(locks.settings).toBeNull();
  });

  it('locks a side that has used every try', () => {
    const locks = bestTrickLocks({
      series: { ...initialTrySeries(3), used: { 1: 3, 2: 1 } },
      runningLane: null,
    });

    expect(locks.startTry[1]).toEqual({ kind: 'triesSpent', cap: 3 });
    expect(locks.skip[1]).toEqual({ kind: 'triesSpent', cap: 3 });
    expect(locks.startTry[2]).toBeNull();
  });

  it('locks the sides while a lane runs, before either tally is read', () => {
    const locks = bestTrickLocks({ series: initialTrySeries(3), runningLane: 1 });

    expect(locks.startTry[1]).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 1 } });
  });

  // The disarmed face: Begin is the only live control, so the try keys the
  // panel does not render yet are locked rather than null — the handset readout
  // reads them and would otherwise report an unarmed series as a live press.
  it('locks both sides while the series is off', () => {
    const locks = bestTrickLocks({ series: null, runningLane: null });

    expect(locks.startTry[1]).toEqual({ kind: 'notArmed' });
    expect(locks.skip[2]).toEqual({ kind: 'notArmed' });
  });

  // The panel's two series-wide presses. Best trick is the phase AFTER both
  // turns, so a live run holds the whole panel — the settings row and these two
  // alike; the JSDoc on `runningLane` says so and this is what makes it true.
  it('locks Reset series and Leave best trick while a lane runs', () => {
    const locks = bestTrickLocks({ series: initialTrySeries(3), runningLane: 2 });

    expect(locks.series).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 2 } });
    expect(locks.series).toEqual(locks.settings);
  });

  // An open try is deliberately not one of their locks (§4.7 lists neither):
  // both are the way out of the series, DISARM stops the window with it, and
  // the tally confirm — not a lock — is what guards the counts (§4.8).
  it('leaves both series-wide presses live through an open try', () => {
    const locks = bestTrickLocks({ series: openTry(), runningLane: null });

    expect(locks.series).toBeNull();
    expect(locks.settings).not.toBeNull();
  });

  // §4.7's precedence, on the disarmed panel too: the board-wide hold is what
  // the operator has to clear first, and it is also what locks the Begin button
  // that would arm the series — so naming the missing series there would point
  // at a control the run holds shut.
  it('names the live run before the missing series', () => {
    const locks = bestTrickLocks({ series: null, runningLane: 1 });

    expect(locks.startTry[2]).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 1 } });
    expect(locks.begin).toEqual(locks.startTry[2]);
  });
});

describe('resetBothLock — the rail-foot re-arm', () => {
  const spentBattle = { 1: lane('finished'), 2: lane('finished') };

  // The way every battle ends: two spent lanes and nothing else holding the
  // board, so the next match is armed in one press (§4.9).
  it('stays live at the ordinary end of a battle', () => {
    expect(
      resetBothLock({ lanes: spentBattle, runningLane: null, bestTrickArmed: false }),
    ).toBeNull();
  });

  // It re-arms BOTH lanes, so it takes whatever would lock either lane's own
  // Reset — the series' one exit is Leave best trick (§4.7), and the rail is
  // where the operator would otherwise reach the clocks from behind the tries.
  it('locks while a best-trick series is armed', () => {
    expect(resetBothLock({ lanes: spentBattle, runningLane: null, bestTrickArmed: true })).toEqual({
      kind: 'hold',
      hold: { kind: 'bestTrick' },
    });
  });

  it('locks while a lane runs, naming who', () => {
    expect(
      resetBothLock({
        lanes: { 1: lane('running'), 2: lane('finished') },
        runningLane: 1,
        bestTrickArmed: false,
      }),
    ).toEqual({ kind: 'hold', hold: { kind: 'running', lane: 1 } });
  });
});
