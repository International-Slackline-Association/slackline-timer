import { describe, expect, it } from 'vitest';

import {
  DISCIPLINE,
  DNF_SENTINEL,
  GENDERS,
  MATCH_ROUNDS,
  STANDINGS_VIEWS,
  TIME_ROUNDS,
  computeOverall,
  fullName,
  genderDisplayName,
  isDiscipline,
  isGender,
  isMatchRound,
  isStandingsView,
  isTimeRound,
  roundDisplayName,
  splitName,
} from 'core/types';

describe('round enums (ported from timertimer — do not reorder or rename)', () => {
  it('Match rounds match timertimer Match.round values', () => {
    expect(MATCH_ROUNDS).toEqual([
      'test',
      'qualification',
      'quarter',
      'half',
      'small_final',
      'final',
    ]);
  });

  it('Time rounds are Match rounds plus training (timertimer Time.round order)', () => {
    expect(TIME_ROUNDS).toEqual([
      'test',
      'training',
      'quarter',
      'half',
      'small_final',
      'final',
      'qualification',
    ]);
  });

  it('training is a Time round but not a Match round', () => {
    expect(isTimeRound('training')).toBe(true);
    expect(isMatchRound('training')).toBe(false);
  });

  it('genders and guards', () => {
    expect(GENDERS).toEqual(['male', 'female']);
    expect(isGender('male')).toBe(true);
    expect(isGender('other')).toBe(false);
  });

  it('disciplines and guards', () => {
    expect(DISCIPLINE).toEqual(['speed', 'freestyle']);
    expect(isDiscipline('speed')).toBe(true);
    expect(isDiscipline('freestyle')).toBe(true);
    expect(isDiscipline('other')).toBe(false);
  });

  it('standings views are pseudo-rounds — never part of the SK round enums', () => {
    expect(STANDINGS_VIEWS).toEqual(['overall', 'combined']);
    expect(isStandingsView('overall')).toBe(true);
    expect(isStandingsView('final')).toBe(false);
    for (const view of STANDINGS_VIEWS) {
      expect(isMatchRound(view)).toBe(false);
      expect(isTimeRound(view)).toBe(false);
    }
  });

  it('preserves the DNF sentinel', () => {
    expect(DNF_SENTINEL).toBe(3_355_550);
  });
});

describe('display names (ported from timertimer Match helpers)', () => {
  it('round display names', () => {
    expect(roundDisplayName('test')).toBe('test round');
    expect(roundDisplayName('qualification')).toBe('qualifications');
    expect(roundDisplayName('quarter')).toBe('quarter-finals');
    expect(roundDisplayName('half')).toBe('semi-finals');
    expect(roundDisplayName('small_final')).toBe('small-finals');
    expect(roundDisplayName('final')).toBe('finals');
    expect(roundDisplayName('anything-else')).toBe('all rounds');
  });

  it('gender display names', () => {
    expect(genderDisplayName('male')).toBe("men's");
    expect(genderDisplayName('female')).toBe("women's");
  });
});

describe('splitName / fullName', () => {
  it('splits on the first space: first word is firstName, the rest is lastName', () => {
    expect(splitName('Jane Doe')).toEqual({ firstName: 'Jane', lastName: 'Doe' });
    expect(splitName('Mary Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' });
  });

  it('puts a single-word name in firstName with an empty lastName', () => {
    expect(splitName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' });
  });

  it('trims and collapses surrounding whitespace', () => {
    expect(splitName('  Jane   Doe  ')).toEqual({ firstName: 'Jane', lastName: 'Doe' });
  });

  it('fullName joins the two with a single space and trims', () => {
    expect(fullName('Jane', 'Doe')).toBe('Jane Doe');
    expect(fullName('Madonna', '')).toBe('Madonna');
    expect(fullName('', 'Doe')).toBe('Doe');
  });
});

describe('computeOverall', () => {
  it('sums the judged components and subtracts the control penalty', () => {
    expect(
      computeOverall({
        difficulty: 8.5,
        combo: 7,
        style: 6.25,
        bestTrick: 9,
        controlPenalty: 2.75,
      }),
    ).toBe(8.5 + 7 + 6.25 + 9 - 2.75);
  });

  it('normalizes away binary float noise (ADR 0039)', () => {
    // Plain double addition yields 26.700000000000003; normalization pins 26.7.
    expect(
      computeOverall({
        difficulty: 8.1,
        combo: 7.2,
        style: 6.3,
        bestTrick: 5.4,
        controlPenalty: 0.3,
      }),
    ).toBe(26.7);
  });
});
