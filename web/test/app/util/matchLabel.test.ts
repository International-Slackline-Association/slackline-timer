import { describe, expect, it } from 'vitest';

import type { Match } from 'app/types';
import { matchLabel } from 'app/util/matchLabel';

const match = (over: Partial<Match> = {}): Match =>
  ({
    matchId: 'm1',
    compId: 'c1',
    discipline: 'speed',
    round: 'final',
    gender: 'male',
    position: 1,
    athlete1Id: 'a1',
    athlete2Id: 'a2',
    ...over,
  }) as Match;

const NAMES: Record<string, string> = { a1: 'Alice', a2: 'Bob' };
const athleteName = (id?: string): string => (id && NAMES[id]) || 'TBD';

describe('matchLabel', () => {
  it('formats round, position, and both athletes', () => {
    expect(matchLabel(match(), athleteName)).toBe('Final #1 — Alice vs Bob');
  });

  it('falls back to TBD for an unassigned side', () => {
    expect(matchLabel(match({ athlete2Id: undefined }), athleteName)).toBe(
      'Final #1 — Alice vs TBD',
    );
  });
});
