import { describe, expect, it } from 'vitest';

import { MATCH_ROUNDS, TIME_ROUNDS, type Match } from 'app/types';
import {
  defaultRoundForMode,
  displayRoundName,
  roundLabel,
  roundsForMode,
  standingsSourceTag,
} from 'app/util/rounds';

describe('roundLabel', () => {
  it('gives a human label for every Time round', () => {
    for (const round of TIME_ROUNDS) {
      const label = roundLabel(round);
      expect(label).toBeTruthy();
      expect(label).not.toBe(round); // every enum gets a friendlier name
    }
  });

  it('maps the known rounds to their display names', () => {
    expect(roundLabel('qualification')).toBe('Qualification');
    expect(roundLabel('quarter')).toBe('Quarter-finals');
    expect(roundLabel('half')).toBe('Semi-finals');
    expect(roundLabel('small_final')).toBe('Small final');
    expect(roundLabel('final')).toBe('Final');
    expect(roundLabel('training')).toBe('Training');
    expect(roundLabel('test')).toBe('Test');
  });

  it('falls back to the raw value for an unknown round', () => {
    expect(roundLabel('mystery')).toBe('mystery');
  });
});

// Format = mode (the ADR 0036 respec): the board mode owns the Round
// vocabulary — quali IS the qualification round, battle IS a playoff match.
describe('roundsForMode', () => {
  it('quali offers test + qualification only', () => {
    expect(roundsForMode('quali')).toEqual(['test', 'qualification']);
  });

  it('battle offers test + the playoff rounds', () => {
    expect(roundsForMode('battle')).toEqual(['test', 'quarter', 'half', 'small_final', 'final']);
  });

  it('test stays selectable in both modes (full-component rehearsal, ADR 0036)', () => {
    expect(roundsForMode('quali')).toContain('test');
    expect(roundsForMode('battle')).toContain('test');
  });

  it('every offered round is a Match round (the DynamoDB SK vocabulary)', () => {
    for (const mode of ['quali', 'battle'] as const) {
      for (const round of roundsForMode(mode)) {
        expect(MATCH_ROUNDS).toContain(round);
      }
    }
  });
});

describe('defaultRoundForMode', () => {
  it('normalizes to qualification in quali and quarter in battle', () => {
    expect(defaultRoundForMode('quali')).toBe('qualification');
    expect(defaultRoundForMode('battle')).toBe('quarter');
  });

  it('the default is always valid for its mode', () => {
    for (const mode of ['quali', 'battle'] as const) {
      expect(roundsForMode(mode)).toContain(defaultRoundForMode(mode));
    }
  });
});

describe('standingsSourceTag', () => {
  it('maps every standings source to its short broadcast caps tag', () => {
    expect(standingsSourceTag('final')).toBe('FINAL');
    expect(standingsSourceTag('small_final')).toBe('SMALL FINAL');
    expect(standingsSourceTag('half')).toBe('SF');
    expect(standingsSourceTag('quarter')).toBe('QF');
    expect(standingsSourceTag('qualification')).toBe('QUALI');
  });
});

describe('displayRoundName', () => {
  const base: Match = {
    matchId: 'm1',
    compId: 'c1',
    discipline: 'speed',
    round: 'quarter',
    gender: 'male',
    position: 1,
  };

  it('shows the roundName override when set', () => {
    expect(displayRoundName({ ...base, roundName: 'Final 1' })).toBe('Final 1');
  });

  it('falls back to the round label when roundName is absent', () => {
    expect(displayRoundName(base)).toBe('Quarter-finals');
  });

  it('falls back when roundName is empty or whitespace', () => {
    expect(displayRoundName({ ...base, roundName: '' })).toBe('Quarter-finals');
    expect(displayRoundName({ ...base, roundName: '   ' })).toBe('Quarter-finals');
  });
});
