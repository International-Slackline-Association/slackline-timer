import type { Athlete, Gender, Match } from 'app/types';

/**
 * The cascading athlete option list for a control selection panel (ADR 0042,
 * extending ADR 0033): a selected match
 * narrows the pickers to its two assigned athletes (keeping a lane opt-out and
 * a manual swap possible; a TBD slot simply isn't listed), otherwise the gender
 * choice narrows the pool. The current selection always stays listed even when
 * off-filter (peer-mirrored mid-flight / cancelled normalization) — the select
 * must always show what will be recorded.
 */
export const athleteOptions = (
  athletes: Athlete[],
  gender: Gender,
  match: Match | undefined,
  currentId: string,
): Athlete[] => {
  const byId = (id?: string): Athlete | undefined =>
    id ? athletes.find((a) => a.athleteId === id) : undefined;
  const pool = match
    ? [byId(match.athlete1Id), byId(match.athlete2Id)].filter((a): a is Athlete => a !== undefined)
    : athletes.filter((a) => a.gender === gender);
  const current = byId(currentId);
  if (current && !pool.some((a) => a.athleteId === currentId)) return [...pool, current];
  return pool;
};
