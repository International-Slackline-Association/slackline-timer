import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, RankedAthlete } from 'app/types';

// The page opens a receiver socket for the countdown + db_update refresh — stub
// it so no real socket opens (the realtime path is deliberately untested).
vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  return {
    ...actual,
    useWS: () => ({ lastJsonMessage: null, readyState: 1, sendWSMessage: vi.fn() }),
  };
});

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { FreestylePreviewPage } from 'app/pages/Freestyle/PreviewPage';

const COMP = 'worlds-2026';

const renderPage = (path: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/freestyle/preview" element={<FreestylePreviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('FreestylePreviewPage standings panel', () => {
  it('renders freestyle overalls and fetches rankings with discipline=freestyle', async () => {
    const ranked: RankedAthlete[] = [
      { athlete: athlete('a1', 'Jane Doe'), bestTimeMs: 0, overall: 27.5 },
      { athlete: athlete('a2', 'John Roe'), bestTimeMs: 0, overall: 21 },
    ];
    apiFetchMock.mockResolvedValue(ranked);

    renderPage(`/freestyle/preview?sessionId=${COMP}&round=final&gender=male`);

    // The ranking plate splits the name bold-given / light-family (LAAX).
    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('Doe')).toBeInTheDocument();
    expect(screen.getByText('27.50')).toBeInTheDocument();
    expect(screen.getByText('21.00')).toBeInTheDocument();

    // The display also fetches /athletes for the lane banners — find the
    // rankings call rather than assuming call order.
    const rankingsCall = apiFetchMock.mock.calls.find(([p]) => String(p).includes('/rankings/'));
    expect(rankingsCall?.[0]).toContain(`/competitions/${COMP}/rankings/final`);
    expect(rankingsCall?.[0]).toContain('discipline=freestyle');
  });

  // The banner athlete lookup fires regardless of standings params, so these
  // assert no RANKINGS fetch specifically — not a globally silent apiFetch.
  const rankingsFetched = () =>
    apiFetchMock.mock.calls.some(([p]) => String(p).includes('/rankings/'));

  it('does not fetch rankings and shows no standings when the round param is missing', () => {
    renderPage(`/freestyle/preview?sessionId=${COMP}&gender=male`);

    expect(rankingsFetched()).toBe(false);
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  it('does not fetch rankings when the round param is invalid', () => {
    renderPage(`/freestyle/preview?sessionId=${COMP}&round=bogus&gender=male`);

    expect(rankingsFetched()).toBe(false);
  });
});

function athlete(athleteId: string, name: string): Athlete {
  return {
    athleteId,
    compId: COMP,
    firstName: name.split(' ')[0],
    lastName: name.split(' ').slice(1).join(' '),
    name,
    shortName: name.split(' ')[0],
    birthDate: '1990-01-01',
    country: 'USA',
    gender: 'male',
  };
}
