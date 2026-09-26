import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from 'app/api/client';

/**
 * Factory for the standard competition-scoped create/update/delete mutation
 * hooks (POST/PUT/DELETE under `/competitions/{compId}/{segment}`). Every
 * mutation invalidates the entity's whole query branch (`keys.all(compId)`) on
 * success, so a new entity can't ship with a forgotten invalidation.
 * Cross-entity refresh (e.g. rankings after a time write) rides the
 * server-side `db_update` broadcast (`app/pages/Stream/dbUpdateInvalidation.ts`);
 * bespoke mutations (competitions, bracket advance, read tokens) stay
 * hand-written next to their entity.
 */
export const crudResource = <TEntity, TInput>(
  segment: string,
  keys: { all: (compId: string) => readonly unknown[] },
) => {
  const collection = (compId: string) => `/competitions/${compId}/${segment}`;

  const useInvalidate = (compId: string) => {
    const queryClient = useQueryClient();
    return () => queryClient.invalidateQueries({ queryKey: keys.all(compId) });
  };

  const useCreate = (compId: string) => {
    const invalidate = useInvalidate(compId);
    return useMutation({
      mutationFn: (input: TInput) =>
        apiFetch<TEntity>(collection(compId), { method: 'POST', body: input }),
      onSuccess: invalidate,
    });
  };

  const useUpdate = (compId: string) => {
    const invalidate = useInvalidate(compId);
    return useMutation({
      mutationFn: ({ id, input }: { id: string; input: TInput }) =>
        apiFetch<TEntity>(`${collection(compId)}/${id}`, { method: 'PUT', body: input }),
      onSuccess: invalidate,
    });
  };

  const useDelete = (compId: string) => {
    const invalidate = useInvalidate(compId);
    return useMutation({
      mutationFn: (id: string) =>
        apiFetch<void>(`${collection(compId)}/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    });
  };

  return { useCreate, useUpdate, useDelete };
};
