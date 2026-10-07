import { describe, expect, it } from 'vitest';

import { DNF_SENTINEL, computeOverall } from 'core/types';
import { validateScoreInput, validateTimeInput } from 'core/validators';

import { FINAL_RUNS, buildFinalResults } from '../../scripts/lib/finalResults.mjs';

/**
 * Guards the demo seed's final-round result builder
 * (scripts/lib/finalResults.mjs). The VS overlays read their stats tables off
 * the match round's Times (speed RUN 1/2/3) and Scores (freestyle breakdown), so a
 * seed that writes neither certifies an empty table — this pins the three things
 * that silently break it: run ORDER (the overlay sorts by `startTime`, so a flat
 * timestamp scrambles RUN 1/2/3), VALIDITY (every row goes through the real
 * validators, the same ones the POST would 400 on) and AGREEMENT (a decided
 * final's laps and scores crown the stored `winnerId`).
 */

const MATCH = {
  matchId: 'm-final',
  round: 'final' as const,
  athlete1Id: 'a-winner',
  athlete2Id: 'a-loser',
  winnerId: 'a-winner',
};

const runsFor = (athleteId: string) =>
  athleteId === 'a-winner' ? [5200, 5300, 5100] : [6100, 6000, 6200];
const scoreFor = () => ({ difficulty: 8, combo: 7, style: 9, bestTrick: 6, controlPenalty: 2 });

const build = (discipline: 'speed' | 'freestyle') =>
  buildFinalResults({ discipline, match: MATCH, runsFor, scoreFor, startEpoch: 1_700_000_000_000 });

describe('buildFinalResults — speed', () => {
  it('writes three match-tagged final runs per finalist', () => {
    const { times, scores } = build('speed');
    expect(scores).toEqual([]);
    expect(times).toHaveLength(2 * FINAL_RUNS);
    expect(times.every((t) => t.round === 'final' && t.matchId === MATCH.matchId)).toBe(true);
    expect(new Set(times.map((t) => t.athleteId))).toEqual(new Set(['a-winner', 'a-loser']));
  });

  it('spaces each finalist’s runs so RUN 1/2/3 fill in order', () => {
    const { times } = build('speed');
    for (const athleteId of ['a-winner', 'a-loser']) {
      const starts = times.filter((t) => t.athleteId === athleteId).map((t) => t.startTime);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(new Set(starts).size).toBe(FINAL_RUNS);
    }
  });

  it('DNFs the loser’s last run only', () => {
    const { times } = build('speed');
    const dnf = times.filter((t) => t.timeMs === DNF_SENTINEL);
    expect(dnf).toHaveLength(1);
    expect(dnf[0].athleteId).toBe('a-loser');
    const loser = times.filter((t) => t.athleteId === 'a-loser');
    expect(loser[FINAL_RUNS - 1].timeMs).toBe(DNF_SENTINEL);
  });

  it('leaves every run clean when the final has no winner yet', () => {
    const { times } = buildFinalResults({
      discipline: 'speed',
      match: { ...MATCH, winnerId: undefined },
      runsFor,
      scoreFor,
      startEpoch: 1_700_000_000_000,
    });
    expect(times.some((t) => t.timeMs === DNF_SENTINEL)).toBe(false);
  });
});

describe('buildFinalResults — freestyle', () => {
  it('writes one battle score per finalist, carrying the battle-only components', () => {
    const { times, scores } = build('freestyle');
    expect(times).toEqual([]);
    expect(scores).toHaveLength(2);
    // The VS freestyle table renders CONTROL PENALTY / BEST TRICK only when the
    // round is a battle; a zero there would read as an unjudged cell on air.
    expect(
      scores.every((s) => s.round === 'final' && s.bestTrick > 0 && s.controlPenalty > 0),
    ).toBe(true);
  });
});

describe('buildFinalResults — the data plane accepts every row', () => {
  it('passes the real Time and Score validators', () => {
    const rows = [build('speed'), build('freestyle')];
    for (const { times, scores } of rows) {
      for (const t of times) expect(validateTimeInput(t, Date.now()).ok).toBe(true);
      for (const s of scores) expect(validateScoreInput(s).ok).toBe(true);
    }
  });
});

/** mulberry32 — a seeded PRNG so a failing draw reproduces. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('buildFinalResults — a decided final agrees with its winnerId', () => {
  // Narrow ranges so equal draws (the tie paths) actually occur.
  const randomFinal = (seed: number) => {
    const r = prng(seed);
    const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
    const runsFor = () => [int(5200, 5210), int(5200, 5210), int(5200, 5210)];
    const scoreFor = () => ({
      difficulty: int(0, 6),
      combo: int(0, 6),
      style: int(0, 6),
      bestTrick: int(0, 4),
      controlPenalty: int(0, 4),
    });
    return (discipline: 'speed' | 'freestyle') =>
      buildFinalResults({
        discipline,
        match: MATCH,
        runsFor,
        scoreFor,
        startEpoch: 1_700_000_000_000,
      });
  };
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  it('gives the winner the faster time in runs 1 and 2 and DNFs the loser’s third', () => {
    for (const seed of SEEDS) {
      const { times } = randomFinal(seed)('speed');
      const winner = times.filter((t) => t.athleteId === 'a-winner').map((t) => t.timeMs);
      const loser = times.filter((t) => t.athleteId === 'a-loser').map((t) => t.timeMs);
      expect(winner[0], `seed ${seed} run 1`).toBeLessThan(loser[0]);
      expect(winner[1], `seed ${seed} run 2`).toBeLessThan(loser[1]);
      expect(winner[2]).not.toBe(DNF_SENTINEL);
      expect(loser[2]).toBe(DNF_SENTINEL);
    }
  });

  it('gives the winner the higher freestyle overall', () => {
    for (const seed of SEEDS) {
      const { scores } = randomFinal(seed)('freestyle');
      const overallOf = (id: string) => computeOverall(scores.find((s) => s.athleteId === id)!);
      expect(overallOf('a-winner'), `seed ${seed}`).toBeGreaterThan(overallOf('a-loser'));
    }
  });

  it('keeps every decided row valid for the data plane', () => {
    for (const seed of SEEDS) {
      const build = randomFinal(seed);
      for (const t of build('speed').times) expect(validateTimeInput(t, Date.now()).ok).toBe(true);
      for (const s of build('freestyle').scores) expect(validateScoreInput(s).ok).toBe(true);
    }
  });
});

describe('buildFinalResults — the small final', () => {
  // Overall ranks 3–4 (rule G3) read their result off the small_final round; a
  // row tagged `final` would leave them borrowing the qualification time.
  const SMALL = { ...MATCH, matchId: 'm-small', round: 'small_final' as const };
  const buildSmall = (discipline: 'speed' | 'freestyle') =>
    buildFinalResults({
      discipline,
      match: SMALL,
      runsFor,
      scoreFor,
      startEpoch: 1_700_000_000_000,
    });

  it('tags every row with the small_final round and match', () => {
    const { times } = buildSmall('speed');
    const { scores } = buildSmall('freestyle');
    expect(times).toHaveLength(2 * FINAL_RUNS);
    expect(scores).toHaveLength(2);
    for (const row of [...times, ...scores]) {
      expect(row.round).toBe('small_final');
      expect(row.matchId).toBe('m-small');
    }
  });

  it('passes the real validators and still crowns the stored winner', () => {
    const { times } = buildSmall('speed');
    const { scores } = buildSmall('freestyle');
    for (const t of times) expect(validateTimeInput(t, Date.now()).ok).toBe(true);
    for (const s of scores) expect(validateScoreInput(s).ok).toBe(true);
    const loser = times.filter((t) => t.athleteId === 'a-loser');
    expect(loser[FINAL_RUNS - 1].timeMs).toBe(DNF_SENTINEL);
    const overallOf = (id: string) => computeOverall(scores.find((s) => s.athleteId === id)!);
    expect(overallOf('a-winner')).toBeGreaterThan(overallOf('a-loser'));
  });
});

describe('buildFinalResults — an unresolved final', () => {
  it('writes nothing when a finalist slot is still open', () => {
    const { times, scores } = buildFinalResults({
      discipline: 'speed',
      match: { ...MATCH, athlete2Id: undefined },
      runsFor,
      scoreFor,
      startEpoch: 1_700_000_000_000,
    });
    expect(times).toEqual([]);
    expect(scores).toEqual([]);
  });
});
