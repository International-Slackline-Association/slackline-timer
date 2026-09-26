import { useQuery } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import { crudResource } from 'app/api/crudResource';
import type { Time, TimeRound } from 'app/types';

/**
 * Times are created by the timer console (save-on-stop) and corrected on
 * `/admin/times`. Editing round/athleteId rewrites the DynamoDB sort key, so
 * the server runs those updates as a transactional delete+put — the client
 * just PUTs.
 */

export const timeKeys = {
  all: (compId: string) => ['times', compId] as const,
  list: (compId: string, round?: TimeRound) =>
    [...timeKeys.all(compId), 'list', round ?? 'all'] as const,
};

/**
 * Fields the create/update endpoints accept. `startTime` is optional: the
 * server defaults it to `now - timeMs` on create, but edits carry the existing
 * value through so a correction doesn't silently shift the recorded start.
 */
export type TimeInput = Pick<Time, 'athleteId' | 'round' | 'timeMs'> &
  Partial<Pick<Time, 'startTime' | 'matchId'>>;

export const useTimes = (
  compId: string | null,
  round?: TimeRound,
  opts: { readToken?: string } = {},
) =>
  useQuery({
    queryKey: timeKeys.list(compId ?? '', round),
    enabled: compId != null,
    queryFn: ({ signal }) => {
      const query = round ? `?round=${round}` : '';
      return apiFetch<Time[]>(`/competitions/${compId}/times${query}`, {
        signal,
        readToken: opts.readToken,
      });
    },
  });

const timeCrud = crudResource<Time, TimeInput>('times', timeKeys);

export const useCreateTime = timeCrud.useCreate;
export const useUpdateTime = timeCrud.useUpdate;
export const useDeleteTime = timeCrud.useDelete;
