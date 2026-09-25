import { describe, expect, it } from 'vitest';

import { appendEffects, drainEffects } from 'app/util/effectStore';

describe('effectStore — drainEffects', () => {
  it('clears a non-empty queue', () => {
    const store = { series: 'x', effects: [1, 2] };
    expect(drainEffects(store)).toEqual({ series: 'x', effects: [] });
  });

  it('returns the same store when already empty (identity, no re-render churn)', () => {
    const store = { battle: 'y', effects: [] };
    expect(drainEffects(store)).toBe(store);
  });

  it('preserves the rest of the store shape', () => {
    const store = { a: 1, b: { c: 2 }, effects: ['e'] };
    const next = drainEffects(store);
    expect(next).toEqual({ a: 1, b: store.b, effects: [] });
    expect(next.b).toBe(store.b);
  });
});

describe('effectStore — appendEffects', () => {
  it('appends produced effects onto the pending queue', () => {
    expect(appendEffects([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('returns the pending array unchanged when nothing was produced (identity)', () => {
    const pending = [1, 2];
    expect(appendEffects(pending, [])).toBe(pending);
  });

  it('does not mutate the pending array when appending', () => {
    const pending = [1];
    const produced = [2];
    const next = appendEffects(pending, produced);
    expect(pending).toEqual([1]);
    expect(next).not.toBe(pending);
  });
});
