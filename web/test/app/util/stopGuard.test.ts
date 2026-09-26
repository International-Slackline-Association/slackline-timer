import { describe, expect, it } from 'vitest';

import { canStopLane } from 'app/util/stopGuard';

describe('canStopLane', () => {
  it('allows a stop while the race is live and the lane still timing', () => {
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: null, 2: null } }, 1)).toBe(true);
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: null, 2: null } }, 2)).toBe(true);
  });

  it('refuses a stop before any race has started', () => {
    expect(canStopLane({ startTime: null, stopTimes: { 1: null, 2: null } }, 1)).toBe(false);
  });

  it('refuses a repeat stop on an already-stopped lane', () => {
    // The race start stays set until Reset, so only the lane's own stop epoch
    // distinguishes a first press from a junk repeat press.
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: 5000, 2: null } }, 1)).toBe(false);
  });

  it('keeps the other lane stoppable after one lane finishes', () => {
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: 5000, 2: null } }, 2)).toBe(true);
  });

  it('refuses a stop after a false start stopped both lanes', () => {
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: 4000, 2: 4000 } }, 1)).toBe(false);
    expect(canStopLane({ startTime: 1000, stopTimes: { 1: 4000, 2: 4000 } }, 2)).toBe(false);
  });
});
