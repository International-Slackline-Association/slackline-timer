import { describe, expect, it } from 'vitest';

import { refVh, refVw } from 'app/util/overlayScale';

describe('overlayScale', () => {
  it('renders widths as vw off the 1920px reference frame', () => {
    expect(refVw(1920)).toBe('100.000vw');
    expect(refVw(960)).toBe('50.000vw');
    // The rankings rank-1 plate width — the exact string the overlays assert.
    expect(refVw(828.48)).toBe('43.150vw');
  });

  it('renders heights and font sizes as vh off the 1080px reference frame', () => {
    expect(refVh(1080)).toBe('100.000vh');
    expect(refVh(540)).toBe('50.000vh');
    // The rankings/profile 9px stroke @1080p (the shared overlay stroke is 6px).
    expect(refVh(9)).toBe('0.833vh');
  });

  it('keeps three decimals of precision (frame math is fractional)', () => {
    expect(refVw(298.81)).toBe('15.563vw');
    expect(refVh(498.02)).toBe('46.113vh');
  });
});
