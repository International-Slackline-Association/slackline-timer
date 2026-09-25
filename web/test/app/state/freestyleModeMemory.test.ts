import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readStoredFreestyleMode, storeFreestyleMode } from 'app/state/freestyleModeMemory';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('freestyleModeMemory', () => {
  it('returns null for a competition with no stored mode', () => {
    expect(readStoredFreestyleMode('worlds-2026')).toBeNull();
  });

  it('round-trips the last-chosen mode per competition', () => {
    storeFreestyleMode('worlds-2026', 'battle');
    expect(readStoredFreestyleMode('worlds-2026')).toBe('battle');

    storeFreestyleMode('worlds-2026', 'quali');
    expect(readStoredFreestyleMode('worlds-2026')).toBe('quali');
  });

  it('keys the memory off the compId — no cross-competition leak', () => {
    storeFreestyleMode('worlds-2026', 'battle');
    expect(readStoredFreestyleMode('euros-2026')).toBeNull();
  });

  it('rejects a corrupted stored value instead of returning it', () => {
    window.localStorage.setItem('speedline.freestyleMode.worlds-2026', 'turbo');
    expect(readStoredFreestyleMode('worlds-2026')).toBeNull();
  });
});
