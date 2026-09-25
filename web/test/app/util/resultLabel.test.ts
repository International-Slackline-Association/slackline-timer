import { describe, expect, it } from 'vitest';

import { DNF_LABEL, DNF_SENTINEL } from 'app/util/time';
import { bestTimeMs, formatScore, freestyleResultLabel, resultLabel } from 'app/util/resultLabel';

describe('bestTimeMs', () => {
  it('returns the minimum timeMs across attempts', () => {
    expect(bestTimeMs([{ timeMs: 1500 }, { timeMs: 900 }, { timeMs: 1200 }])).toBe(900);
  });

  it('returns undefined for an empty list', () => {
    expect(bestTimeMs([])).toBeUndefined();
  });

  it('handles a single attempt', () => {
    expect(bestTimeMs([{ timeMs: 4200 }])).toBe(4200);
  });
});

describe('formatScore', () => {
  it('renders a freestyle score value to two decimals (ADR 0039)', () => {
    expect(formatScore(42)).toBe('42.00');
    expect(formatScore(26.7)).toBe('26.70');
    expect(formatScore(6.25)).toBe('6.25');
  });
});

describe('freestyleResultLabel', () => {
  it('formats overall to two decimals', () => {
    expect(freestyleResultLabel({ overall: 42 })).toBe('42.00');
    expect(freestyleResultLabel({ overall: 42.37 })).toBe('42.37');
  });

  it('treats a missing overall as zero', () => {
    expect(freestyleResultLabel({})).toBe('0.00');
    expect(freestyleResultLabel({ overall: null })).toBe('0.00');
  });

  it('renders DNF regardless of the stored overall', () => {
    expect(freestyleResultLabel({ dnf: true, overall: 99 })).toBe(DNF_LABEL);
  });
});

describe('resultLabel', () => {
  it('uses the judged overall on the freestyle plane', () => {
    expect(resultLabel('freestyle', { overall: 55.5 })).toBe('55.50');
    expect(resultLabel('freestyle', { dnf: true })).toBe(DNF_LABEL);
  });

  it('formats the best time on the speed plane', () => {
    expect(resultLabel('speed', { bestTimeMs: 3120 })).toBe('0:03.12');
  });

  it('renders the speed DNF sentinel as DNF', () => {
    expect(resultLabel('speed', { bestTimeMs: DNF_SENTINEL })).toBe(DNF_LABEL);
  });
});
