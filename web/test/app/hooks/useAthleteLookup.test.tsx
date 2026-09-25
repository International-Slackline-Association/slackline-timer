import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Athlete } from 'app/types';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { useAthleteLookup } from 'app/hooks/useAthleteLookup';

const COMP = 'worlds-2026';

const athlete = (athleteId: string, name: string, over: Partial<Athlete> = {}): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
  ...over,
});

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

afterEach(() => apiFetchMock.mockReset());

describe('useAthleteLookup', () => {
  it('joins ids to athletes with name and gender helpers', async () => {
    apiFetchMock.mockResolvedValue([
      athlete('a1', 'Jane Doe', { gender: 'female' }),
      athlete('a2', 'John Roe'),
    ]);
    const { result } = renderHook(() => useAthleteLookup(COMP), { wrapper });

    await waitFor(() => expect(result.current.athletes.isSuccess).toBe(true));

    expect(result.current.byId('a1')?.name).toBe('Jane Doe');
    expect(result.current.athleteName('a2')).toBe('John Roe');
    expect(result.current.athleteGender('a1')).toBe('Female');
  });

  it('falls back for unknown or missing ids', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe')]);
    const { result } = renderHook(() => useAthleteLookup(COMP), { wrapper });

    await waitFor(() => expect(result.current.athletes.isSuccess).toBe(true));

    expect(result.current.byId('nope')).toBeUndefined();
    expect(result.current.byId(undefined)).toBeUndefined();
    expect(result.current.athleteName('nope')).toBe('(unknown athlete)');
    expect(result.current.athleteGender('nope')).toBe('—');
  });

  it('passes the read token through to the athletes query', async () => {
    apiFetchMock.mockResolvedValue([]);
    const { result } = renderHook(() => useAthleteLookup(COMP, { readToken: 'tok' }), { wrapper });

    await waitFor(() => expect(result.current.athletes.isSuccess).toBe(true));

    expect(apiFetchMock).toHaveBeenCalledWith(
      `/competitions/${COMP}/athletes`,
      expect.objectContaining({ readToken: 'tok' }),
    );
  });
});
