import { describe, expect, it } from 'vitest';

import {
  BracketError,
  HALF_SEED_PAIRS,
  QUARTER_SEED_PAIRS,
  advanceTargets,
  chooseSeedStage,
  seedBracketMatches,
  seedHalfMatches,
  seedQuarterMatches,
} from 'core/bracketProgression';

/**
 * Pins the bracket topology — the highest silent-bug risk, because it is
 * duplicated with web/src/app/util/bracket.ts (BRACKET_SLOTS) and the two
 * cannot import across packages. If the pairing or the round feeds drift, the
 * bracket renders plausibly but seeds 1 and 2 could meet before the final.
 *
 * The BRACKET_SLOTS geometry (verbatim from bracket.ts) forces this feed:
 *   quarter order1 (athlete1) + order2 (athlete2)  -> half order1
 *   quarter order3 (athlete1) + order4 (athlete2)  -> half order2
 *   half order1   (athlete1) + half order2 (athlete2) -> final
 * We re-derive that here so the server feed can't drift from the renderer.
 */

// The documented (round, position-order) -> downstream feed, copied from the
// BRACKET_SLOTS ordering in web/src/app/util/bracket.ts.
const HALF1_FEED = [1, 2]; // quarter positions feeding half position 1
const HALF2_FEED = [3, 4]; // quarter positions feeding half position 2

describe('QUARTER_SEED_PAIRS', () => {
  it('is the standard 8-bracket seeding 1v8 / 4v5 / 2v7 / 3v6', () => {
    expect(QUARTER_SEED_PAIRS).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
  });

  it('keeps seeds 1 and 2 in opposite halves (meet only in the final)', () => {
    const positionOfSeed = (seed: number): number => {
      const idx = QUARTER_SEED_PAIRS.findIndex(([a, b]) => a === seed || b === seed);
      return idx + 1; // 1-based position
    };
    const half = (quarterPos: number): 1 | 2 => (HALF1_FEED.includes(quarterPos) ? 1 : 2);

    expect(half(positionOfSeed(1))).toBe(1);
    expect(half(positionOfSeed(2))).toBe(2);
    expect([...QUARTER_SEED_PAIRS]).toContainEqual([1, 8]);
    expect([...QUARTER_SEED_PAIRS]).toContainEqual([2, 7]);
    expect([...QUARTER_SEED_PAIRS]).toContainEqual([3, 6]);
    expect([...QUARTER_SEED_PAIRS]).toContainEqual([4, 5]);
  });
});

describe('seedQuarterMatches', () => {
  // ranked best -> worst; ids encode the 1-based seed for readability.
  const ranked = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

  it('errors when fewer than 8 athletes are ranked', () => {
    expect(() => seedQuarterMatches(ranked.slice(0, 7), 'speed', 'male')).toThrow(BracketError);
  });

  it('produces positions 1..4 (1-based, matching BRACKET_SLOTS order) with the seed pairing', () => {
    const rows = seedQuarterMatches(ranked, 'speed', 'male');
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.round === 'quarter')).toBe(true);
    expect(rows.every((r) => r.discipline === 'speed' && r.gender === 'male')).toBe(true);
    expect(rows.every((r) => r.winnerId === undefined)).toBe(true);

    expect([rows[0].athlete1Id, rows[0].athlete2Id]).toEqual(['s1', 's8']);
    expect([rows[1].athlete1Id, rows[1].athlete2Id]).toEqual(['s4', 's5']);
    expect([rows[2].athlete1Id, rows[2].athlete2Id]).toEqual(['s2', 's7']);
    expect([rows[3].athlete1Id, rows[3].athlete2Id]).toEqual(['s3', 's6']);

    // Seeded matches carry no display override; the client shows the round label.
    expect(rows.every((r) => !('roundName' in r))).toBe(true);
  });

  it('carries the discipline/gender through (freestyle/female)', () => {
    const rows = seedQuarterMatches(ranked, 'freestyle', 'female');
    expect(rows.every((r) => r.discipline === 'freestyle' && r.gender === 'female')).toBe(true);
  });
});

describe('HALF_SEED_PAIRS', () => {
  it('is the standard 4-bracket seeding 1v4 / 2v3', () => {
    expect(HALF_SEED_PAIRS).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it('keeps seeds 1 and 2 in opposite semis (meet only in the final)', () => {
    // half position 1 feeds the final's athlete1, position 2 feeds athlete2
    // (advanceTargets half -> final), so seeds 1 and 2 must land in different
    // half positions or they collide before the final.
    const positionOfSeed = (seed: number): number =>
      HALF_SEED_PAIRS.findIndex(([a, b]) => a === seed || b === seed) + 1;
    expect(positionOfSeed(1)).not.toBe(positionOfSeed(2));
  });
});

describe('seedHalfMatches', () => {
  const ranked = ['s1', 's2', 's3', 's4', 's5'];

  it('errors when fewer than 4 athletes are ranked', () => {
    expect(() => seedHalfMatches(ranked.slice(0, 3), 'speed', 'male')).toThrow(BracketError);
  });

  it('produces the two half matches (top 4) with the 1v4 / 2v3 pairing', () => {
    const rows = seedHalfMatches(ranked, 'speed', 'male');
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect(rows.every((r) => r.round === 'half')).toBe(true);
    expect(rows.every((r) => r.discipline === 'speed' && r.gender === 'male')).toBe(true);
    expect(rows.every((r) => r.winnerId === undefined)).toBe(true);
    // 1v4, 2v3 — seeds 5+ (here s5) are cut.
    expect([rows[0].athlete1Id, rows[0].athlete2Id]).toEqual(['s1', 's4']);
    expect([rows[1].athlete1Id, rows[1].athlete2Id]).toEqual(['s2', 's3']);
    expect(rows.every((r) => !('roundName' in r))).toBe(true);
  });

  it('carries the discipline/gender through (freestyle/female)', () => {
    const rows = seedHalfMatches(ranked, 'freestyle', 'female');
    expect(rows.every((r) => r.discipline === 'freestyle' && r.gender === 'female')).toBe(true);
  });
});

describe('chooseSeedStage', () => {
  it('picks quarter for >=9 ranked and half for <9 (rules S7/F11)', () => {
    expect(chooseSeedStage(9)).toBe('quarter');
    expect(chooseSeedStage(20)).toBe('quarter');
    // The rule's letter: 8 competitors still seed the semi-final bracket.
    expect(chooseSeedStage(8)).toBe('half');
    expect(chooseSeedStage(4)).toBe('half');
  });

  it('honours an explicit stage override regardless of count', () => {
    expect(chooseSeedStage(4, 'quarter')).toBe('quarter');
    expect(chooseSeedStage(20, 'half')).toBe('half');
  });
});

describe('seedBracketMatches', () => {
  const many = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);

  it('seeds a full quarter bracket for a large field', () => {
    const { stage, matches } = seedBracketMatches(many, 'speed', 'male');
    expect(stage).toBe('quarter');
    expect(matches).toHaveLength(4);
    expect(matches.every((m) => m.round === 'quarter')).toBe(true);
  });

  it('seeds a top-4 semi-final bracket for a small field (<9)', () => {
    const { stage, matches } = seedBracketMatches(many.slice(0, 6), 'freestyle', 'female');
    expect(stage).toBe('half');
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.round === 'half')).toBe(true);
  });

  it('respects an explicit stage override (and still enforces its minimum)', () => {
    expect(seedBracketMatches(many.slice(0, 8), 'speed', 'male', 'quarter').stage).toBe('quarter');
    // Forcing a full bracket below 8 still 400s (throws the min-count BracketError).
    expect(() => seedBracketMatches(many.slice(0, 6), 'speed', 'male', 'quarter')).toThrow(
      BracketError,
    );
  });
});

describe('advanceTargets quarter -> half', () => {
  const quarters = [
    { position: 1, athlete1Id: 's1', athlete2Id: 's8', winnerId: 's1' },
    { position: 2, athlete1Id: 's4', athlete2Id: 's5', winnerId: 's5' },
    { position: 3, athlete1Id: 's2', athlete2Id: 's7', winnerId: 's2' },
    { position: 4, athlete1Id: 's3', athlete2Id: 's6', winnerId: 's6' },
  ];

  it('feeds quarter winners into the two half matches per BRACKET_SLOTS', () => {
    const targets = advanceTargets('quarter', quarters);
    expect(targets.map((t) => `${t.round}#${t.position}`)).toEqual(['half#1', 'half#2']);

    // half1 = winner(q1) vs winner(q2); half2 = winner(q3) vs winner(q4)
    const [half1, half2] = targets;
    expect([half1.athlete1Id, half1.athlete2Id]).toEqual([
      quarters[HALF1_FEED[0] - 1].winnerId,
      quarters[HALF1_FEED[1] - 1].winnerId,
    ]);
    expect([half2.athlete1Id, half2.athlete2Id]).toEqual([
      quarters[HALF2_FEED[0] - 1].winnerId,
      quarters[HALF2_FEED[1] - 1].winnerId,
    ]);
    expect('roundName' in half1).toBe(false);
    expect('roundName' in half2).toBe(false);
  });

  it('is robust to source order (sorts by position)', () => {
    const shuffled = [quarters[2], quarters[0], quarters[3], quarters[1]];
    expect(advanceTargets('quarter', shuffled)).toEqual(advanceTargets('quarter', quarters));
  });

  it('errors unless exactly 4 quarter matches are given', () => {
    expect(() => advanceTargets('quarter', quarters.slice(0, 3))).toThrow(BracketError);
  });
});

describe('advanceTargets half -> final + small_final', () => {
  const halves = [
    { position: 1, athlete1Id: 's1', athlete2Id: 's5', winnerId: 's1' },
    { position: 2, athlete1Id: 's2', athlete2Id: 's6', winnerId: 's6' },
  ];

  it('routes winners to the final and losers to the small final', () => {
    const targets = advanceTargets('half', halves);
    expect(targets.map((t) => `${t.round}#${t.position}`)).toEqual(['final#1', 'small_final#1']);

    const [final, small] = targets;
    expect([final.athlete1Id, final.athlete2Id]).toEqual(['s1', 's6']); // winners
    expect([small.athlete1Id, small.athlete2Id]).toEqual(['s5', 's2']); // losers
    expect('roundName' in final).toBe(false);
    expect('roundName' in small).toBe(false);
  });

  it('errors unless exactly 2 half matches are given', () => {
    expect(() => advanceTargets('half', halves.slice(0, 1))).toThrow(BracketError);
  });

  it('returns no downstream rows for terminal rounds', () => {
    expect(advanceTargets('final', [{ position: 1, winnerId: 's1' }])).toEqual([]);
  });
});
