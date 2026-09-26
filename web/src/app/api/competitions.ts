import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import type { Competition } from 'app/types';

export const competitionKeys = {
  all: ['competitions'] as const,
  list: () => [...competitionKeys.all, 'list'] as const,
  detail: (compId: string) => [...competitionKeys.all, 'detail', compId] as const,
};

/** Fields the create endpoint accepts (the server assigns `tokenVersion`). */
export type CompetitionInput = Pick<Competition, 'compId' | 'name' | 'startDate' | 'endDate'>;

/** Fields the update endpoint accepts (compId is the path; tokenVersion is server-managed). */
export type CompetitionUpdateInput = Pick<Competition, 'name' | 'startDate' | 'endDate'> &
  Pick<Competition, 'config'>;

/**
 * Poll cadence for the competitions list page. `db_update` can never keep this
 * list fresh: with no competition selected there is no relay room to join, and
 * a newly created competition broadcasts into its *own* room, which no other
 * client has joined yet. Interval refetches pause in background tabs (React
 * Query default) and stop with the page's unmount.
 */
export const COMPETITIONS_LIST_POLL_MS = 15_000;

export const useCompetitions = (options?: { refetchInterval?: number }) =>
  useQuery({
    queryKey: competitionKeys.list(),
    queryFn: ({ signal }) => apiFetch<Competition[]>('/competitions', { signal }),
    refetchInterval: options?.refetchInterval,
  });

export const useCompetition = (compId: string | undefined) =>
  useQuery({
    queryKey: competitionKeys.detail(compId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<Competition>(`/competitions/${encodeURIComponent(compId!)}`, { signal }),
    enabled: Boolean(compId),
  });

export const useCreateCompetition = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompetitionInput) =>
      apiFetch<Competition>('/competitions', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: competitionKeys.list() }),
  });
};

export const useUpdateCompetition = (compId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompetitionUpdateInput) =>
      apiFetch<Competition>(`/competitions/${encodeURIComponent(compId)}`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: competitionKeys.list() });
      queryClient.invalidateQueries({ queryKey: competitionKeys.detail(compId) });
    },
  });
};
