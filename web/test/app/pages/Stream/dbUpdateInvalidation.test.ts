import { describe, expect, it } from 'vitest';

import { athleteKeys } from 'app/api/athletes';
import { competitionKeys } from 'app/api/competitions';
import { matchKeys } from 'app/api/matches';
import { rankingKeys } from 'app/api/rankings';
import { scoreKeys } from 'app/api/scores';
import { timeKeys } from 'app/api/times';
import { allDbUpdateQueryKeys, dbUpdateQueryKeys } from 'app/pages/Stream/dbUpdateInvalidation';

const COMP = 'laax-2026';
const ENTITIES = ['competition', 'athlete', 'time', 'score', 'match'] as const;

describe('dbUpdateQueryKeys', () => {
  it('scopes a competition write to the competitions branch', () => {
    expect(dbUpdateQueryKeys(COMP, 'competition')).toEqual([competitionKeys.all]);
  });

  it('refreshes athletes and rankings on an athlete write', () => {
    expect(dbUpdateQueryKeys(COMP, 'athlete')).toEqual([
      athleteKeys.all(COMP),
      rankingKeys.all(COMP),
    ]);
  });

  it('refreshes times and rankings on a time write', () => {
    expect(dbUpdateQueryKeys(COMP, 'time')).toEqual([timeKeys.all(COMP), rankingKeys.all(COMP)]);
  });

  it('refreshes scores and rankings on a score write', () => {
    expect(dbUpdateQueryKeys(COMP, 'score')).toEqual([scoreKeys.all(COMP), rankingKeys.all(COMP)]);
  });

  it('refreshes matches and rankings on a match write (winners drive the standings)', () => {
    expect(dbUpdateQueryKeys(COMP, 'match')).toEqual([matchKeys.all(COMP), rankingKeys.all(COMP)]);
  });
});

describe('allDbUpdateQueryKeys', () => {
  it('covers every branch any single db_update can invalidate', () => {
    const all = allDbUpdateQueryKeys(COMP).map((k) => JSON.stringify(k));
    for (const entity of ENTITIES) {
      for (const key of dbUpdateQueryKeys(COMP, entity)) {
        expect(all).toContain(JSON.stringify(key));
      }
    }
  });

  it('stays deduplicated (each branch invalidates once on reopen)', () => {
    const all = allDbUpdateQueryKeys(COMP).map((k) => JSON.stringify(k));
    expect(new Set(all).size).toBe(all.length);
  });
});
