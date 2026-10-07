import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { athleteKeys, useAthletes } from 'app/api/athletes';
import { PHOTO_URL_REFETCH_MS } from 'app/api/photoUrlRefresh';
import {
  rankingKeys,
  useCombinedRanking,
  useOverallStandings,
  useRankings,
} from 'app/api/rankings';

const COMP = 'worlds-2026';

const optionsOf = async (useHook: () => unknown, queryKey: readonly unknown[]) => {
  apiFetchMock.mockReset().mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(useHook, { wrapper });
  await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
  const options = client.getQueryCache().find({ queryKey, exact: true })?.observers[0]?.options;
  client.clear();
  return options;
};

describe('photo-carrying queries', () => {
  const cases = [
    [
      'useAthletes',
      (t?: string) => () => useAthletes(COMP, { readToken: t }),
      athleteKeys.list(COMP),
    ],
    [
      'useRankings',
      (t?: string) => () => useRankings(COMP, 'final', 'male', { readToken: t }),
      rankingKeys.view(COMP, 'final', 'male', false),
    ],
    [
      'useOverallStandings',
      (t?: string) => () => useOverallStandings(COMP, 'male', { readToken: t }),
      rankingKeys.standings(COMP, 'male'),
    ],
    [
      'useCombinedRanking',
      (t?: string) => () => useCombinedRanking(COMP, 'male', { readToken: t }),
      rankingKeys.combined(COMP, 'male'),
    ],
  ] as const;

  it.each(cases)(
    '%s re-fetches every 3 h, token or not, in the background too',
    async (_, hook, key) => {
      for (const token of ['read-token', undefined]) {
        const options = await optionsOf(hook(token), key);
        expect(options).toMatchObject({
          refetchInterval: PHOTO_URL_REFETCH_MS,
          refetchIntervalInBackground: true,
        });
      }
      expect(PHOTO_URL_REFETCH_MS).toBe(3 * 60 * 60 * 1000);
    },
  );
});
