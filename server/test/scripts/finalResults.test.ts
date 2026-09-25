import { describe, expect, it } from 'vitest';

import { DNF_SENTINEL } from 'core/types';
import { validateScoreInput, validateTimeInput } from 'core/validators';

import { FINAL_RUNS, buildFinalResults } from '../../scripts/lib/finalResults.mjs';

/**
 * Guards the demo seed's final-round result builder
 * (scripts/lib/finalResults.mjs). The VS overlays read their stats tables off
 * `final`-round Times (speed RUN 1/2/3) and Scores (freestyle breakdown), so a
 * seed that writes neither certifies an empty table — this pins the two things
 * that silently break it: run ORDER (the overlay sorts by `startTime`, so a flat
 * timestamp scrambles RUN 1/2/3) and VALIDITY (every row goes through the real
 * validators, the same ones the POST would 400 on).
 */

const MATCH = {
  matchId: 'm-final',
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
