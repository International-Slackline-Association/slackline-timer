import { describe, expect, it } from 'vitest';

import {
  athleteToItem,
  competitionToItem,
  itemToAthlete,
  itemToCompetition,
  itemToMatch,
  itemToScore,
  itemToTime,
  matchNeedsMove,
  matchToItem,
  scoreNeedsMove,
  scoreToItem,
  timeNeedsMove,
  timeToItem,
} from 'core/mappers';
import type { Athlete, Competition, Match, Score, Time } from 'core/types';

const competition: Competition = {
  compId: 'worlds-2026',
  name: 'ISA Worlds',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  tokenVersion: 1,
};

const athlete: Athlete = {
  athleteId: 'a1',
  compId: 'worlds-2026',
  firstName: 'Jane',
  lastName: 'Doe',
  name: 'Jane Doe',
  shortName: 'JD',
  birthDate: '2000-01-31',
  country: 'CH',
  gender: 'female',
};

const time: Time = {
  timeId: 't1',
  compId: 'worlds-2026',
  athleteId: 'a1',
  round: 'qualification',
  timeMs: 12_340,
  startTime: 1_750_000_000_000,
};

const match: Match = {
  matchId: 'm1',
  compId: 'worlds-2026',
  discipline: 'speed',
  round: 'final',
  roundName: 'Final 1',
  gender: 'female',
  position: 1,
  athlete1Id: 'a1',
};

const score: Score = {
  scoreId: 's1',
  compId: 'worlds-2026',
  athleteId: 'a1',
  round: 'final',
  difficulty: 8.5,
  combo: 7,
  style: 6.25,
  bestTrick: 9,
  controlPenalty: 2.75,
  overall: 28,
};

describe('item round trips', () => {
  it('competition: keys + round trip', () => {
    const item = competitionToItem({ ...competition, createdAt: 123 });
    expect(item.PK).toBe('COMP#worlds-2026');
    expect(item.SK).toBe('META');
    expect(itemToCompetition(item)).toEqual(competition);
  });

  it('competition: round trips nested freestyle config', () => {
    const withConfig = { ...competition, config: { freestyle: { breakMs: 45_000 } } };
    const item = competitionToItem({ ...withConfig, createdAt: 123 });
    expect(itemToCompetition(item)).toEqual(withConfig);
  });

  it('athlete: keys + round trip, omitting absent optionals', () => {
    const item = athleteToItem(athlete);
    expect(item.PK).toBe('COMP#worlds-2026');
    expect(item.SK).toBe('ATHLETE#a1');
    expect(itemToAthlete(item)).toEqual(athlete);
    expect('country2' in itemToAthlete(item)).toBe(false);
    expect('photoKey' in item).toBe(false);
  });

  it('athlete: preserves optionals when present', () => {
    const full = { ...athlete, country2: 'DE', notes: 'n', photoKey: 'photos/c/x.jpg' };
    expect(itemToAthlete(athleteToItem(full))).toEqual(full);
  });

  it('athlete: omits an absent shortName on the round trip', () => {
    const { shortName: _omit, ...withoutShort } = athlete;
    const item = athleteToItem(withoutShort);
    expect('shortName' in item).toBe(false);
    expect(itemToAthlete(item)).toEqual(withoutShort);
  });

  it('athlete: migrates a legacy name-only item (no firstName/lastName) on read', () => {
    const legacy = {
      PK: 'COMP#worlds-2026',
      SK: 'ATHLETE#a1',
      athleteId: 'a1',
      compId: 'worlds-2026',
      name: 'Jane Doe',
      shortName: 'JD',
      birthDate: '2000-01-31',
      country: 'CH',
      gender: 'female',
    };
    expect(itemToAthlete(legacy)).toEqual(athlete);
  });

  // A legacy writer could store an explicit DynamoDB NULL rather than omitting
  // the attribute. The types say `string`, so only a test can hold this line.
  it('athlete: migrates a legacy item whose firstName/lastName are NULL, not absent', () => {
    const legacy = {
      PK: 'COMP#worlds-2026',
      SK: 'ATHLETE#a1',
      athleteId: 'a1',
      compId: 'worlds-2026',
      name: 'Jane Doe',
      firstName: null,
      lastName: null,
      shortName: 'JD',
      birthDate: '2000-01-31',
      country: 'CH',
      gender: 'female',
    };
    expect(itemToAthlete(legacy)).toEqual(athlete);
  });

  it('time: SK encodes round/athlete/id + round trip', () => {
    const item = timeToItem(time);
    expect(item.SK).toBe('TIME#qualification#a1#t1');
    expect(itemToTime(item)).toEqual(time);
    expect('matchId' in itemToTime(item)).toBe(false);
  });

  it('time: preserves a linked matchId', () => {
    const linked = { ...time, matchId: 'm1' };
    expect(itemToTime(timeToItem(linked))).toEqual(linked);
  });

  it('match: SK encodes discipline/gender/round/id + round trip', () => {
    const item = matchToItem(match);
    expect(item.SK).toBe('MATCH#speed#female#final#m1');
    expect(itemToMatch(item)).toEqual(match);
  });

  it('score: SK encodes round/athlete (one per athlete+round) + round trip', () => {
    const item = scoreToItem(score);
    expect(item.SK).toBe('SCORE#final#a1');
    expect(itemToScore(item)).toEqual(score);
    expect('dnf' in itemToScore(item)).toBe(false);
  });

  it('score: preserves dnf when present', () => {
    const dnf = { ...score, dnf: true };
    expect(itemToScore(scoreToItem(dnf))).toEqual(dnf);
  });

  it('score: preserves a linked matchId and omits an absent one', () => {
    expect('matchId' in itemToScore(scoreToItem(score))).toBe(false);
    const linked = { ...score, matchId: 'm1' };
    expect(itemToScore(scoreToItem(linked))).toEqual(linked);
  });
});

describe('SK move detection (immutable key parts)', () => {
  it('a time moves when round or athlete changes, not on attribute edits', () => {
    expect(timeNeedsMove(time, { round: 'final', athleteId: 'a1' })).toBe(true);
    expect(timeNeedsMove(time, { round: 'qualification', athleteId: 'a2' })).toBe(true);
    expect(timeNeedsMove(time, { round: 'qualification', athleteId: 'a1' })).toBe(false);
  });

  it('a match moves when discipline, gender, or round changes', () => {
    expect(matchNeedsMove(match, { discipline: 'speed', round: 'half', gender: 'female' })).toBe(
      true,
    );
    expect(matchNeedsMove(match, { discipline: 'speed', round: 'final', gender: 'male' })).toBe(
      true,
    );
    expect(
      matchNeedsMove(match, { discipline: 'freestyle', round: 'final', gender: 'female' }),
    ).toBe(true);
    expect(matchNeedsMove(match, { discipline: 'speed', round: 'final', gender: 'female' })).toBe(
      false,
    );
  });

  it('a score moves when round or athlete changes, not on component edits', () => {
    expect(scoreNeedsMove(score, { round: 'half', athleteId: 'a1' })).toBe(true);
    expect(scoreNeedsMove(score, { round: 'final', athleteId: 'a2' })).toBe(true);
    expect(scoreNeedsMove(score, { round: 'final', athleteId: 'a1' })).toBe(false);
  });
});
