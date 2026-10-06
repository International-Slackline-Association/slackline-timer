import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';
import { compPath } from 'app/api/paths';
import type { Manager } from 'app/types';

/**
 * Per-competition manager grants (competition ACL). Superadmin-only surface:
 * only a `timeradmin` may list, grant, or revoke managers (enforced server-side
 * by the managers Lambda). A manager, once granted, operates the competition
 * with their own ISA login.
 */
export const managerKeys = {
  all: ['managers'] as const,
  list: (compId: string) => [...managerKeys.all, compId] as const,
};

export const useManagers = (compId: string | undefined) =>
  useQuery({
    queryKey: managerKeys.list(compId ?? ''),
    queryFn: ({ signal }) => apiFetch<Manager[]>(compPath(compId!, 'managers'), { signal }),
    enabled: Boolean(compId),
  });

export const useGrantManager = (compId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      apiFetch<Manager>(compPath(compId, 'managers'), { method: 'POST', body: { email } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: managerKeys.list(compId) }),
  });
};

export const useRevokeManager = (compId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sub: string) =>
      apiFetch<void>(compPath(compId, 'managers', sub), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: managerKeys.list(compId) }),
  });
};
