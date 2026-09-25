import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Competition } from 'app/types';

// Keep the real ApiError (the page does `instanceof ApiError`); only stub the
// network call so the hooks exercise React Query against controllable data.
const { apiFetchMock, currentUserMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  currentUserMock: vi.fn(),
}));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});
vi.mock('app/auth/currentUser', () => ({ useCurrentUser: currentUserMock }));

import { COMPETITIONS_LIST_POLL_MS } from 'app/api/competitions';
import { CompetitionsPage } from 'app/pages/Admin/CompetitionsPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <CompetitionsPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const comp = (compId: string, name: string): Competition => ({
  compId,
  name,
  startDate: '2026-07-01',
  endDate: '2026-07-03',
});

beforeEach(() => {
  window.localStorage.clear();
  // Default to a superadmin; individual tests override for the manager case.
  currentUserMock.mockReturnValue({
    loading: false,
    isSuperadmin: true,
    sub: 's',
    email: 'a@b.co',
  });
});
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
  currentUserMock.mockReset();
});

describe('CompetitionsPage', () => {
  it('lists the competitions returned by the API', async () => {
    apiFetchMock.mockResolvedValue([
      comp('worlds-2026', 'Worlds 2026'),
      comp('euros-2026', 'Euros 2026'),
    ]);

    renderPage();

    expect(await screen.findByText('Worlds 2026')).toBeInTheDocument();
    expect(screen.getByText('Euros 2026')).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no competitions', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no competitions yet/i)).toBeInTheDocument();
  });

  it('selects a competition and persists the choice', async () => {
    apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /select worlds 2026/i }));

    expect(await screen.findByText('Selected')).toBeInTheDocument();
    expect(window.localStorage.getItem('speedline.selectedCompId')).toBe('worlds-2026');
  });

  it('offers Athletes / Freestyle / Speedline once a competition is selected', async () => {
    apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /select worlds 2026/i }));

    expect(await screen.findByRole('link', { name: /athletes/i })).toHaveAttribute(
      'href',
      '/admin/athletes',
    );
    expect(screen.getByRole('link', { name: /freestyle/i })).toHaveAttribute(
      'href',
      '/freestyle/control?sessionId=worlds-2026',
    );
    expect(screen.getByRole('link', { name: /speedline/i })).toHaveAttribute(
      'href',
      '/speedline/control?sessionId=worlds-2026',
    );
  });

  it('polls the list so a competition created elsewhere appears without a reload', async () => {
    // shouldAdvanceTime keeps RTL's waitFor and React Query's internal
    // zero-delay scheduling alive while the 15s poll interval jumps instantly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
      renderPage();
      expect(await screen.findByText('Worlds 2026')).toBeInTheDocument();
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      apiFetchMock.mockResolvedValue([
        comp('worlds-2026', 'Worlds 2026'),
        comp('euros-2026', 'Euros 2026'),
      ]);
      await act(() => vi.advanceTimersByTimeAsync(COMPETITIONS_LIST_POLL_MS));

      expect(apiFetchMock).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('Euros 2026')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('links to the separate page for adding a competition (superadmin)', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/no competitions yet/i);

    expect(screen.getByRole('link', { name: /add competition/i })).toHaveAttribute(
      'href',
      '/admin/competitions/new',
    );
  });

  it('offers a Managers link for a selected competition (superadmin only)', async () => {
    apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /select worlds 2026/i }));

    expect(await screen.findByRole('link', { name: /managers/i })).toHaveAttribute(
      'href',
      '/admin/competitions/worlds-2026/managers',
    );
  });

  it('drops a stale selection the server-filtered list no longer contains', async () => {
    // A manager selected worlds-2026, then their grant was revoked: the next
    // list fetch omits it. Keeping the selection would offer timer links whose
    // $connect is doomed — the page must clear it.
    window.localStorage.setItem('speedline.selectedCompId', 'worlds-2026');
    apiFetchMock.mockResolvedValue([comp('euros-2026', 'Euros 2026')]);

    renderPage();

    expect(await screen.findByText('Euros 2026')).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem('speedline.selectedCompId')).toBeNull());
    expect(screen.queryByRole('link', { name: /speedline/i })).not.toBeInTheDocument();
  });

  it('hides admin-only affordances (add / managers) from a scoped manager', async () => {
    currentUserMock.mockReturnValue({
      loading: false,
      isSuperadmin: false,
      sub: 'm',
      email: 'm@b.co',
    });
    apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /select worlds 2026/i }));

    expect(screen.queryByRole('link', { name: /add competition/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /managers/i })).not.toBeInTheDocument();
    // A manager still gets the operational actions.
    expect(screen.getByRole('link', { name: /speedline/i })).toBeInTheDocument();
  });
});
