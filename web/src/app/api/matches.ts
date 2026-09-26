import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import { crudResource } from 'app/api/crudResource';
import type { Discipline, Gender, Match, MatchRound } from 'app/types';

/**
 * Matches are keyed discipline-first then gender in DynamoDB, so the list is
 * fetched per gender (and optionally per discipline; a round filter on the
 * server requires a gender); round filtering within a gender is done
 * client-side. Editing discipline/gender/round rewrites the sort key — the
 * server runs that as a transactional delete+put; the client just PUTs.
 */

export const matchKeys = {
  all: (compId: string) => ['matches', compId] as const,
  list: (compId: string, gender: Gender, discipline?: Discipline) =>
    [...matchKeys.all(compId), 'list', gender, discipline ?? 'all'] as const,
};

/** Fields the create/update endpoints accept (ids come from the path/server). */
export type MatchInput = Omit<Match, 'matchId' | 'compId'>;

/** The two bracket entry stages a qualification seed can target (server parity). */
export type SeedStage = Extract<MatchRound, 'quarter' | 'half'>;

export const useMatches = (
  compId: string | null,
  gender: Gender,
  opts: { discipline?: Discipline; readToken?: string } = {},
) =>
  useQuery({
    queryKey: matchKeys.list(compId ?? '', gender, opts.discipline),
    enabled: compId != null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ gender });
      if (opts.discipline) params.set('discipline', opts.discipline);
      return apiFetch<Match[]>(`/competitions/${compId}/matches?${params}`, {
        signal,
        readToken: opts.readToken,
      });
    },
  });

const matchCrud = crudResource<Match, MatchInput>('matches', matchKeys);

export const useCreateMatch = matchCrud.useCreate;
export const useUpdateMatch = matchCrud.useUpdate;
export const useDeleteMatch = matchCrud.useDelete;

/**
 * Advance one bracket round into the next. `qualification` seeds the bracket
 * entry round from the ranking — quarter vs half picked by field size, or
 * forced via `stage` (ignored on winners rounds); the rest route each source
 * match's winner into the next round (quarter→half, half→final+small_final).
 * The server requires every source match to have a winner; 409 if a target
 * slot already holds different athletes (or the entry round is already seeded)
 * unless `force`.
 */
export const useAdvanceBracket = (compId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      discipline: Discipline;
      gender: Gender;
      fromRound: MatchRound;
      force?: boolean;
      stage?: SeedStage;
    }) =>
      apiFetch<Match[]>(`/competitions/${compId}/matches/advance`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: matchKeys.all(compId) }),
  });
};
