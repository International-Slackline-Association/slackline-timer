import { describe, expect, it } from 'vitest';

import { athleteOptions } from 'app/util/athleteOptions';
import type { Athlete, Gender, Match } from 'app/types';

const athlete = (athleteId: string, name: string, gender: Gender = 'male'): Athlete => ({
  athleteId,
  compId: 'c1',
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  birthDate: '1990-01-01',
  country: 'USA',
  gender,
});

const ATHLETES = [
  athlete('m1', 'Max Mann'),
  athlete('m2', 'Moe Mann'),
  athlete('f1', 'Fay Frau', 'female'),
  athlete('f2', 'Flo Frau', 'female'),
];

const match = (athlete1Id?: string, athlete2Id?: string): Match => ({
  matchId: 'match-1',
  compId: 'c1',
  discipline: 'speed',
  round: 'final',
  gender: 'male',
  position: 1,
  athlete1Id,
  athlete2Id,
});

const ids = (list: Athlete[]): string[] => list.map((a) => a.athleteId);

describe('athleteOptions (cascading selection filters)', () => {
  it('narrows to the selected gender when no match is selected', () => {
    expect(ids(athleteOptions(ATHLETES, 'female', undefined, ''))).toEqual(['f1', 'f2']);
    expect(ids(athleteOptions(ATHLETES, 'male', undefined, ''))).toEqual(['m1', 'm2']);
  });

  it('narrows to the match’s two assigned athletes, in match order', () => {
    expect(ids(athleteOptions(ATHLETES, 'male', match('m2', 'm1'), ''))).toEqual(['m2', 'm1']);
  });

  it('skips a TBD match slot (unassigned athlete)', () => {
    expect(ids(athleteOptions(ATHLETES, 'male', match('m1', undefined), ''))).toEqual(['m1']);
  });

  it('keeps an off-filter current selection listed (appended last)', () => {
    // A peer-mirrored pick of the other gender must stay visible.
    expect(ids(athleteOptions(ATHLETES, 'female', undefined, 'm1'))).toEqual(['f1', 'f2', 'm1']);
    // A match-narrowed picker whose lane still holds an off-match athlete.
    expect(ids(athleteOptions(ATHLETES, 'male', match('m1', 'm2'), 'f1'))).toEqual([
      'm1',
      'm2',
      'f1',
    ]);
  });

  it('does not duplicate a current selection already in the pool', () => {
    expect(ids(athleteOptions(ATHLETES, 'male', undefined, 'm1'))).toEqual(['m1', 'm2']);
  });

  it('ignores an unknown / empty current id', () => {
    expect(ids(athleteOptions(ATHLETES, 'male', undefined, 'gone'))).toEqual(['m1', 'm2']);
    expect(ids(athleteOptions(ATHLETES, 'male', undefined, ''))).toEqual(['m1', 'm2']);
  });
});
