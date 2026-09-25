import { useMemo } from 'react';

import { useAthletes } from 'app/api/athletes';
import type { Athlete } from 'app/types';
import { genderLabel } from 'app/util/gender';

/**
 * The athlete-id → athlete join shared by the admin list pages and the stream
 * overlays: wraps `useAthletes` (React Query dedupes the fetch with any other
 * subscriber) and memoizes an id-keyed map exposed as the stable `byId`
 * function, plus the two display helpers the Times/Scores tables repeat.
 */
export const useAthleteLookup = (compId: string | null, opts: { readToken?: string } = {}) => {
  const athletes = useAthletes(compId, opts);

  const byId = useMemo(() => {
    const map = new Map((athletes.data ?? []).map((a) => [a.athleteId, a]));
    return (id?: string): Athlete | undefined => (id ? map.get(id) : undefined);
  }, [athletes.data]);

  const athleteName = (id?: string): string => byId(id)?.name ?? '(unknown athlete)';
  const athleteGender = (id?: string): string => {
    const gender = byId(id)?.gender;
    return gender ? genderLabel(gender, 'subject') : '—';
  };

  return { athletes, byId, athleteName, athleteGender };
};
