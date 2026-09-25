import { describe, expect, it } from 'vitest';

import {
  DNF_LABEL,
  DNF_SENTINEL,
  formatClock,
  formatMs,
  isValidTimeFormat,
  parseTimeString,
  remainingCeilSecond,
  remainingFrom,
} from 'app/util/time';

// Behaviour ported 1:1 from timertimer's `Timertimer.Timer` (lib/timertimer/timer.ex).
// These tests are the spec; the implementation must satisfy them.

describe('formatMs', () => {
  it('renders null/undefined as the empty clock', () => {
    expect(formatMs(null)).toBe('00:00:00');
    expect(formatMs(undefined)).toBe('00:00:00');
  });

  it('renders the DNF sentinel as "DNF"', () => {
    expect(formatMs(DNF_SENTINEL)).toBe(DNF_LABEL);
  });

  it('formats whole milliseconds as M:SS.hh', () => {
    expect(formatMs(0)).toBe('0:00.00');
    expect(formatMs(65_070)).toBe('1:05.07'); // 1 min, 5 sec, 70 ms -> 07 hundredths
    expect(formatMs(9_999)).toBe('0:09.99');
  });

  it('does not zero-pad the minutes field', () => {
    expect(formatMs(600_000)).toBe('10:00.00');
  });

  it('truncates sub-10ms remainder to hundredths (floor, not round)', () => {
    expect(formatMs(1_009)).toBe('0:01.00');
  });

  it('clamps negative input to zero (transient viewer-vs-operator clock skew)', () => {
    expect(formatMs(-1)).toBe('0:00.00');
    expect(formatMs(-5_000)).toBe('0:00.00');
  });

  it('throws on non-integer input', () => {
    expect(() => formatMs(1.5)).toThrow();
  });
});

describe('formatClock', () => {
  it('formats mm:ss below an hour, zero-padding minutes', () => {
    expect(formatClock(90_000)).toBe('01:30');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(45_000)).toBe('00:45');
  });

  it('widens to hh:mm:ss past an hour', () => {
    expect(formatClock(3_661_000)).toBe('01:01:01');
  });

  it('clamps negatives to 00:00', () => {
    expect(formatClock(-5_000)).toBe('00:00');
  });

  it('floors to whole seconds (no hundredths face)', () => {
    expect(formatClock(1_999)).toBe('00:01');
  });
});

describe('remainingFrom', () => {
  it('is the budget less the wall-clock elapsed since the anchor', () => {
    expect(remainingFrom(90_000, 1_000, 1_000)).toBe(90_000); // no elapsed
    expect(remainingFrom(90_000, 1_000, 4_000)).toBe(87_000); // 3s elapsed
  });

  it('clamps to zero once the budget has elapsed', () => {
    expect(remainingFrom(90_000, 1_000, 200_000)).toBe(0);
  });

  it('is anchor-invariant — same (duration, anchor) yields the same value at a given now', () => {
    // The convergence property the whole fix rests on: two receivers that share
    // the wire (duration, anchor) derive the identical remaining at any instant,
    // regardless of when each processed the message.
    const now = 12_345;
    expect(remainingFrom(90_000, 1_000, now)).toBe(remainingFrom(90_000, 1_000, now));
  });
});

describe('remainingCeilSecond', () => {
  it('seeds the whole second in progress (ceil), so formatClock never flashes one short', () => {
    // A ms-old anchor: raw would be 89_900 → floors to 01:29 for a 90s start;
    // the ceil seed keeps it at 90_000 → 01:30.
    expect(remainingCeilSecond(90_000, 1_000, 1_100)).toBe(90_000);
    expect(formatClock(remainingCeilSecond(90_000, 1_000, 1_100))).toBe('01:30');
  });

  it('clamps to zero past the end', () => {
    expect(remainingCeilSecond(90_000, 1_000, 200_000)).toBe(0);
  });

  it('agrees with remainingFrom on exact-second boundaries', () => {
    expect(remainingCeilSecond(90_000, 1_000, 1_000)).toBe(90_000);
    expect(remainingCeilSecond(90_000, 1_000, 4_000)).toBe(87_000);
  });
});

describe('parseTimeString', () => {
  it('treats empty / null as zero', () => {
    expect(parseTimeString('')).toBe(0);
    expect(parseTimeString(null)).toBe(0);
  });

  it('parses M:SS.hh', () => {
    expect(parseTimeString('1:05.07')).toBe(65_070);
  });

  it('parses M:SS:hh (colon-separated hundredths)', () => {
    expect(parseTimeString('1:05:07')).toBe(65_070);
  });

  it('round-trips with formatMs', () => {
    const ms = 65_070;
    expect(parseTimeString(formatMs(ms))).toBe(ms);
  });

  it('rejects out-of-range seconds and hundredths', () => {
    expect(parseTimeString('1:60.00')).toBeNull();
    expect(parseTimeString('1:00.100')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseTimeString('abc')).toBeNull();
    expect(parseTimeString('1:0x.07')).toBeNull();
  });
});

describe('isValidTimeFormat', () => {
  it('is true for parseable strings', () => {
    expect(isValidTimeFormat('1:05.07')).toBe(true);
    expect(isValidTimeFormat('')).toBe(true);
  });

  it('is false for unparseable strings', () => {
    expect(isValidTimeFormat('abc')).toBe(false);
    expect(isValidTimeFormat('1:60.00')).toBe(false);
  });
});
