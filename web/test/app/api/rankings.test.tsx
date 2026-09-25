import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import {
  rankingKeys,
  useCombinedRanking,
  useOverallStandings,
  useRankings,
} from 'app/api/rankings';

const COMP = 'worlds-2026';

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('rankingKeys', () => {
  it('namespaces allTimes and discipline (discipline falls back to "all")', () => {
    expect(rankingKeys.view(COMP, 'final', 'male', false)).toEqual([
      'rankings',
      COMP,
      'final',
      'male',
      'best',
      'all',
    ]);
    expect(rankingKeys.view(COMP, 'final', 'female', true, 'freestyle')).toEqual([
      'rankings',
      COMP,
      'final',
      'female',
      'all',
      'freestyle',
    ]);
  });

  it('keys the combined ranking under the shared rankings root (invalidation coverage)', () => {
    expect(rankingKeys.combined(COMP, 'female')).toEqual([
      ...rankingKeys.all(COMP),
      'combined',
      'female',
    ]);
  });

  it('keys the overall standings under the shared rankings root (invalidation coverage)', () => {
    expect(rankingKeys.standings(COMP, 'male')).toEqual([
      ...rankingKeys.all(COMP),
      'overall',
      'male',
      'speed',
    ]);
    expect(rankingKeys.standings(COMP, 'female', 'freestyle')).toEqual([
      ...rankingKeys.all(COMP),
      'overall',
      'female',
      'freestyle',
    ]);
  });
});

describe('useRankings', () => {
  it('requests by gender only by default', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useRankings(COMP, 'final', 'male'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/rankings/final?gender=male`, {
      signal: expect.any(AbortSignal),
      readToken: undefined,
    });
  });

  it('threads allTimes and discipline into the querystring', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(
      () => useRankings(COMP, 'final', 'female', { allTimes: true, discipline: 'freestyle' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/competitions/${COMP}/rankings/final?gender=female&allTimes=true&discipline=freestyle`,
      { signal: expect.any(AbortSignal), readToken: undefined },
    );
  });
});

describe('useOverallStandings', () => {
  it('requests the overall pseudo-round with gender and discipline', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(
      () => useOverallStandings(COMP, 'female', { discipline: 'freestyle', readToken: 'tok' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/competitions/${COMP}/rankings/overall?gender=female&discipline=freestyle`,
      { signal: expect.any(AbortSignal), readToken: 'tok' },
    );
  });

  it('stays disabled without a competition', () => {
    apiFetchMock.mockReset();
    renderHook(() => useOverallStandings(null, 'male'), { wrapper: wrapper() });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('useCombinedRanking', () => {
  it('requests the combined pseudo-round with gender only (no discipline param)', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useCombinedRanking(COMP, 'female', { readToken: 'tok' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/competitions/${COMP}/rankings/combined?gender=female`,
      { signal: expect.any(AbortSignal), readToken: 'tok' },
    );
  });

  it('stays disabled without a competition', () => {
    apiFetchMock.mockReset();
    renderHook(() => useCombinedRanking(null, 'male'), { wrapper: wrapper() });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
