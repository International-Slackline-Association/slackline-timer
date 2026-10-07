import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearAllCachedReadTokens,
  clearCachedReadToken,
  readCachedReadToken,
  writeCachedReadToken,
} from 'app/util/readTokenCache';

const COMP = 'worlds-2026';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('readTokenCache', () => {
  it('round-trips a token that is still inside the first half of its lifetime', () => {
    const storedAt = 1_000_000;
    // 10-day lifetime → reusable through day 5.
    const expiresAt = storedAt + 10 * 24 * 3_600_000;
    writeCachedReadToken(COMP, { token: 'tok-1', expiresAt }, storedAt);

    const justBeforeMidpoint = storedAt + 5 * 24 * 3_600_000 - 1;
    expect(readCachedReadToken(COMP, justBeforeMidpoint)).toEqual({ token: 'tok-1', expiresAt });
  });

  it('treats the token as absent once past the halfway mark', () => {
    const storedAt = 1_000_000;
    const expiresAt = storedAt + 10 * 24 * 3_600_000;
    writeCachedReadToken(COMP, { token: 'tok-1', expiresAt }, storedAt);

    const midpoint = storedAt + 5 * 24 * 3_600_000;
    expect(readCachedReadToken(COMP, midpoint)).toBeNull();
    expect(readCachedReadToken(COMP, expiresAt + 1)).toBeNull();
  });

  it('returns null when nothing is cached and after clearing', () => {
    expect(readCachedReadToken(COMP, 0)).toBeNull();

    writeCachedReadToken(COMP, { token: 'tok-1', expiresAt: 9e15 }, 0);
    expect(readCachedReadToken(COMP, 1)).not.toBeNull();

    clearCachedReadToken(COMP);
    expect(readCachedReadToken(COMP, 1)).toBeNull();
  });

  it('is scoped per competition', () => {
    writeCachedReadToken('comp-a', { token: 'a', expiresAt: 9e15 }, 0);
    writeCachedReadToken('comp-b', { token: 'b', expiresAt: 9e15 }, 0);
    expect(readCachedReadToken('comp-a', 1)?.token).toBe('a');
    expect(readCachedReadToken('comp-b', 1)?.token).toBe('b');
  });

  it('treats a malformed entry as no cache', () => {
    window.localStorage.setItem(`speedline.overlayReadToken.${COMP}`, 'not json');
    expect(readCachedReadToken(COMP, 1)).toBeNull();
  });

  it('degrades to no cache when the write hits the storage quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => writeCachedReadToken(COMP, { token: 'tok-1', expiresAt: 9e15 }, 0)).not.toThrow();
    expect(readCachedReadToken(COMP, 1)).toBeNull();
  });

  it('clears every cached read token and nothing else', () => {
    writeCachedReadToken('comp-a', { token: 'a', expiresAt: 9e15 }, 0);
    writeCachedReadToken('comp-b', { token: 'b', expiresAt: 9e15 }, 0);
    window.localStorage.setItem('speedline.selectedCompetition', 'comp-a');
    window.localStorage.setItem('other.overlayReadToken.comp-a', 'x');

    clearAllCachedReadTokens();

    expect(readCachedReadToken('comp-a', 1)).toBeNull();
    expect(readCachedReadToken('comp-b', 1)).toBeNull();
    expect(window.localStorage.getItem('speedline.selectedCompetition')).toBe('comp-a');
    expect(window.localStorage.getItem('other.overlayReadToken.comp-a')).toBe('x');
  });
});
