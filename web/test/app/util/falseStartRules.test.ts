import { describe, expect, it } from 'vitest';

import {
  clearFalseStart,
  deriveFsOutcome,
  flagFalseStart,
  fsCountsAfterStart,
  NO_FALSE_STARTS,
  shouldRecordTime,
  type FsCounts,
  type FsOutcome,
} from 'app/util/falseStartRules';

describe('flagFalseStart', () => {
  it('increments 0 → 1 → 2', () => {
    expect(flagFalseStart(0)).toBe(1);
    expect(flagFalseStart(1)).toBe(2);
  });

  it('caps at 2 (a third flag is a no-op)', () => {
    expect(flagFalseStart(2)).toBe(2);
  });
});

describe('clearFalseStart', () => {
  it('resets to 0', () => {
    expect(clearFalseStart()).toBe(0);
  });
});

describe('shouldRecordTime', () => {
  it('records under the second false start (rule S2)', () => {
    expect(shouldRecordTime(0)).toBe(true);
    expect(shouldRecordTime(1)).toBe(true);
  });

  it('records nothing at the second false start', () => {
    expect(shouldRecordTime(2)).toBe(false);
  });
});

describe('fsCountsAfterStart', () => {
  it('zeroes a lane whose attempt closed (accepted result → fresh attempt)', () => {
    expect(fsCountsAfterStart({ 1: 1, 2: 2 }, { 1: true, 2: true })).toEqual({ 1: 0, 2: 0 });
  });

  it('keeps a lane still mid-attempt (a rerun after a void)', () => {
    expect(fsCountsAfterStart({ 1: 1, 2: 1 }, { 1: false, 2: false })).toEqual({ 1: 1, 2: 1 });
  });

  it('zeroes only the lane whose attempt closed (mixed)', () => {
    expect(fsCountsAfterStart({ 1: 1, 2: 1 }, { 1: true, 2: false })).toEqual({ 1: 0, 2: 1 });
  });
});

describe('deriveFsOutcome', () => {
  const counts = (c1: 0 | 1 | 2, c2: 0 | 1 | 2): FsCounts => ({ 1: c1, 2: c2 });

  it('none when neither lane is flagged', () => {
    expect(deriveFsOutcome(NO_FALSE_STARTS, null)).toEqual({ kind: 'none' } satisfies FsOutcome);
    expect(deriveFsOutcome(counts(0, 0), 1)).toEqual({ kind: 'none' });
  });

  it('rerun-round when both lanes are flagged (1-vs-1)', () => {
    expect(deriveFsOutcome(counts(1, 1), null)).toEqual({ kind: 'rerun-round' });
  });

  it('rerun-round when both lanes are flagged even at 2-vs-1 (precedence pin)', () => {
    // A 2nd FS forfeits only against a CLEAN opponent; if both jumped it reruns.
    expect(deriveFsOutcome(counts(2, 1), 1)).toEqual({ kind: 'rerun-round' });
    expect(deriveFsOutcome(counts(1, 2), 2)).toEqual({ kind: 'rerun-round' });
    expect(deriveFsOutcome(counts(2, 2), null)).toEqual({ kind: 'rerun-round' });
  });

  it('round-to-opponent when one lane reaches its 2nd FS against a clean lane', () => {
    expect(deriveFsOutcome(counts(2, 0), null)).toEqual({
      kind: 'round-to-opponent',
      offender: 1,
      opponent: 2,
    });
    expect(deriveFsOutcome(counts(0, 2), 1)).toEqual({
      kind: 'round-to-opponent',
      offender: 2,
      opponent: 1,
    });
  });

  it('awaiting-finish on a single first FS while the run is undecided (rule S4)', () => {
    expect(deriveFsOutcome(counts(1, 0), null)).toEqual({ kind: 'awaiting-finish', offender: 1 });
    expect(deriveFsOutcome(counts(0, 1), null)).toEqual({ kind: 'awaiting-finish', offender: 2 });
  });

  it('rerun-start when the single offender then won the run', () => {
    expect(deriveFsOutcome(counts(1, 0), 1)).toEqual({ kind: 'rerun-start', offender: 1 });
    expect(deriveFsOutcome(counts(0, 1), 2)).toEqual({ kind: 'rerun-start', offender: 2 });
  });

  it('result-stands when the clean lane won despite the opponent’s first FS', () => {
    expect(deriveFsOutcome(counts(1, 0), 2)).toEqual({ kind: 'result-stands', offender: 1 });
    expect(deriveFsOutcome(counts(0, 1), 1)).toEqual({ kind: 'result-stands', offender: 2 });
  });
});
