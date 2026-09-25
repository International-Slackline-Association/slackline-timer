import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { matchKeys, useMatches } from 'app/api/matches';

const COMP = 'worlds-2026';

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('matchKeys', () => {
  it('namespaces gender and discipline (discipline falls back to "all")', () => {
    expect(matchKeys.list(COMP, 'male')).toEqual(['matches', COMP, 'list', 'male', 'all']);
    expect(matchKeys.list(COMP, 'female', 'freestyle')).toEqual([
      'matches',
      COMP,
      'list',
      'female',
      'freestyle',
    ]);
  });
});

describe('useMatches', () => {
  it('requests by gender only when no discipline is given', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useMatches(COMP, 'male'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches?gender=male`, {
      signal: expect.any(AbortSignal),
      readToken: undefined,
    });
  });

  it('threads the discipline into the querystring', async () => {
    apiFetchMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(
      () => useMatches(COMP, 'female', { discipline: 'freestyle', readToken: 'rt' }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/competitions/${COMP}/matches?gender=female&discipline=freestyle`,
      { signal: expect.any(AbortSignal), readToken: 'rt' },
    );
  });
});
