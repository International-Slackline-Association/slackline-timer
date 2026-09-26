import { describe, expect, it } from 'vitest';

import { EVENT_GRACE_MS, EVENT_MAX_TTL_MS, computeEventExpiry } from 'core/eventWindow';

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
