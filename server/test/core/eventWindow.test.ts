import { describe, expect, it } from 'vitest';

import {
  EVENT_GRACE_MS,
  EVENT_MAX_TTL_MS,
  computeEventExpiry,
  computePhotoUrlExpiry,
} from 'core/eventWindow';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeEventExpiry', () => {
  it('expires one grace day after the end of the endDate (UTC)', () => {
    const now = Date.parse('2026-07-01T10:00:00Z');
    const expiry = computeEventExpiry('2026-07-05', now);
    // end of 2026-07-05 = midnight 2026-07-06, plus 1 day grace = midnight 2026-07-07
    expect(expiry).toBe(Date.parse('2026-07-06T00:00:00Z') + EVENT_GRACE_MS);
    expect(new Date(expiry).toISOString()).toBe('2026-07-07T00:00:00.000Z');
  });

  it('caps at 10 days from now for long competitions', () => {
    const now = Date.parse('2026-07-01T00:00:00Z');
    const expiry = computeEventExpiry('2026-08-30', now);
    expect(expiry).toBe(now + EVENT_MAX_TTL_MS);
    expect(EVENT_MAX_TTL_MS).toBe(10 * DAY_MS);
  });

  it('yields a past expiry for an already-finished competition (URLs stay dark)', () => {
    const now = Date.parse('2026-09-01T00:00:00Z');
    const expiry = computeEventExpiry('2026-07-05', now);
    expect(expiry).toBeLessThan(now);
  });

  it('throws on an invalid date', () => {
    expect(() => computeEventExpiry('not-a-date', 0)).toThrow(/invalid endDate/);
  });
});

describe('computePhotoUrlExpiry', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('lands on the next 6 h UTC boundary at least 12 h out', () => {
    const now = Date.parse('2026-07-01T10:20:00Z');
    expect(new Date(computePhotoUrlExpiry('2026-07-05', now)).toISOString()).toBe(
      '2026-07-02T00:00:00.000Z',
    );
  });

  it('keeps a boundary that now + 12 h hits exactly', () => {
    const now = Date.parse('2026-07-01T06:00:00Z');
    expect(computePhotoUrlExpiry('2026-07-05', now)).toBe(Date.parse('2026-07-01T18:00:00Z'));
  });

  it('is byte-stable within a 6 h window and lives 12–18 h', () => {
    const start = Date.parse('2026-07-01T06:00:00.001Z');
    const expiries = [0, 1, 3 * HOUR_MS, 6 * HOUR_MS - 1].map((dt) =>
      computePhotoUrlExpiry('2026-07-05', start + dt),
    );
    expect(new Set(expiries).size).toBe(1);
    expect(expiries[0] - start).toBeLessThanOrEqual(18 * HOUR_MS);
    expect(expiries[0] - (start + 6 * HOUR_MS - 1)).toBeGreaterThanOrEqual(12 * HOUR_MS);
  });

  it('never outlives the event window', () => {
    const now = Date.parse('2026-07-06T20:00:00Z');
    expect(computePhotoUrlExpiry('2026-07-05', now)).toBe(computeEventExpiry('2026-07-05', now));
  });
});
