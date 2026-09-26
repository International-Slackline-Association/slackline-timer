import { describe, expect, it } from 'vitest';

import {
  BATTLE_ONLY_SCORE_COMPONENTS,
  DISCIPLINE,
  GENDERS,
  MATCH_ROUNDS,
  SCORE_COMPONENT_MAX,
  STANDINGS_VIEWS,
  TIME_ROUNDS,
  computeOverall,
  normalizeScoreValue,
} from 'app/types';
import { overallMax } from 'app/util/scoreInput';

/**
 * Web ↔ server enum parity. No npm workspaces, so each package carries its
 * own copy of the entity enums; the server's copy is authoritative (the
 * values end up inside DynamoDB sort keys, where drift corrupts data
 * permanently). This test fails when the copies diverge — fix the drift,
 * never the test.
 *
 * The import reaches outside web/'s tsconfig (the server is a composite
 * project, so `tsc` cannot follow the source file), hence the ts-ignore;
 * vitest compiles the file just fine and that is what the check needs.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- cross-package source import, type-checked on the server side
import * as serverTypes from '../../../server/src/core/types';

describe('web ↔ server type parity', () => {
  it('Match rounds are identical', () => {
    expect(MATCH_ROUNDS).toEqual(serverTypes.MATCH_ROUNDS);
  });

  it('Time rounds are identical', () => {
    expect(TIME_ROUNDS).toEqual(serverTypes.TIME_ROUNDS);
  });

  it('genders are identical', () => {
    expect(GENDERS).toEqual(serverTypes.GENDERS);
  });

  it('disciplines are identical', () => {
    expect(DISCIPLINE).toEqual(serverTypes.DISCIPLINE);
  });

  it('standings views are identical', () => {
    expect(STANDINGS_VIEWS).toEqual(serverTypes.STANDINGS_VIEWS);
  });

  it('computeOverall agrees with the server copy', () => {
    const components = {
      difficulty: 8.5,
      combo: 7,
      style: 6.25,
      bestTrick: 9,
      controlPenalty: 2.75,
    };
    expect(computeOverall(components)).toBe(serverTypes.computeOverall(components));
    expect(computeOverall(components)).toBe(8.5 + 7 + 6.25 + 9 - 2.75);
  });

  it('computeOverall normalizes away binary float noise (both copies agree)', () => {
    // 8.1 + 7.2 + 6.3 + 5.4 − 0.3 is mathematically 26.7 but leaks
    // 26.700000000000003 from plain double addition; normalization pins it exact.
    const noisy = { difficulty: 8.1, combo: 7.2, style: 6.3, bestTrick: 5.4, controlPenalty: 0.3 };
    expect(computeOverall(noisy)).toBe(26.7);
    expect(computeOverall(noisy)).toBe(serverTypes.computeOverall(noisy));
  });

  it('normalizeScoreValue agrees with the server copy and rounds to 6 dp', () => {
    expect(normalizeScoreValue(26.700000000000003)).toBe(26.7);
    expect(normalizeScoreValue(26.700000000000003)).toBe(
      serverTypes.normalizeScoreValue(26.700000000000003),
    );
    // Quarter-point entries stay exact (far above the noise floor, far below 6 dp).
    expect(normalizeScoreValue(6.25)).toBe(6.25);
  });

  it('score-component maxima are identical', () => {
    expect(SCORE_COMPONENT_MAX).toEqual(serverTypes.SCORE_COMPONENT_MAX);
  });

  it('battle-only score components are identical', () => {
    expect(BATTLE_ONLY_SCORE_COMPONENTS).toEqual(serverTypes.BATTLE_ONLY_SCORE_COMPONENTS);
  });

  it('the Overall ceiling matches app/util/scoreInput.ts for every round', () => {
    for (const round of MATCH_ROUNDS) {
      expect(overallMax(round)).toBe(serverTypes.overallMax(round));
    }
    // The bound the console blocks on and the API 400s: quali drops best trick.
    expect(overallMax('qualification')).toBe(100);
    expect(overallMax('final')).toBe(120);
  });

  it('the DNF sentinel matches app/util/time.ts', async () => {
    const { DNF_SENTINEL } = await import('app/util/time');
    expect(DNF_SENTINEL).toBe(serverTypes.DNF_SENTINEL);
  });
});
