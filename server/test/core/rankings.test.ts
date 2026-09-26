import { describe, expect, it } from 'vitest';

import {
  bestTimeByAthlete,
  firstThreeTimesForAthlete,
  rankAthletesByBestTime,
  rankAthletesByOverall,
  rankAthletesWithAllTimes,
} from 'core/rankings';
import { DNF_SENTINEL, computeOverall, type Athlete, type Score, type Time } from 'core/types';

const athlete = (id: string, gender: 'male' | 'female', name = `Athlete ${id}`): Athlete => ({
  athleteId: id,
  compId: 'c1',
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  name,
  shortName: id.toUpperCase(),
  birthDate: '2000-01-01',
  country: 'CH',
  gender,
});

let seq = 0;
const time = (athleteId: string, timeMs: number, startTime: number, round = 'final'): Time => ({
  timeId: `t${++seq}`,
  compId: 'c1',
  athleteId,
  round: round as Time['round'],
  timeMs,
  startTime,
});

describe('bestTimeByAthlete', () => {
  it('keeps the minimum per athlete', () => {
    const best = bestTimeByAthlete([
      time('a', 12_000, 1),
      time('a', 11_000, 2),
      time('b', 9_000, 3),
    ]);
    expect(best.get('a')).toBe(11_000);
    expect(best.get('b')).toBe(9_000);
  });

  it('a real run beats a DNF (sentinel is just a huge time)', () => {
    const best = bestTimeByAthlete([time('a', DNF_SENTINEL, 1), time('a', 14_500, 2)]);
    expect(best.get('a')).toBe(14_500);
  });
});

describe('rankAthletesByBestTime (get_athletes_by_best_time_in_round)', () => {
  const anna = athlete('anna', 'female', 'Anna');
  const bea = athlete('bea', 'female', 'Bea');
  const cara = athlete('cara', 'female', 'Cara');
  const dave = athlete('dave', 'male', 'Dave');
  const athletes = [anna, bea, cara, dave];

  it('ranks by best time ascending within the gender', () => {
    const times = [
      time('anna', 12_000, 10),
      time('anna', 10_500, 20),
      time('bea', 11_000, 30),
      time('dave', 8_000, 40), // wrong gender — excluded
    ];
    const ranking = rankAthletesByBestTime(athletes, times, 'female');
    expect(ranking.map((r) => [r.athlete.athleteId, r.bestTimeMs])).toEqual([
      ['anna', 10_500],
      ['bea', 11_000],
    ]);
  });

  it('excludes athletes without a time in the round (inner-join semantics)', () => {
    const ranking = rankAthletesByBestTime(athletes, [time('bea', 9_000, 1)], 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['bea']);
  });

  it('sorts DNF-only athletes last, keeping the sentinel as their best', () => {
    const times = [time('anna', DNF_SENTINEL, 1), time('bea', 13_000, 2)];
    const ranking = rankAthletesByBestTime(athletes, times, 'female');
    expect(ranking.map((r) => [r.athlete.athleteId, r.bestTimeMs])).toEqual([
      ['bea', 13_000],
      ['anna', DNF_SENTINEL],
    ]);
  });

  it('breaks an equal best time on the second-best time (faster backup wins)', () => {
    const times = [
      time('cara', 10_000, 1),
      time('cara', 12_000, 2),
      time('anna', 10_000, 3),
      time('anna', 11_000, 4),
    ];
    const ranking = rankAthletesByBestTime(athletes, times, 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });

  it('an athlete with a real second-best outranks one whose only run is the tied best', () => {
    // A real backup (any finite time) beats the absent one (treated as +Infinity).
    const times = [time('bea', 10_000, 1), time('anna', 10_000, 2), time('anna', 18_000, 3)];
    const ranking = rankAthletesByBestTime(athletes, times, 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'bea']);
  });

  it('breaks an equal best AND equal second-best by athlete name for a stable order', () => {
    const times = [time('cara', 10_000, 1), time('anna', 10_000, 2)];
    const ranking = rankAthletesByBestTime(athletes, times, 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });
});

describe('rankAthletesWithAllTimes (get_athletes_by_best_time_with_all_times)', () => {
  it('attaches every attempt chronologically (start_time asc)', () => {
    const anna = athlete('anna', 'female', 'Anna');
    const times = [
      time('anna', 12_000, 300),
      time('anna', 10_500, 100),
      time('anna', DNF_SENTINEL, 200),
    ];
    const ranking = rankAthletesWithAllTimes([anna], times, 'female');
    expect(ranking).toHaveLength(1);
    expect(ranking[0].bestTimeMs).toBe(10_500);
    expect(ranking[0].allTimesMs).toEqual([10_500, DNF_SENTINEL, 12_000]);
  });
});

describe('rankAthletesByOverall (freestyle judged ranking)', () => {
  const anna = athlete('anna', 'female', 'Anna');
  const bea = athlete('bea', 'female', 'Bea');
  const cara = athlete('cara', 'female', 'Cara');
  const dave = athlete('dave', 'male', 'Dave');
  const athletes = [anna, bea, cara, dave];

  const score = (athleteId: string, overall: number, round = 'final'): Score => ({
    scoreId: `s-${athleteId}-${round}`,
    compId: 'c1',
    athleteId,
    round: round as Score['round'],
    difficulty: 0,
    combo: 0,
    style: 0,
    bestTrick: 0,
    controlPenalty: 0,
    overall,
  });

  const dnfScore = (athleteId: string, round = 'final'): Score => ({
    ...score(athleteId, 0, round),
    dnf: true,
  });

  it('ranks by overall descending within the gender', () => {
    const scores = [
      score('anna', 24),
      score('bea', 31),
      score('dave', 99), // wrong gender — excluded
    ];
    const ranking = rankAthletesByOverall(athletes, scores, 'female');
    expect(ranking.map((r) => [r.athlete.athleteId, r.overall])).toEqual([
      ['bea', 31],
      ['anna', 24],
    ]);
  });

  it('excludes athletes without a score in the round (inner-join semantics)', () => {
    const ranking = rankAthletesByOverall(athletes, [score('bea', 12)], 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['bea']);
  });

  // Component-bearing score for the judged tiebreak (overall left as the sum so
  // both athletes can tie on overall while differing on a single component).
  const compScore = (
    athleteId: string,
    overall: number,
    comps: Partial<Pick<Score, 'difficulty' | 'combo' | 'style' | 'bestTrick'>>,
    round = 'final',
  ): Score => ({ ...score(athleteId, overall, round), ...comps });

  it('breaks an equal overall on the highest difficulty first', () => {
    const ranking = rankAthletesByOverall(
      athletes,
      [compScore('cara', 20, { difficulty: 6 }), compScore('anna', 20, { difficulty: 9 })],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });

  it('tiebreaks two float-noise-equal overalls on the components (ADR 0039)', () => {
    // Both sums are mathematically 26.7 from different component mixes; raw
    // addition leaks ~1e-14 apart, but computeOverall normalizes at write so the
    // stored overalls are bit-identical and the difficulty tiebreak decides.
    const annaOverall = computeOverall({
      difficulty: 9.1,
      combo: 6.2,
      style: 6.3,
      bestTrick: 5.4,
      controlPenalty: 0.3,
    });
    const caraOverall = computeOverall({
      difficulty: 8.1,
      combo: 7.2,
      style: 6.3,
      bestTrick: 5.4,
      controlPenalty: 0.3,
    });
    expect(annaOverall).toBe(caraOverall);
    const ranking = rankAthletesByOverall(
      athletes,
      [
        compScore('cara', caraOverall, { difficulty: 8.1 }),
        compScore('anna', annaOverall, { difficulty: 9.1 }),
      ],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });

  it('falls through difficulty→combo→style→bestTrick in priority order', () => {
    // bestTrick is intentionally inverted to prove it is NOT consulted once
    // style (the first differing component) separates them.
    const ranking = rankAthletesByOverall(
      athletes,
      [
        compScore('anna', 20, { difficulty: 5, combo: 5, style: 2, bestTrick: 9 }),
        compScore('bea', 20, { difficulty: 5, combo: 5, style: 5, bestTrick: 5 }),
        compScore('cara', 20, { difficulty: 5, combo: 5, style: 8, bestTrick: 1 }),
      ],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['cara', 'bea', 'anna']);
  });

  it('breaks an all-equal overall AND every component by athlete name, carrying the Score', () => {
    const ranking = rankAthletesByOverall(
      athletes,
      [score('cara', 20), score('anna', 20)],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
    expect(ranking[0].score.scoreId).toBe('s-anna-final');
  });

  it('sorts a DNF below a genuine 0.0 yet keeps it in the field', () => {
    const ranking = rankAthletesByOverall(
      athletes,
      [score('anna', 20), score('bea', 0), dnfScore('cara')],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'bea', 'cara']);
    expect(ranking[2].dnf).toBe(true);
  });

  it('breaks ties among multiple DNFs by name ascending', () => {
    const ranking = rankAthletesByOverall(athletes, [dnfScore('cara'), dnfScore('anna')], 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });

  it('applies the name tiebreak to DNF pairs even against the listing order', () => {
    // Listing order (cara before anna) deliberately contradicts name order: a
    // comparator that returns NaN for -Infinity minus -Infinity leaves the sort
    // undefined and this ordering unfixed.
    const ranking = rankAthletesByOverall(
      [cara, bea, anna, dave],
      [dnfScore('cara'), dnfScore('anna')],
      'female',
    );
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna', 'cara']);
  });

  it('still excludes an athlete with no score even when a DNF is present', () => {
    const ranking = rankAthletesByOverall(athletes, [dnfScore('anna')], 'female');
    expect(ranking.map((r) => r.athlete.athleteId)).toEqual(['anna']);
  });
});

describe('firstThreeTimesForAthlete (get_top_three_times_for_athlete)', () => {
  it('returns the first three attempts chronologically — not the best three', () => {
    const times = [
      time('a', 15_000, 400),
      time('a', 9_000, 500), // fastest, but fourth chronologically
      time('a', 12_000, 100),
      time('a', 13_000, 200),
      time('a', 14_000, 300),
    ];
    const firstThree = firstThreeTimesForAthlete(times, 'a', 'final');
    expect(firstThree.map((t) => t.timeMs)).toEqual([12_000, 13_000, 14_000]);
  });

  it('filters by athlete and round', () => {
    const times = [
      time('a', 1_000, 1, 'training'),
      time('b', 2_000, 2, 'final'),
      time('a', 3_000, 3, 'final'),
    ];
    expect(firstThreeTimesForAthlete(times, 'a', 'final').map((t) => t.timeMs)).toEqual([3_000]);
  });
});
