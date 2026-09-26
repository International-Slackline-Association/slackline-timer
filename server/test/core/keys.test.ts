import { describe, expect, it } from 'vitest';

import {
  ATHLETE_SK_PREFIX,
  COMP_META_SK,
  MANAGER_SK_PREFIX,
  MATCH_SK_PREFIX,
  SCORE_SK_PREFIX,
  TIME_SK_PREFIX,
  athleteSk,
  compPk,
  managerSk,
  matchSk,
  matchSkPrefix,
  matchSkPrefixForDiscipline,
  matchSkPrefixForRound,
  parseAthleteSk,
  parseMatchSk,
  parseScoreSk,
  parseTimeSk,
  parseUserCompSk,
  scoreSk,
  scoreSkPrefix,
  timeSk,
  timeSkPrefix,
  userCompSk,
  userPk,
} from 'core/keys';

// Single-table key scheme for the competition data plane.
// See doc/dev/architecture.md ("Data model").

describe('partition key', () => {
  it('scopes by competition id', () => {
    expect(compPk('worlds-2026')).toBe('COMP#worlds-2026');
  });
});

describe('sort keys', () => {
  it('builds athlete keys', () => {
    expect(athleteSk('a1')).toBe('ATHLETE#a1');
  });

  it('builds time keys with round/athlete/id so a round can be range-queried', () => {
    expect(timeSk('qualification', 'a1', 't1')).toBe('TIME#qualification#a1#t1');
    expect(timeSkPrefix('qualification')).toBe('TIME#qualification#');
  });

  it('builds match keys with discipline/gender/round so a discipline can be range-queried', () => {
    expect(matchSk('speed', 'female', 'final', 'm1')).toBe('MATCH#speed#female#final#m1');
    expect(matchSkPrefixForDiscipline('speed')).toBe('MATCH#speed#');
    expect(matchSkPrefix('speed', 'female')).toBe('MATCH#speed#female#');
  });

  it('builds score keys with round/athlete so a round can be range-queried', () => {
    expect(scoreSk('final', 'a1')).toBe('SCORE#final#a1');
    expect(scoreSkPrefix('final')).toBe('SCORE#final#');
  });
});

describe('parseTimeSk', () => {
  it('round-trips a built time key', () => {
    expect(parseTimeSk(timeSk('half', 'a9', 't42'))).toEqual({
      round: 'half',
      athleteId: 'a9',
      timeId: 't42',
    });
  });

  it('returns null for a non-time key', () => {
    expect(parseTimeSk(athleteSk('a1'))).toBeNull();
    expect(parseTimeSk('garbage')).toBeNull();
  });
});

describe('meta + entity-wide prefixes', () => {
  it('uses a fixed META sort key for the competition item', () => {
    expect(COMP_META_SK).toBe('META');
  });

  it('exposes entity-wide prefixes that match their builders', () => {
    expect(athleteSk('a1').startsWith(ATHLETE_SK_PREFIX)).toBe(true);
    expect(timeSk('final', 'a1', 't1').startsWith(TIME_SK_PREFIX)).toBe(true);
    expect(matchSk('speed', 'male', 'final', 'm1').startsWith(MATCH_SK_PREFIX)).toBe(true);
    expect(scoreSk('final', 'a1').startsWith(SCORE_SK_PREFIX)).toBe(true);
  });

  it('narrows matches to a discipline + gender + round', () => {
    expect(matchSkPrefixForRound('speed', 'male', 'quarter')).toBe('MATCH#speed#male#quarter#');
    expect(
      matchSk('speed', 'male', 'quarter', 'm1').startsWith(
        matchSkPrefixForRound('speed', 'male', 'quarter'),
      ),
    ).toBe(true);
  });
});

describe('parseMatchSk / parseScoreSk / parseAthleteSk', () => {
  it('round-trips a built match key', () => {
    expect(parseMatchSk(matchSk('freestyle', 'female', 'small_final', 'm7'))).toEqual({
      discipline: 'freestyle',
      gender: 'female',
      round: 'small_final',
      matchId: 'm7',
    });
  });

  it('round-trips a built score key', () => {
    expect(parseScoreSk(scoreSk('final', 'a9'))).toEqual({ round: 'final', athleteId: 'a9' });
  });

  it('round-trips a built athlete key', () => {
    expect(parseAthleteSk(athleteSk('a3'))).toEqual({ athleteId: 'a3' });
  });

  it('returns null for foreign keys', () => {
    expect(parseMatchSk(timeSk('final', 'a1', 't1'))).toBeNull();
    expect(parseScoreSk(athleteSk('a1'))).toBeNull();
    expect(parseAthleteSk(COMP_META_SK)).toBeNull();
  });
});

describe('manager-grant keys (per-competition ACL)', () => {
  it('builds the forward grant key under the competition partition', () => {
    expect(managerSk('sub-abc')).toBe('MANAGER#sub-abc');
    expect(managerSk('sub-abc').startsWith(MANAGER_SK_PREFIX)).toBe(true);
  });

  it('builds the reverse user→competition adjacency key', () => {
    expect(userPk('sub-abc')).toBe('USER#sub-abc');
    expect(userCompSk('worlds-2026')).toBe('COMP#worlds-2026');
  });

  it('round-trips the reverse key back to a compId', () => {
    expect(parseUserCompSk(userCompSk('worlds-2026'))).toEqual({ compId: 'worlds-2026' });
    expect(parseUserCompSk('garbage')).toBeNull();
    expect(parseUserCompSk(managerSk('x'))).toBeNull();
  });
});
