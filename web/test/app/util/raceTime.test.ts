import { describe, expect, it } from 'vitest';

import type { Match, Time } from 'app/types';
import {
  activeStartLanes,
  addRunWin,
  attemptCount,
  clearWinnerInput,
  dnfTimeInput,
  editTimeInput,
  elapsedMs,
  finishTimeInput,
  laneRunWins,
  matchToInput,
  QUALI_ATTEMPT_CAP,
  qualiAttemptCapReached,
  removeRunWin,
  runWinningLane,
  seriesWinnerId,
  tallyFromTimes,
  winsFor,
} from 'app/util/raceTime';
import type { TimeInput } from 'app/api/times';
import { DNF_SENTINEL } from 'app/util/time';

const baseMatch: Match = {
  matchId: 'm1',
  compId: 'c1',
  discipline: 'speed',
  round: 'quarter',
  roundName: 'Quarter 1',
  gender: 'male',
  position: 1,
  athlete1Id: 'a1',
  athlete2Id: 'a2',
};

describe('activeStartLanes', () => {
  it('starts only the assigned lane on a solo run (the quali pattern)', () => {
    expect(activeStartLanes({ 1: 'a1', 2: '' })).toEqual([1]);
    expect(activeStartLanes({ 1: '', 2: 'a2' })).toEqual([2]);
  });

  it('starts both lanes for a match (both assigned)', () => {
    expect(activeStartLanes({ 1: 'a1', 2: 'a2' })).toEqual([1, 2]);
  });

  it('starts both lanes when no athlete is selected (warmup / untracked timing)', () => {
    expect(activeStartLanes({ 1: '', 2: '' })).toEqual([1, 2]);
  });
});

describe('elapsedMs', () => {
  it('is the difference between stop and start', () => {
    expect(elapsedMs(1_000, 84_450)).toBe(83_450);
  });

  it('clamps negative skew to zero', () => {
    expect(elapsedMs(5_000, 4_000)).toBe(0);
  });
});

describe('finishTimeInput', () => {
  it('builds a Time carrying the race start', () => {
    expect(finishTimeInput('a1', 'qualification', 1_000, 84_450)).toEqual({
      athleteId: 'a1',
      round: 'qualification',
      timeMs: 83_450,
      startTime: 1_000,
    });
  });

  it('records nothing when no athlete is assigned to the lane', () => {
    expect(finishTimeInput('', 'final', 1_000, 84_450)).toBeNull();
  });

  it('records nothing when the race has not started', () => {
    expect(finishTimeInput('a1', 'final', null, 84_450)).toBeNull();
  });

  it('carries a matchId when given and omits it otherwise', () => {
    expect(finishTimeInput('a1', 'final', 1_000, 84_450, 'm1')).toHaveProperty('matchId', 'm1');
    const noMatch = finishTimeInput('a1', 'final', 1_000, 84_450);
    expect(noMatch && 'matchId' in noMatch).toBe(false);
  });
});

describe('dnfTimeInput', () => {
  it('builds a DNF Time with the sentinel and the race start when known', () => {
    expect(dnfTimeInput('a1', 'final', 1_000)).toEqual({
      athleteId: 'a1',
      round: 'final',
      timeMs: DNF_SENTINEL,
      startTime: 1_000,
    });
  });

  it('omits startTime when the race has not started', () => {
    expect(dnfTimeInput('a1', 'final', null)).toEqual({
      athleteId: 'a1',
      round: 'final',
      timeMs: DNF_SENTINEL,
    });
  });

  it('records nothing without an athlete', () => {
    expect(dnfTimeInput('', 'final', 1_000)).toBeNull();
  });

  it('carries a matchId when given', () => {
    expect(dnfTimeInput('a1', 'final', 1_000, 'm1')).toHaveProperty('matchId', 'm1');
  });
});

describe('editTimeInput', () => {
  const recorded: TimeInput = {
    athleteId: 'a1',
    round: 'final',
    timeMs: 12_340,
    startTime: 1_000,
    matchId: 'm1',
  };

  it('overrides timeMs while preserving the other fields', () => {
    expect(editTimeInput(recorded, 12_270)).toEqual({
      athleteId: 'a1',
      round: 'final',
      timeMs: 12_270,
      startTime: 1_000,
      matchId: 'm1',
    });
  });

  it('keeps a record with no matchId match-less', () => {
    const { matchId: _omit, ...noMatch } = recorded;
    const result = editTimeInput(noMatch, 9_999);
    expect(result).toEqual({ athleteId: 'a1', round: 'final', timeMs: 9_999, startTime: 1_000 });
    expect('matchId' in result).toBe(false);
  });

  it('can correct a DNF into a finishing time', () => {
    expect(editTimeInput({ ...recorded, timeMs: DNF_SENTINEL }, 11_000)).toHaveProperty(
      'timeMs',
      11_000,
    );
  });
});

describe('matchToInput', () => {
  it('drops matchId/compId and preserves the immutable SK + athlete fields', () => {
    expect(matchToInput(baseMatch)).toEqual({
      discipline: 'speed',
      round: 'quarter',
      roundName: 'Quarter 1',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
  });

  it('omits optional athlete/winner fields when absent', () => {
    const sparse: Match = {
      matchId: 'm2',
      compId: 'c1',
      discipline: 'freestyle',
      round: 'final',
      roundName: 'Final',
      gender: 'female',
      position: 2,
    };
    const input = matchToInput(sparse);
    expect(input).toEqual({
      discipline: 'freestyle',
      round: 'final',
      roundName: 'Final',
      gender: 'female',
      position: 2,
    });
    expect('athlete1Id' in input).toBe(false);
    expect('winnerId' in input).toBe(false);
  });

  it('carries an existing winnerId through via the optional spread', () => {
    expect(matchToInput({ ...baseMatch, winnerId: 'a1' })).toHaveProperty('winnerId', 'a1');
  });
});

describe('clearWinnerInput', () => {
  it('strips the winnerId key while keeping the immutable + athlete fields', () => {
    const input = clearWinnerInput({ ...baseMatch, winnerId: 'a1' });
    expect('winnerId' in input).toBe(false);
    expect(input).toEqual({
      discipline: 'speed',
      round: 'quarter',
      roundName: 'Quarter 1',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
  });
});

describe('runWinningLane', () => {
  it('awards the faster non-DNF lane', () => {
    expect(runWinningLane({ 1: 12_000, 2: 13_500 })).toBe(1);
    expect(runWinningLane({ 1: 14_200, 2: 13_100 })).toBe(2);
  });

  it('awards the finishing lane when the other DNFs', () => {
    expect(runWinningLane({ 1: 12_000, 2: DNF_SENTINEL })).toBe(1);
    expect(runWinningLane({ 1: DNF_SENTINEL, 2: 12_000 })).toBe(2);
  });

  it('awards no win on one-lane results, an exact tie, or both-DNF', () => {
    expect(runWinningLane({ 1: 12_000, 2: null })).toBeNull();
    expect(runWinningLane({ 1: null, 2: null })).toBeNull();
    expect(runWinningLane({ 1: 12_345, 2: 12_345 })).toBeNull();
    expect(runWinningLane({ 1: DNF_SENTINEL, 2: DNF_SENTINEL })).toBeNull();
  });
});

describe('series tally (athlete-keyed, ADR 0044)', () => {
  it('seriesWinnerId returns the athlete that reached 2 run-wins', () => {
    expect(seriesWinnerId({ a1: 2 })).toBe('a1');
    expect(seriesWinnerId({ a1: 1, a2: 2 })).toBe('a2');
  });

  it('seriesWinnerId returns null while the series is still live', () => {
    expect(seriesWinnerId({})).toBeNull();
    expect(seriesWinnerId({ a1: 1 })).toBeNull();
    expect(seriesWinnerId({ a1: 1, a2: 1 })).toBeNull();
  });

  it('addRunWin / removeRunWin credit and undo per athlete (floored at 0)', () => {
    const wins = addRunWin(addRunWin({}, 'a1'), 'a1');
    expect(wins).toEqual({ a1: 2 });
    expect(removeRunWin(wins, 'a1')).toEqual({ a1: 1 });
    expect(removeRunWin({}, 'a1')).toEqual({ a1: 0 });
  });

  it('winsFor reads 0 for an unassigned lane and unknown athletes', () => {
    expect(winsFor({ a1: 2 }, 'a1')).toBe(2);
    expect(winsFor({ a1: 2 }, 'a2')).toBe(0);
    expect(winsFor({ a1: 2 }, '')).toBe(0);
  });

  it('laneRunWins projects the tally onto the live pairing — a swap flips the view', () => {
    const wins = { a1: 2, a2: 1 };
    expect(laneRunWins(wins, { 1: 'a1', 2: 'a2' })).toEqual({ 1: 2, 2: 1 });
    // The athletes switch sides: each keeps their own run-wins.
    expect(laneRunWins(wins, { 1: 'a2', 2: 'a1' })).toEqual({ 1: 1, 2: 2 });
    expect(laneRunWins(wins, { 1: '', 2: 'a1' })).toEqual({ 1: 0, 2: 2 });
  });
});

describe('tallyFromTimes', () => {
  const time = (athleteId: string, startTime: number, timeMs: number, matchId = 'm1'): Time => ({
    timeId: `${athleteId}-${startTime}`,
    compId: 'c1',
    athleteId,
    round: 'final',
    timeMs,
    startTime,
    matchId,
  });

  it('credits each persisted run to the winning athlete', () => {
    // Run 1 (start 1000): a1 wins. Run 2 (start 2000): a2 wins.
    const times = [
      time('a1', 1000, 5000),
      time('a2', 1000, 6000),
      time('a1', 2000, 7000),
      time('a2', 2000, 6500),
    ];
    expect(tallyFromTimes(baseMatch, times)).toEqual({ a1: 1, a2: 1 });
  });

  it('awards nothing for a half-recorded run, a tie, or a both-DNF run', () => {
    const times = [
      time('a1', 1000, 5000), // half-run: a2 never recorded
      time('a1', 2000, 6000),
      time('a2', 2000, 6000), // exact tie
      time('a1', 3000, DNF_SENTINEL),
      time('a2', 3000, DNF_SENTINEL), // both DNF
    ];
    expect(tallyFromTimes(baseMatch, times)).toEqual({});
  });

  it('ignores Times of other matches and foreign athletes', () => {
    const times = [
      time('a1', 1000, 5000, 'm2'),
      time('a2', 1000, 6000, 'm2'),
      time('a9', 2000, 5000), // not in the match
      time('a2', 2000, 6000),
    ];
    expect(tallyFromTimes(baseMatch, times)).toEqual({});
  });
});

describe('attemptCount / qualiAttemptCapReached', () => {
  const time = (athleteId: string, round: Time['round'], timeMs = 5_000): Time => ({
    timeId: `${athleteId}-${round}-${timeMs}`,
    compId: 'c1',
    athleteId,
    round,
    timeMs,
    startTime: 1_000,
  });

  const times: Time[] = [
    time('a1', 'qualification', 5_000),
    time('a1', 'qualification', DNF_SENTINEL), // a DNF is a used attempt
    time('a1', 'final', 4_800),
    time('a2', 'qualification', 5_200),
  ];

  it('counts an athlete’s Times in a round (DNFs included)', () => {
    expect(attemptCount(times, 'a1', 'qualification')).toBe(2);
    expect(attemptCount(times, 'a2', 'qualification')).toBe(1);
    expect(attemptCount(times, 'a1', 'final')).toBe(1);
  });

  it('is zero for an unassigned lane or an athlete with no Times', () => {
    expect(attemptCount(times, '', 'qualification')).toBe(0);
    expect(attemptCount(times, 'a3', 'qualification')).toBe(0);
  });

  it('caps qualification at two recorded attempts (rule S5)', () => {
    expect(QUALI_ATTEMPT_CAP).toBe(2);
    expect(qualiAttemptCapReached(times, 'a1', 'qualification')).toBe(true);
    expect(qualiAttemptCapReached(times, 'a2', 'qualification')).toBe(false);
  });

  it('only caps qualification — other rounds stay unbounded', () => {
    const finals = [
      time('a1', 'final', 4_800),
      time('a1', 'final', 4_700),
      time('a1', 'final', 4_600),
    ];
    expect(qualiAttemptCapReached(finals, 'a1', 'final')).toBe(false);
    expect(qualiAttemptCapReached(finals, 'a1', 'training')).toBe(false);
  });

  it('never caps an unassigned lane', () => {
    expect(qualiAttemptCapReached(times, '', 'qualification')).toBe(false);
  });
});
