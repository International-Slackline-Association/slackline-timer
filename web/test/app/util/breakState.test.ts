import { describe, expect, it } from 'vitest';

import { MAX_BREAKS, breakRemainingFrom, canTakeBreak, takeBreak } from 'app/util/breakState';

describe('MAX_BREAKS', () => {
  it('is the quali allowance of 2 (breaks are a quali-only surface, ADR 0036)', () => {
    expect(MAX_BREAKS).toBe(2);
  });
});

describe('canTakeBreak', () => {
  it('allows a break only while the lane is running and breaks remain', () => {
    expect(canTakeBreak(true, 2)).toBe(true);
    expect(canTakeBreak(true, 1)).toBe(true);
  });

  it('blocks a break when the lane is not running', () => {
    expect(canTakeBreak(false, 2)).toBe(false);
  });

  it('blocks a break when no breaks remain (the quali 3rd press)', () => {
    expect(canTakeBreak(true, 0)).toBe(false);
  });
});

describe('takeBreak', () => {
  it('freezes the run and starts the break from the given breakMs', () => {
    expect(takeBreak(45_000, 30_000, 2)).toEqual({
      runRemainingMs: 45_000,
      breakMs: 30_000,
      breaksLeft: 1,
    });
  });

  it('uses the supplied breakMs (per-competition config, no hardcoded constant)', () => {
    expect(takeBreak(10_000, 45_000, 2).breakMs).toBe(45_000);
  });

  it('never decrements the allowance below zero (defensive)', () => {
    expect(takeBreak(10_000, 30_000, 0).breaksLeft).toBe(0);
  });
});

describe('breakRemainingFrom', () => {
  it('counts the break clock down from breakMs by wall-clock elapsed since it started', () => {
    expect(breakRemainingFrom(30_000, 100_000, 108_000)).toBe(22_000);
  });

  it('clamps a break that has run past zero to zero', () => {
    expect(breakRemainingFrom(30_000, 100_000, 200_000)).toBe(0);
  });

  it('returns the full break when no time has elapsed', () => {
    expect(breakRemainingFrom(30_000, 100_000, 100_000)).toBe(30_000);
  });
});
