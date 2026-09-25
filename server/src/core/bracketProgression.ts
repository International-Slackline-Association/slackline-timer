import type { Discipline, Gender, Match, MatchRound } from './types';

/**
 * Server-authoritative bracket seeding and advancement for the fixed 8-athlete
 * single-elimination tree (quarter → half → final + a small-final bronze match).
 *
 * This is the SERVER half of a topology that is duplicated — by necessity, no
 * npm workspaces — with the web bracket renderer (`web/src/app/util/bracket.ts`,
 * `BRACKET_SLOTS`). The renderer binds matches to SVG slots by `(round, position
 * order)`; this module MUST emit the same `(round, position)` numbering so the
 * art and the data agree. The geometry there forces these feeds:
 *
 *   quarter pos1 + quarter pos2  ->  half pos1   (half pos1 = winner(q1) vs winner(q2))
 *   quarter pos3 + quarter pos4  ->  half pos2   (half pos2 = winner(q3) vs winner(q4))
 *   half pos1    + half pos2     ->  final pos1  (final  = winner(h1) vs winner(h2))
 *   half pos1    + half pos2     ->  small_final (bronze = loser(h1)  vs loser(h2))
 *
 * To keep the top seeds 1 and 2 apart until the final, seed 1 must land in the
 * top half (quarter pos1/pos2) and seed 2 in the bottom half (quarter pos3/pos4).
 *
 * Every position emitted here is 1-based, matching BRACKET_SLOTS' `order`.
 *
 * Pure module: no DynamoDB imports. Mirrors the style of rankings/keys/mappers
 * — all topology is plain const data so the unit test can pin it.
 */

/**
 * Seed pairing for the four quarter-finals, keyed by quarter position (1..4).
 * Each entry is `[seedA, seedB]` as 1-based qualification ranks. Standard
 * 8-bracket seeding: 1v8, 4v5 in the top half; 2v7, 3v6 in the bottom half — so
 * 1 and 2 only meet in the final.
 */
export const QUARTER_SEED_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6],
] as const;

/**
 * Seed pairing for the top-4 semi-final bracket used for small fields (rules
 * S7/F11: <9 competitors seed semis, not quarters). Keyed by half position
 * (1..2), each `[seedA, seedB]` a 1-based qualification rank. half pos1 feeds
 * the final's athlete1 and pos2 feeds athlete2 (see `advanceTargets` half→final),
 * so seed 1 must sit in pos1 and seed 2 in pos2 to meet only in the final: 1v4,
 * 2v3. The two half winners play the final, the two losers the small final —
 * the existing half→final+small_final advancement needs no change.
 */
export const HALF_SEED_PAIRS: readonly (readonly [number, number])[] = [
  [1, 4],
  [2, 3],
] as const;

/** The two bracket entry stages a field can be seeded at. */
export type SeedStage = Extract<MatchRound, 'quarter' | 'half'>;

/**
 * A bracket row to upsert: identity is `(round, position)`, plus the two slots.
 * `roundName` is intentionally absent — seeded/advanced matches carry no display
 * override, so the client renders the standard round label (see `displayRoundName`).
 */
export interface BracketRow {
  round: MatchRound;
  position: number;
  athlete1Id?: string;
  athlete2Id?: string;
}

/** Thrown when seeding/advancing cannot proceed; mapped to 400 by the handler. */
export class BracketError extends Error {
  constructor(
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = 'BracketError';
  }
}

/** Map a seed-pairing table onto match rows for `round` (seed N → ranked[N-1]). */
const seedFromPairs = (
  pairs: readonly (readonly [number, number])[],
  round: SeedStage,
  rankedAthleteIds: string[],
  discipline: Discipline,
  gender: Gender,
): Omit<Match, 'matchId' | 'compId'>[] =>
  pairs.map(([seedA, seedB], i) => ({
    discipline,
    gender,
    round,
    position: i + 1,
    athlete1Id: rankedAthleteIds[seedA - 1],
    athlete2Id: rankedAthleteIds[seedB - 1],
  }));

/**
 * Build the four quarter-final rows from a qualification ranking (best → worst,
 * already ordered by the caller: speed = best time asc, freestyle = overall desc).
 * Throws `BracketError` when fewer than 8 athletes are ranked.
 */
export const seedQuarterMatches = (
  rankedAthleteIds: string[],
  discipline: Discipline,
  gender: Gender,
): Omit<Match, 'matchId' | 'compId'>[] => {
  if (rankedAthleteIds.length < 8) {
    throw new BracketError(
      `need at least 8 ranked athletes to seed, got ${rankedAthleteIds.length}`,
    );
  }
  return seedFromPairs(QUARTER_SEED_PAIRS, 'quarter', rankedAthleteIds, discipline, gender);
};

/**
 * Build the two semi-final rows (top 4) from a qualification ranking for a small
 * field (rules S7/F11). Throws `BracketError` when fewer than 4 athletes are ranked.
 */
export const seedHalfMatches = (
  rankedAthleteIds: string[],
  discipline: Discipline,
  gender: Gender,
): Omit<Match, 'matchId' | 'compId'>[] => {
  if (rankedAthleteIds.length < 4) {
    throw new BracketError(
      `need at least 4 ranked athletes to seed a semi-final bracket, got ${rankedAthleteIds.length}`,
    );
  }
  return seedFromPairs(HALF_SEED_PAIRS, 'half', rankedAthleteIds, discipline, gender);
};

/**
 * Pick the bracket entry stage for a field (rules S7/F11): ≥9 ranked athletes
 * seed a full top-8 quarter bracket; <9 seed a top-4 semi-final bracket. An
 * `override` lets the operator force either stage (rules can be amended on site).
 */
export const chooseSeedStage = (rankedCount: number, override?: SeedStage): SeedStage =>
  override ?? (rankedCount >= 9 ? 'quarter' : 'half');

/**
 * Seed the bracket entry round from a qualification ranking, choosing quarter
 * vs half by field size (or an explicit `override`). Reports the seeded `stage`
 * so the caller can confirm which bracket was built. The per-stage minimum is
 * still enforced (a `BracketError` propagates → 400).
 */
export const seedBracketMatches = (
  rankedAthleteIds: string[],
  discipline: Discipline,
  gender: Gender,
  override?: SeedStage,
): { stage: SeedStage; matches: Omit<Match, 'matchId' | 'compId'>[] } => {
  const stage = chooseSeedStage(rankedAthleteIds.length, override);
  const matches =
    stage === 'quarter'
      ? seedQuarterMatches(rankedAthleteIds, discipline, gender)
      : seedHalfMatches(rankedAthleteIds, discipline, gender);
  return { stage, matches };
};

/** A source match in the round being advanced FROM; its winner/loser feed downstream. */
export interface SourceMatch {
  position: number;
  athlete1Id?: string;
  athlete2Id?: string;
  winnerId?: string;
}

const loserOf = (m: SourceMatch): string | undefined => {
  if (m.winnerId === undefined) return undefined;
  if (m.winnerId === m.athlete1Id) return m.athlete2Id;
  if (m.winnerId === m.athlete2Id) return m.athlete1Id;
  return undefined;
};

const byPosition = (a: SourceMatch, b: SourceMatch): number => a.position - b.position;

/**
 * Given the matches of `fromRound` (their winners must already be set), compute
 * the downstream rows to upsert. Ordering is by `position`. Feeds follow the
 * BRACKET_SLOTS geometry documented above:
 *   - quarter -> two half rows (h1 = w(q1) vs w(q2), h2 = w(q3) vs w(q4))
 *   - half    -> final (w(h1) vs w(h2)) PLUS small_final (l(h1) vs l(h2))
 * `fromRound` other than 'quarter'/'half' has no downstream and returns [].
 */
export const advanceTargets = (
  fromRound: MatchRound,
  sourceMatches: SourceMatch[],
): BracketRow[] => {
  const sorted = [...sourceMatches].sort(byPosition);

  if (fromRound === 'quarter') {
    if (sorted.length !== 4) {
      throw new BracketError(
        `quarter round must have exactly 4 matches to advance, got ${sorted.length}`,
      );
    }
    const [q1, q2, q3, q4] = sorted;
    return [
      {
        round: 'half',
        position: 1,
        athlete1Id: q1.winnerId,
        athlete2Id: q2.winnerId,
      },
      {
        round: 'half',
        position: 2,
        athlete1Id: q3.winnerId,
        athlete2Id: q4.winnerId,
      },
    ];
  }

  if (fromRound === 'half') {
    if (sorted.length !== 2) {
      throw new BracketError(
        `half round must have exactly 2 matches to advance, got ${sorted.length}`,
      );
    }
    const [h1, h2] = sorted;
    return [
      {
        round: 'final',
        position: 1,
        athlete1Id: h1.winnerId,
        athlete2Id: h2.winnerId,
      },
      {
        round: 'small_final',
        position: 1,
        athlete1Id: loserOf(h1),
        athlete2Id: loserOf(h2),
      },
    ];
  }

  return [];
};
