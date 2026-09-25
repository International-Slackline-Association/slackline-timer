import { describe, expect, it } from 'vitest';

import { initialTrySeries, type TrySeriesState } from 'app/util/bestTrickSeries';
import type { LaneState } from 'app/util/battleMachine';
import {
  laneHoldsPhrase,
  laneResetNeedsConfirm,
  resetNeedsConfirm,
  seriesTallyNeedsConfirm,
} from 'app/util/resetGuard';

describe('resetNeedsConfirm', () => {
  it('confirms while a lane is still running', () => {
    expect(resetNeedsConfirm({ signalPhase: 0, runningTimerCount: 1 })).toBe(true);
    expect(resetNeedsConfirm({ signalPhase: 0, runningTimerCount: 2 })).toBe(true);
  });

  it('confirms during the start-light sequence', () => {
    expect(resetNeedsConfirm({ signalPhase: 1, runningTimerCount: 0 })).toBe(true);
    expect(resetNeedsConfirm({ signalPhase: 2, runningTimerCount: 0 })).toBe(true);
    expect(resetNeedsConfirm({ signalPhase: 3, runningTimerCount: 0 })).toBe(true);
  });

  it('confirms during the armed T-5s pre-beep phase (PRE_BEEP_PHASE = 0.5)', () => {
    // The sequence is already counting down but no light has lit yet; a stray
    // reset here must still ask before wiping the armed start.
    expect(resetNeedsConfirm({ signalPhase: 0.5, runningTimerCount: 0 })).toBe(true);
  });

  it('clears instantly when idle (nothing to lose)', () => {
    expect(resetNeedsConfirm({ signalPhase: 0, runningTimerCount: 0 })).toBe(false);
  });

  it('clears instantly after a false start (the safe post-abort state)', () => {
    expect(resetNeedsConfirm({ signalPhase: -1, runningTimerCount: 0 })).toBe(false);
  });

  it('clears instantly once both lanes have stopped (clear for next run)', () => {
    expect(resetNeedsConfirm({ signalPhase: 0, runningTimerCount: 0 })).toBe(false);
  });
});

describe('laneResetNeedsConfirm', () => {
  const BUDGET = 120_000;

  it('clears instantly on a pristine lane (idle at exactly its armed budget)', () => {
    expect(
      laneResetNeedsConfirm({ phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft: 2 }),
    ).toBe(false);
  });

  it('confirms on a held lane — idle below its armed budget after a fall', () => {
    expect(
      laneResetNeedsConfirm({ phase: 'idle', budgetMs: 88_000, armedMs: BUDGET, breaksLeft: 2 }),
    ).toBe(true);
  });

  it('confirms while the lane is running', () => {
    expect(
      laneResetNeedsConfirm({
        phase: 'running',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        startedAt: 1_000,
        breaksLeft: 2,
      }),
    ).toBe(true);
  });

  it('confirms on a lane paused on break (the run is held, not over)', () => {
    expect(
      laneResetNeedsConfirm({
        phase: 'onBreak',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        breakMs: 30_000,
        breakStartedAt: 1_000,
        breaksLeft: 1,
      }),
    ).toBe(true);
  });

  // The board's most-repeated press: every quali athlete cycle and every battle
  // end resets finished lanes. A finished lane holds nothing to re-time
  // (freestyle records no time, the budget is already spent), so asking here
  // would train the operator to click through the one question that matters.
  it('clears instantly on a finished lane (nothing left to re-time)', () => {
    expect(laneResetNeedsConfirm({ phase: 'finished', armedMs: BUDGET, breaksLeft: 2 })).toBe(
      false,
    );
  });
});

describe('seriesTallyNeedsConfirm', () => {
  const series = (used: { 1: number; 2: number }): TrySeriesState => ({
    ...initialTrySeries(3),
    used,
  });

  it('clears instantly while no try has been used', () => {
    expect(seriesTallyNeedsConfirm(series({ 1: 0, 2: 0 }))).toBe(false);
  });

  it('asks once either side has used a try (the tallies are unrecoverable)', () => {
    expect(seriesTallyNeedsConfirm(series({ 1: 1, 2: 0 }))).toBe(true);
    expect(seriesTallyNeedsConfirm(series({ 1: 0, 2: 1 }))).toBe(true);
    expect(seriesTallyNeedsConfirm(series({ 1: 3, 2: 3 }))).toBe(true);
  });
});

describe('laneHoldsPhrase', () => {
  const BUDGET = 150_000;

  it('names what is on the clock and what the lane was armed to', () => {
    expect(
      laneHoldsPhrase(1, { phase: 'idle', budgetMs: 88_000, armedMs: BUDGET, breaksLeft: 2 }, 0),
    ).toBe('Athlete 1 holds 01:28 of 02:30');
  });

  it('reads a running lane down against the stamp it is asked at', () => {
    const lane: LaneState = {
      phase: 'running',
      budgetMs: BUDGET,
      armedMs: BUDGET,
      startedAt: 1_000,
      breaksLeft: 2,
    };
    expect(laneHoldsPhrase(2, lane, 61_000)).toBe('Athlete 2 holds 01:30 of 02:30');
  });
});
