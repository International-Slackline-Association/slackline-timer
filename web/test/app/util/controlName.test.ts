import { describe, expect, it } from 'vitest';

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import { type LaneButtonRole } from 'app/util/buzzer';
import { laneControlName, laneControlVerb, athleteControlName } from 'app/util/controlName';

describe('athleteControlName', () => {
  it('spells the per-athlete suffix one way', () => {
    expect(athleteControlName('Save', 2)).toBe('Save Athlete 2');
  });
});

describe('laneControlVerb', () => {
  /**
   * Every handset role, worded for both boards. A `Record` over the union so a
   * sixth lane key fails to typecheck here rather than reaching the readout
   * with a blank verb.
   */
  const verbs: Record<LaneButtonRole, Record<FreestyleMode, string>> = {
    start: { quali: 'Start', battle: 'Start' },
    reset: { quali: 'Reset', battle: 'Reset' },
    // The one mode-dependent key (§4.14): quali's advisory break and battle's
    // turn end are the same green button.
    aux: { quali: 'Take break', battle: 'End turn' },
    try: { quali: 'Start try', battle: 'Start try' },
    stop: { quali: 'Stop', battle: 'Stop' },
  };

  it.each(Object.entries(verbs) as [LaneButtonRole, Record<FreestyleMode, string>][])(
    'words the %s key on both boards',
    (role, expected) => {
      expect(laneControlVerb(role, 'quali')).toBe(expected.quali);
      expect(laneControlVerb(role, 'battle')).toBe(expected.battle);
    },
  );

  it('names a lane key with its athlete', () => {
    expect(laneControlName('try', 'battle', 2)).toBe('Start try Athlete 2');
    expect(laneControlName('aux', 'quali', 1)).toBe('Take break Athlete 1');
  });
});
