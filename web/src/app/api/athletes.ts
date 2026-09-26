import { useQuery } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import { crudResource } from 'app/api/crudResource';
import type { Athlete } from 'app/types';

// Invalidation strategy: see crudResource.ts.

export const athleteKeys = {
  all: (compId: string) => ['athletes', compId] as const,
  list: (compId: string) => [...athleteKeys.all(compId), 'list'] as const,
};

/** Fields the create/update endpoints accept (ids come from the path/server). */
export type AthleteInput = Omit<Athlete, 'athleteId' | 'compId' | 'photoUrl'>;

export const useAthletes = (compId: string | null, opts: { readToken?: string } = {}) =>
  useQuery({
    queryKey: athleteKeys.list(compId ?? ''),
    enabled: compId != null,
    queryFn: ({ signal }) =>
      apiFetch<Athlete[]>(`/competitions/${compId}/athletes`, {
        signal,
        readToken: opts.readToken,
      }),
  });

const athleteCrud = crudResource<Athlete, AthleteInput>('athletes', athleteKeys);

export const useCreateAthlete = athleteCrud.useCreate;
export const useUpdateAthlete = athleteCrud.useUpdate;
export const useDeleteAthlete = athleteCrud.useDelete;
