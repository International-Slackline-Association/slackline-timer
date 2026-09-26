import { describe, expect, it } from 'vitest';

import { FREESTYLE_FORMAT_PRESETS } from 'app/types';

/**
 * The Freestyle format timings encode championship rules F4/F5, applied by the
 * single Quali/Battle mode control (format = mode — the ADR 0036 respec). These
 * are the numbers the operator would otherwise retype every battle, so pin them
 * to the rule values — a drift here silently mistimes a whole competition.
 */
describe('FREESTYLE_FORMAT_PRESETS', () => {
  it('quali is a 2:00 run with a 5:00 warm-up (rule F4)', () => {
    expect(FREESTYLE_FORMAT_PRESETS.quali).toEqual({ runSeconds: 120, warmupSeconds: 300 });
  });

  it('battle is a 2:30 run with a 7:00 warm-up (rule F5)', () => {
    expect(FREESTYLE_FORMAT_PRESETS.battle).toEqual({ runSeconds: 150, warmupSeconds: 420 });
  });
});
