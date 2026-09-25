import { useQuery } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import { crudResource } from 'app/api/crudResource';
import type { MatchRound, Score, ScoreInput } from 'app/types';

/**
 * One score per athlete per round; editing round/athleteId rewrites the DynamoDB
 * sort key, so the server runs those updates as a transactional delete+put — the
 * client just PUTs. `overall` is optional on input (the server computes it from
 * the components when omitted).
 */

export const scoreKeys = {
  all: (compId: string) => ['scores', compId] as const,
  list: (compId: string, round?: MatchRound) =>
    [...scoreKeys.all(compId), 'list', round ?? 'all'] as const,
};

export const useScores = (
  compId: string | null,
  round?: MatchRound,
  opts: { readToken?: string } = {},
) =>
  useQuery({
    queryKey: scoreKeys.list(compId ?? '', round),
    enabled: compId != null,
    queryFn: ({ signal }) => {
      const query = round ? `?round=${round}` : '';
      return apiFetch<Score[]>(`/competitions/${compId}/scores${query}`, {
        signal,
        readToken: opts.readToken,
      });
    },
  });

const scoreCrud = crudResource<Score, ScoreInput>('scores', scoreKeys);

export const useCreateScore = scoreCrud.useCreate;
export const useUpdateScore = scoreCrud.useUpdate;
export const useDeleteScore = scoreCrud.useDelete;
