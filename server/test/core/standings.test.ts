import { describe, expect, it } from 'vitest';

import {
  computeCombinedRanking,
  computeOverallStandings,
  type StandingsPlacement,
} from 'core/standings';
import type { Match } from 'core/types';

type BracketMatch = Pick<Match, 'round' | 'position' | 'athlete1Id' | 'athlete2Id' | 'winnerId'>;

const match = (
  round: Match['round'],
  position: number,
  athlete1Id?: string,
  athlete2Id?: string,
  winnerId?: string,
): BracketMatch => ({ round, position, athlete1Id, athlete2Id, winnerId });

/** Quali order q1 (best) … q8; standard seeding 1v8 / 4v5 / 2v7 / 3v6. */
const QUALI = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

const seededQuarters = (winners: (string | undefined)[] = []): BracketMatch[] => [
  match('quarter', 1, 'q1', 'q8', winners[0]),
  match('quarter', 2, 'q4', 'q5', winners[1]),
  match('quarter', 3, 'q2', 'q7', winners[2]),
  match('quarter', 4, 'q3', 'q6', winners[3]),
];

const brief = (rows: StandingsPlacement[]) => rows.map((r) => [r.rank, r.athleteId, r.source]);

describe('computeOverallStandings', () => {
  it('places a fully decided 8-bracket: final 1-2, small final 3-4, quarter losers 5-8 by quali, tail 9+', () => {
    const matches: BracketMatch[] = [
      ...seededQuarters(['q1', 'q5', 'q2', 'q3']),
      match('half', 1, 'q1', 'q5', 'q5'),
      match('half', 2, 'q2', 'q3', 'q2'),
      match('final', 1, 'q5', 'q2', 'q2'),
      match('small_final', 1, 'q1', 'q3', 'q3'),
    ];

    const rows = computeOverallStandings(matches, QUALI);

    expect(brief(rows)).toEqual([
      [1, 'q2', 'final'],
      [2, 'q5', 'final'],
      [3, 'q3', 'small_final'],
      [4, 'q1', 'small_final'],
      // Quarter losers by quali rank.
      [5, 'q4', 'quarter'],
      [6, 'q6', 'quarter'],
      [7, 'q7', 'quarter'],
      [8, 'q8', 'quarter'],
      [9, 'q9', 'qualification'],
      [10, 'q10', 'qualification'],
    ]);
    expect(rows.every((r) => r.provisional === undefined)).toBe(true);
  });

  it('marks undecided final and small-final pairs provisional, ordered by quali', () => {
    const matches: BracketMatch[] = [
      match('final', 1, 'q5', 'q2'),
      match('small_final', 1, 'q3', 'q1'),
    ];

    const rows = computeOverallStandings(matches, QUALI);

    expect(brief(rows).slice(0, 4)).toEqual([
      [1, 'q2', 'final'],
      [2, 'q5', 'final'],
      [3, 'q1', 'small_final'],
      [4, 'q3', 'small_final'],
    ]);
    expect(rows.slice(0, 4).every((r) => r.provisional === true)).toBe(true);
  });

  it('degrades to the quali ranking, all provisional, when no bracket exists', () => {
    const rows = computeOverallStandings([], ['a', 'b', 'c']);

    expect(brief(rows)).toEqual([
      [1, 'a', 'qualification'],
      [2, 'b', 'qualification'],
      [3, 'c', 'qualification'],
    ]);
    expect(rows.every((r) => r.provisional === true)).toBe(true);
  });

  it('degrades to the quali order (provisional) when the bracket is seeded but undecided', () => {
    const rows = computeOverallStandings(seededQuarters(), QUALI);

    expect(rows.slice(0, 8).map((r) => r.athleteId)).toEqual(QUALI.slice(0, 8));
    expect(rows.slice(0, 8).every((r) => r.provisional === true)).toBe(true);
    // The tail is firm once a bracket pins its membership.
    expect(brief(rows).slice(8)).toEqual([
      [9, 'q9', 'qualification'],
      [10, 'q10', 'qualification'],
    ]);
    expect(rows.slice(8).every((r) => r.provisional === undefined)).toBe(true);
  });

  it('floats not-yet-advanced quarter winners into the provisional top 4', () => {
    const rows = computeOverallStandings(seededQuarters(['q8', 'q4', undefined, undefined]), QUALI);

    // Winners q8/q4 lead (by quali order), then the rest of the quarter band.
    expect(brief(rows).slice(0, 2)).toEqual([
      [1, 'q4', 'quarter'],
      [2, 'q8', 'quarter'],
    ]);
    expect(rows.slice(0, 8).every((r) => r.provisional === true)).toBe(true);
  });

  it('starts the tail at 5 for a halves-only (top-4) bracket', () => {
    const matches: BracketMatch[] = [match('half', 1, 'q1', 'q4'), match('half', 2, 'q2', 'q3')];

    const rows = computeOverallStandings(matches, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);

    expect(brief(rows)).toEqual([
      [1, 'q1', 'half'],
      [2, 'q2', 'half'],
      [3, 'q3', 'half'],
      [4, 'q4', 'half'],
      [5, 'q5', 'qualification'],
      [6, 'q6', 'qualification'],
    ]);
    expect(rows.slice(0, 4).every((r) => r.provisional === true)).toBe(true);
  });

  it('sorts a no-quali seeded athlete last in its band, tie-broken by name', () => {
    const quarters: BracketMatch[] = [
      match('quarter', 1, 'q1', 'wild-b', 'q1'),
      match('quarter', 2, 'q4', 'wild-a', 'q4'),
      match('quarter', 3, 'q2', 'q7', 'q2'),
      match('quarter', 4, 'q3', 'q6', 'q3'),
    ];
    const names = new Map([
      ['wild-a', 'Ada Aa'],
      ['wild-b', 'Zed Zz'],
    ]);

    const rows = computeOverallStandings(quarters, ['q1', 'q2', 'q3', 'q4', 'q6', 'q7'], names);

    // Losers: ranked q6/q7 first (quali), then the two unranked by name.
    expect(brief(rows).slice(4, 8)).toEqual([
      [5, 'q6', 'quarter'],
      [6, 'q7', 'quarter'],
      [7, 'wild-a', 'quarter'],
      [8, 'wild-b', 'quarter'],
    ]);
  });

  it('keeps an athlete in its highest band only (dedupe across rounds)', () => {
    const matches: BracketMatch[] = [
      ...seededQuarters(['q1', 'q5', 'q2', 'q3']),
      match('half', 1, 'q1', 'q5', 'q1'),
      match('half', 2, 'q2', 'q3', 'q2'),
      match('final', 1, 'q1', 'q2', 'q1'),
      match('small_final', 1, 'q5', 'q3', 'q3'),
    ];

    const rows = computeOverallStandings(matches, QUALI);

    const ids = rows.map((r) => r.athleteId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(brief(rows)[0]).toEqual([1, 'q1', 'final']);
  });

  it('ignores test and qualification matches', () => {
    const matches: BracketMatch[] = [
      match('test', 1, 'x', 'y', 'x'),
      match('qualification', 1, 'a', 'b', 'b'),
    ];

    const rows = computeOverallStandings(matches, ['a', 'b']);

    // No bracket observed → pure quali passthrough, all provisional.
    expect(brief(rows)).toEqual([
      [1, 'a', 'qualification'],
      [2, 'b', 'qualification'],
    ]);
    expect(rows.every((r) => r.provisional === true)).toBe(true);
  });

  it('reserves a rank for a TBD bracket slot (tail floor from the observed bracket)', () => {
    // One quarter has an empty second slot: 7 bracket athletes, tail still 9+.
    const quarters: BracketMatch[] = [
      match('quarter', 1, 'q1', 'q8', 'q1'),
      match('quarter', 2, 'q4', 'q5', 'q4'),
      match('quarter', 3, 'q2', 'q7', 'q2'),
      match('quarter', 4, 'q3', undefined, 'q3'),
    ];
    const quali = QUALI.filter((id) => id !== 'q6'); // 7 bracket athletes + q9/q10 tail

    const rows = computeOverallStandings(quarters, quali);

    expect(rows).toHaveLength(9);
    expect(brief(rows).slice(7)).toEqual([
      [9, 'q9', 'qualification'],
      [10, 'q10', 'qualification'],
    ]);
  });
});

describe('computeCombinedRanking', () => {
  const placement = (athleteId: string, rank: number, provisional?: true): StandingsPlacement => ({
    athleteId,
    rank,
    source: 'final',
    ...(provisional ? { provisional } : {}),
  });

  it('averages the two discipline ranks over the intersection only', () => {
    const speed = [placement('a', 1), placement('b', 2), placement('speed-only', 3)];
    const freestyle = [placement('b', 1), placement('a', 3), placement('free-only', 2)];

    const rows = computeCombinedRanking(speed, freestyle);

    expect(rows).toEqual([
      { athleteId: 'b', rank: 1, combined: 1.5, speedRank: 2, freestyleRank: 1 },
      { athleteId: 'a', rank: 2, combined: 2, speedRank: 1, freestyleRank: 3 },
    ]);
  });

  it('shares the rank on equal averages, 1224-style', () => {
    const speed = [placement('a', 1), placement('b', 2), placement('c', 3)];
    const freestyle = [placement('b', 1), placement('a', 2), placement('c', 3)];

    const rows = computeCombinedRanking(speed, freestyle);

    expect(rows.map((r) => [r.rank, r.combined])).toEqual([
      [1, 1.5],
      [1, 1.5],
      [3, 3],
    ]);
  });

  it('orders equal averages by the better single best rank, then name', () => {
    // Both average 2.5; a's best single rank (1) beats b's (2).
    const speed = [placement('a', 1), placement('b', 2)];
    const freestyle = [placement('b', 3), placement('a', 4)];
    expect(computeCombinedRanking(speed, freestyle).map((r) => r.athleteId)).toEqual(['a', 'b']);

    // Mirrored ranks (best single rank ties too) → name decides.
    const names = new Map([
      ['a', 'Zed Zz'],
      ['b', 'Ada Aa'],
    ]);
    const mirroredSpeed = [placement('a', 1), placement('b', 2)];
    const mirroredFreestyle = [placement('b', 1), placement('a', 2)];
    expect(
      computeCombinedRanking(mirroredSpeed, mirroredFreestyle, names).map((r) => r.athleteId),
    ).toEqual(['b', 'a']);
  });

  it('propagates provisional from either input placement', () => {
    const speed = [placement('a', 1, true), placement('b', 2)];
    const freestyle = [placement('a', 1), placement('b', 2, true)];

    const rows = computeCombinedRanking(speed, freestyle);

    expect(rows.every((r) => r.provisional === true)).toBe(true);
  });

  it('is firm when both input placements are firm', () => {
    const rows = computeCombinedRanking([placement('a', 1)], [placement('a', 1)]);
    expect(rows).toEqual([
      { athleteId: 'a', rank: 1, combined: 1, speedRank: 1, freestyleRank: 1 },
    ]);
  });

  it('is empty when a discipline has no standings', () => {
    expect(computeCombinedRanking([], [placement('a', 1)])).toEqual([]);
    expect(computeCombinedRanking([placement('a', 1)], [])).toEqual([]);
  });
});
