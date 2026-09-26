import { describe, expect, it } from 'vitest';

import type { Athlete } from 'app/types';
import { athleteLabel, laneName, laneNamesInput } from 'app/util/raceNames';

const athlete = (over: Partial<Athlete>): Athlete => ({
  athleteId: 'a1',
  compId: 'c1',
  firstName: 'Alexandra',
  lastName: 'Example',
  name: 'Alexandra Example',
  shortName: 'A. Example',
  birthDate: '2000-01-01',
  country: 'DE',
  gender: 'male',
  ...over,
});

const athletes: Athlete[] = [
  athlete({ athleteId: 'a1', shortName: 'A. Example' }),
  athlete({ athleteId: 'a2', firstName: 'Bruno', lastName: 'Beispiel', shortName: undefined }),
];

describe('laneName', () => {
  it('uses shortName when present', () => {
    expect(laneName('a1', athletes)).toBe('A. Example');
  });

  it('falls back to lastName when shortName is absent', () => {
    expect(laneName('a2', athletes)).toBe('Beispiel');
  });

  it('returns empty string for an empty athleteId', () => {
    expect(laneName('', athletes)).toBe('');
  });

  it('returns empty string for an athleteId absent from the list', () => {
    expect(laneName('nope', athletes)).toBe('');
  });
});

describe('laneNamesInput', () => {
  it('maps both lanes independently', () => {
    expect(laneNamesInput({ 1: 'a1', 2: 'a2' }, athletes)).toEqual({
      lane1: 'A. Example',
      lane2: 'Beispiel',
    });
  });

  it('renders a blank lane when one lane is unassigned', () => {
    expect(laneNamesInput({ 1: 'a1', 2: '' }, athletes)).toEqual({
      lane1: 'A. Example',
      lane2: '',
    });
  });

  it('renders both blank when no athletes are assigned', () => {
    expect(laneNamesInput({ 1: '', 2: '' }, athletes)).toEqual({
      lane1: '',
      lane2: '',
    });
  });
});

describe('athleteLabel', () => {
  it('names the athlete on the side', () => {
    expect(athleteLabel(1, 'Bianchi')).toBe('Bianchi');
    expect(athleteLabel(2, 'Ohno')).toBe('Ohno');
  });

  // The board's word for an empty slot, in one place: it is what the lane card,
  // the best-trick panel, the next-up hint and the handset readout all print.
  it('falls back to the slot itself, as Athlete — never Player', () => {
    expect(athleteLabel(1)).toBe('Athlete 1');
    expect(athleteLabel(2, '')).toBe('Athlete 2');
  });
});
