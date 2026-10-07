import { describe, expect, it } from 'vitest';

import { compPath } from 'app/api/paths';

describe('compPath', () => {
  it('builds the competition path byte-identically for ADR 0052-shaped ids', () => {
    expect(compPath('worlds-2026')).toBe('/competitions/worlds-2026');
    expect(compPath('worlds_2026', 'athletes')).toBe('/competitions/worlds_2026/athletes');
    expect(compPath('C1', 'matches', 'advance')).toBe('/competitions/C1/matches/advance');
    expect(compPath('C1', 'times', 'a-B_9')).toBe('/competitions/C1/times/a-B_9');
  });

  it('encodes every segment so no id can add or climb a path level', () => {
    expect(compPath('../other', 'athletes')).toBe('/competitions/..%2Fother/athletes');
    expect(compPath('c1', 'athletes', 'a/b?x=1#f')).toBe(
      '/competitions/c1/athletes/a%2Fb%3Fx%3D1%23f',
    );
  });
});
