import { describe, expect, it } from 'vitest';

import type { Match } from 'app/types';
import { BRACKET_SLOTS, resolveBracketSlots } from 'app/util/bracket';

/**
 * Web ↔ server BRACKET-topology parity. The playoff8 tree is duplicated by
 * necessity (no npm workspaces): the web renderer binds matches to SVG slots by
 * (round, position-order) via `BRACKET_SLOTS`, while the server seeds/advances
 * the same tree at (round, position) in `core/bracketProgression`. The two must
 * agree on the position numbering AND the round-to-round feed, or the bracket
 * renders plausibly while the data is wrong (e.g. seeds 1 and 2 meet before the
 * final).
 *
 * `server/test/core/bracketProgression.test.ts` pins the server half against a
 * HAND-COPIED feed table (`HALF1_FEED`/`HALF2_FEED`) — the one duplication that
 * nothing guards, because that copy silently rots if `BRACKET_SLOTS` is
 * reordered. This test closes that gap: it imports the ACTUAL `BRACKET_SLOTS`
 * plus the server's seed/advance functions and asserts they agree, so a drift on
 * EITHER side fails a test. Fix the drift, never the test.
 *
 * The import reaches outside web/'s tsconfig (the server is a composite
 * project, so `tsc` cannot follow the source file), hence the ts-ignore; vitest
 * compiles the file just fine and that is what the check needs.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- cross-package source import, type-checked on the server side
import * as bracket from '../../../server/src/core/bracketProgression';

const { advanceTargets, seedHalfMatches, seedQuarterMatches } = bracket;

/** A server seed/advance row → a full web `Match` (adds the DB identity fields). */
const toMatch = (row: Partial<Match>, over: Partial<Match> = {}): Match => ({
  matchId: Math.random().toString(36).slice(2),
  compId: 'c1',
  discipline: 'speed',
  gender: 'male',
  round: row.round!,
  position: row.position!,
  athlete1Id: row.athlete1Id,
  athlete2Id: row.athlete2Id,
  ...over,
});

const sorted = (ns: number[]): number[] => [...ns].sort((a, b) => a - b);
const distinct = (ns: number[]): number[] => sorted([...new Set(ns)]);
const ordersOf = (round: Match['round']): number[] =>
  distinct(BRACKET_SLOTS.filter((s) => s.round === round).map((s) => s.order));

describe('web ↔ server bracket seed-position parity', () => {
  // ids encode the 1-based seed (ranking best → worst) for readability.
  const ranked = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

  it('server quarter positions cover exactly the BRACKET_SLOTS quarter orders', () => {
    const positions = seedQuarterMatches(ranked, 'speed', 'male').map((r: Match) => r.position);
    expect(sorted(positions)).toEqual(ordersOf('quarter')); // both 1..4
  });

  it('server half positions cover exactly the BRACKET_SLOTS half orders', () => {
    const positions = seedHalfMatches(ranked.slice(0, 4), 'speed', 'male').map(
      (r: Match) => r.position,
    );
    expect(sorted(positions)).toEqual(ordersOf('half')); // both 1..2
  });
});

/**
 * The (round, position) the winner of each half slot must come from, derived
 * from `BRACKET_SLOTS`' OWN wiring rather than a copy: a half box `box_q_A_B`
 * merges quarter athlete-boxes `box_a_A` and `box_a_B`, which belong to one
 * quarter match — that match's position is the feed. If `BRACKET_SLOTS` is
 * reordered, this map moves with it, so the parity check below tracks the real
 * renderer.
 */
const quarterFeedByHalfSlot = (): Map<string, number> => {
  const quarterOrderByBoxNum = new Map<number, number>();
  for (const s of BRACKET_SLOTS) {
    const m = /^box_a_(\d+)$/.exec(s.boxId);
    if (m) quarterOrderByBoxNum.set(Number(m[1]), s.order);
  }
  const feed = new Map<string, number>();
  for (const h of BRACKET_SLOTS.filter((s) => s.round === 'half')) {
    const m = /^box_q_(\d+)_(\d+)$/.exec(h.boxId);
    expect(m, `half slot ${h.boxId} must name its two source quarter boxes`).not.toBeNull();
    const [oa, ob] = [
      quarterOrderByBoxNum.get(Number(m![1])),
      quarterOrderByBoxNum.get(Number(m![2])),
    ];
    // Both source athlete-boxes must belong to ONE quarter match.
    expect(oa, `${h.boxId} sources an unknown quarter box`).toBeDefined();
    expect(oa).toBe(ob);
    feed.set(h.boxId, oa!);
  }
  return feed;
};

describe('web ↔ server bracket feed-topology parity', () => {
  const ranked = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

  it('server quarter→half advancement matches the BRACKET_SLOTS feed', () => {
    // Seed a full field, then let the higher seed (always `athlete1` in the
    // pairing) win every quarter, so each half slot has a distinct expected feed.
    const quarters = seedQuarterMatches(ranked, 'speed', 'male').map((r: Match) =>
      toMatch(r, { winnerId: r.athlete1Id }),
    );
    const halves = advanceTargets('quarter', quarters).map((r: Match) => toMatch(r));
    const bySlot = new Map(resolveBracketSlots([...quarters, ...halves]).map((s) => [s.boxId, s]));

    const feed = quarterFeedByHalfSlot();
    for (const [boxId, quarterPos] of feed) {
      const quarterWinner = quarters.find((q) => q.position === quarterPos)!.winnerId;
      expect(bySlot.get(boxId)!.athleteId).toBe(quarterWinner);
    }
  });

  it('server half→final/small_final advancement lands in the BRACKET_SLOTS final slots', () => {
    // Play the whole tree: quarter winners = athlete1, then half winners = the
    // higher-seeded athlete1 too. Final = the two half winners; small = losers.
    const quarters = seedQuarterMatches(ranked, 'speed', 'male').map((r: Match) =>
      toMatch(r, { winnerId: r.athlete1Id }),
    );
    const halves = advanceTargets('quarter', quarters).map((r: Match) =>
      toMatch(r, { winnerId: r.athlete1Id }),
    );
    const finals = advanceTargets('half', halves).map((r: Match) => toMatch(r));
    const bySlot = new Map(
      resolveBracketSlots([...quarters, ...halves, ...finals]).map((s) => [s.boxId, s]),
    );

    const half1 = halves.find((h) => h.position === 1)!;
    const half2 = halves.find((h) => h.position === 2)!;
    const loserOf = (m: Match) => (m.winnerId === m.athlete1Id ? m.athlete2Id : m.athlete1Id);

    // Final sides carry the two half WINNERS (half1 → left, half2 → right).
    expect(bySlot.get('box_final_l')!.athleteId).toBe(half1.winnerId);
    expect(bySlot.get('box_final_r')!.athleteId).toBe(half2.winnerId);
    // Small-final sides carry the two half LOSERS.
    expect(bySlot.get('box_sfinal_l')!.athleteId).toBe(loserOf(half1));
    expect(bySlot.get('box_small_r')!.athleteId).toBe(loserOf(half2));
  });

  it('a small-field half seeding resolves into the BRACKET_SLOTS semi slots', () => {
    // <9 competitors seed the top-4 semi bracket (rules S7/F11): the half slots
    // bind and every quarter slot stays empty across all render variants.
    const halves = seedHalfMatches(ranked.slice(0, 4), 'speed', 'male').map((r: Match) =>
      toMatch(r),
    );
    const resolved = resolveBracketSlots(halves);
    expect(
      resolved.filter((s) => s.round === 'quarter').every((s) => s.athleteId === undefined),
    ).toBe(true);
    expect(resolved.filter((s) => s.round === 'half').every((s) => s.athleteId !== undefined)).toBe(
      true,
    );
  });
});
