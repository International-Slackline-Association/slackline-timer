import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Score } from 'app/types';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import {
  scoreKeys,
  useCreateScore,
  useDeleteScore,
  useScores,
  useUpdateScore,
} from 'app/api/scores';

const COMP = 'worlds-2026';

const wrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('scoreKeys', () => {
  it('namespaces the round (any-round list falls back to "all")', () => {
    expect(scoreKeys.all(COMP)).toEqual(['scores', COMP]);
    expect(scoreKeys.list(COMP, 'final')).toEqual(['scores', COMP, 'list', 'final']);
    expect(scoreKeys.list(COMP)).toEqual(['scores', COMP, 'list', 'all']);
  });
});

describe('useScores', () => {
  it('stays disabled and never fetches without a competition', () => {
    apiFetchMock.mockReset();
    const { result } = renderHook(() => useScores(null), { wrapper: wrapper(newClient()) });
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('fetches the whole branch with no round filter', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useScores(COMP), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores`, {
      signal: expect.any(AbortSignal),
      readToken: undefined,
    });
  });

  it('passes the round filter and a read token through', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useScores(COMP, 'final', { readToken: 'rt' }), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores?round=final`, {
      signal: expect.any(AbortSignal),
      readToken: 'rt',
    });
  });
});

describe('score mutations', () => {
  it('POSTs the ScoreInput body and invalidates the scores branch', async () => {
    apiFetchMock.mockReset().mockResolvedValue({ scoreId: 's1' } as Score);
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateScore(COMP), { wrapper: wrapper(client) });

    const input = {
      athleteId: 'a1',
      round: 'final' as const,
      difficulty: 1,
      combo: 2,
      style: 3,
      bestTrick: 4,
      controlPenalty: 0.5,
    };
    await result.current.mutateAsync(input);

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores`, {
      method: 'POST',
      body: input,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scoreKeys.all(COMP) });
  });

  it('PUTs to the score id and invalidates', async () => {
    apiFetchMock.mockReset().mockResolvedValue({ scoreId: 's1' } as Score);
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateScore(COMP), { wrapper: wrapper(client) });

    const input = {
      athleteId: 'a1',
      round: 'half' as const,
      difficulty: 1,
      combo: 2,
      style: 3,
      bestTrick: 4,
      controlPenalty: 0,
      overall: 10,
    };
    await result.current.mutateAsync({ id: 's1', input });

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores/s1`, {
      method: 'PUT',
      body: input,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scoreKeys.all(COMP) });
  });

  it('DELETEs by id and invalidates', async () => {
    apiFetchMock.mockReset().mockResolvedValue(undefined);
    const client = newClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteScore(COMP), { wrapper: wrapper(client) });

    await result.current.mutateAsync('s1');

    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores/s1`, {
      method: 'DELETE',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: scoreKeys.all(COMP) });
  });
});
