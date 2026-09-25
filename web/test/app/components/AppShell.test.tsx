import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPETITIONS_LIST_POLL_MS } from 'app/api/competitions';
import type { Competition } from 'app/types';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { AppShell } from 'app/components/AppShell';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const comp = (compId: string, name: string): Competition => ({
  compId,
  name,
  startDate: '2026-07-01',
  endDate: '2026-07-03',
});

const renderShell = (initialPath: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SelectedCompetitionProvider>
          <AppShell>
            <div>page-content</div>
          </AppShell>
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
});
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('AppShell', () => {
  it('renders chrome (brand + section nav) on admin routes', () => {
    renderShell('/admin/athletes');

    expect(screen.getByRole('link', { name: /slackline timer/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Athletes' })).toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  // The wordmark is the brand link's accessible name, not a section title: as a
  // heading it opened every page in the app at level 6, one above whatever the
  // page's own `h1` then said.
  it('contributes no heading above the page', () => {
    renderShell('/admin/athletes');

    const brand = screen.getByRole('link', { name: /slackline timer/i });
    expect(within(brand).queryByRole('heading')).toBeNull();
  });

  it('shows a breadcrumb trail on admin leaf pages', () => {
    renderShell('/admin/athletes');

    const breadcrumbs = screen.getByLabelText('breadcrumb');
    expect(breadcrumbs).toHaveTextContent('Competitions');
    expect(breadcrumbs).toHaveTextContent('Athletes');
  });

  it('highlights the active section tab', () => {
    renderShell('/admin/times');

    expect(screen.getByRole('tab', { name: 'Times' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Athletes' })).toHaveAttribute('aria-selected', 'false');
  });

  it('omits all chrome on the stream overlay routes', () => {
    renderShell('/stream/rankings/final/male');

    expect(screen.queryByRole('link', { name: /slackline timer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('omits all chrome on the projector preview routes', () => {
    renderShell('/speedline/preview');

    expect(screen.queryByRole('link', { name: /slackline timer/i })).not.toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('omits all chrome on the freestyle athlete display (venue screen)', () => {
    renderShell('/freestyle/athletes');

    expect(screen.queryByRole('link', { name: /slackline timer/i })).not.toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('quick-launch carries the selected competition as the relay sessionId', async () => {
    window.localStorage.setItem('speedline.selectedCompId', 'worlds-2026');
    renderShell('/admin/athletes');

    // Wait for the competitions query so the context chip resolves the name.
    expect(await screen.findByText('Worlds 2026')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /^speedline$/i })).toHaveAttribute(
      'href',
      '/speedline/control?sessionId=worlds-2026',
    );
    expect(screen.getByRole('link', { name: /^freestyle$/i })).toHaveAttribute(
      'href',
      '/freestyle/control?sessionId=worlds-2026',
    );
    // The console opens in a dedicated tab so launching never tears down a
    // console already running elsewhere.
    expect(screen.getByRole('link', { name: /^speedline$/i })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: /^freestyle$/i })).toHaveAttribute('target', '_blank');
  });

  it('resolves the launched console comp from the URL sessionId when none is selected', async () => {
    // No localStorage selection — a console launched into a fresh tab only knows
    // its comp from the URL the launcher carried.
    renderShell('/speedline/control?sessionId=worlds-2026');

    expect(await screen.findByText('Worlds 2026')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /^speedline$/i })).toHaveAttribute(
      'href',
      '/speedline/control?sessionId=worlds-2026',
    );
    expect(screen.getByRole('link', { name: /^speedline$/i })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: /^freestyle$/i })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('does not borrow the URL sessionId on admin routes', () => {
    // Admin routes stay authoritative on localStorage selection only; a stray
    // ?sessionId must not light up the chrome.
    renderShell('/admin/athletes?sessionId=worlds-2026');

    expect(screen.getByText(/no competition selected/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^speedline$/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shares the list poll so the picker never disagrees on what comps exist', async () => {
    // The chrome dropdown must not go stale relative to the /admin/competitions
    // list: a comp renamed elsewhere reaches the context chip via the shared 15s
    // poll (shouldAdvanceTime keeps RTL/React Query scheduling alive while it jumps).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      window.localStorage.setItem('speedline.selectedCompId', 'worlds-2026');
      apiFetchMock.mockResolvedValue([comp('worlds-2026', 'Worlds 2026')]);
      renderShell('/admin/athletes');
      expect(await screen.findByText('Worlds 2026')).toBeInTheDocument();
      expect(apiFetchMock).toHaveBeenCalledTimes(1);

      apiFetchMock.mockResolvedValue([comp('worlds-2026', 'World Champs 2026')]);
      await act(() => vi.advanceTimersByTimeAsync(COMPETITIONS_LIST_POLL_MS));

      expect(apiFetchMock).toHaveBeenCalledTimes(2);
      expect(await screen.findByText('World Champs 2026')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables quick-launch and flags no selection when no competition is chosen', () => {
    renderShell('/admin/competitions');

    expect(screen.getByText(/no competition selected/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^speedline$/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
