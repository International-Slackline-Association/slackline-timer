import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, CombinedEntry, RankedAthlete, Score, StandingsEntry } from 'app/types';
import { DNF_SENTINEL } from 'app/util/time';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { RankingsPage } from 'app/pages/Admin/RankingsPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderPage = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <RankingsPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const athlete = (athleteId: string, name: string): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
});

const ranked = (name: string, bestTimeMs: number): RankedAthlete => ({
  athlete: athlete(name.toLowerCase().replace(/\s/g, ''), name),
  bestTimeMs,
});

const rankedScore = (
  name: string,
  score: Omit<Score, 'scoreId' | 'compId' | 'athleteId' | 'round'>,
): RankedAthlete => {
  const a = athlete(name.toLowerCase().replace(/\s/g, ''), name);
  return {
    athlete: a,
    bestTimeMs: 0,
    overall: score.overall,
    score: {
      scoreId: `${a.athleteId}-s`,
      compId: COMP,
      athleteId: a.athleteId,
      round: 'final',
      ...score,
    },
  };
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('RankingsPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('requests qualification / male by default and renders the ranking', async () => {
    apiFetchMock.mockResolvedValue([ranked('Jane Doe', 83_450), ranked('John Roe', 90_000)]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).getByText('1:23.45')).toBeInTheDocument();
    expect(within(table).getByText('John Roe')).toBeInTheDocument();

    const path = apiFetchMock.mock.calls[0][0] as string;
    expect(path).toContain(`/competitions/${COMP}/rankings/qualification`);
    expect(path).toContain('gender=male');
  });

  it('renders the DNF sentinel as DNF', async () => {
    apiFetchMock.mockResolvedValue([ranked('Jane Doe', DNF_SENTINEL)]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('DNF')).toBeInTheDocument();
  });

  it('shows an empty state when no times exist for the selection', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderPage(COMP);
    expect(await screen.findByText(/no times in/i)).toBeInTheDocument();
  });

  it('refetches when the round and gender change', async () => {
    apiFetchMock.mockResolvedValue([ranked('Jane Doe', 83_450)]);
    renderPage(COMP);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText(/round/i), { target: { value: 'final' } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'female' } });

    await waitFor(() => {
      const last = apiFetchMock.mock.calls.at(-1)![0] as string;
      expect(last).toContain('/rankings/final');
      expect(last).toContain('gender=female');
    });
  });

  it('surfaces a server error', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(500, 'rankings failed'));
    renderPage(COMP);
    expect(await screen.findByText(/rankings failed/i)).toBeInTheDocument();
  });

  it('does not send a discipline param on the speed path', async () => {
    apiFetchMock.mockResolvedValue([ranked('Jane Doe', 83_450)]);
    renderPage(COMP);
    await screen.findByRole('table');
    expect(apiFetchMock.mock.calls[0][0] as string).not.toContain('discipline');
  });

  it('switches to freestyle and renders the score breakdown ranked by overall', async () => {
    apiFetchMock.mockResolvedValue([
      rankedScore('Jane Doe', {
        difficulty: 8,
        combo: 7,
        style: 6,
        bestTrick: 5,
        controlPenalty: 2,
        overall: 24,
      }),
    ]);
    renderPage(COMP);

    fireEvent.click(screen.getByRole('button', { name: /freestyle/i }));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Difficulty')).toBeInTheDocument();
    expect(within(table).getByText('Overall')).toBeInTheDocument();
    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).getByText('24.00')).toBeInTheDocument();
    expect(within(table).queryByText('Best time')).not.toBeInTheDocument();

    await waitFor(() => {
      const last = apiFetchMock.mock.calls.at(-1)![0] as string;
      expect(last).toContain('discipline=freestyle');
    });
  });

  it('hides best trick + control penalty on the freestyle quali ranking, shows them at battle rounds (rule F8)', async () => {
    apiFetchMock.mockResolvedValue([
      rankedScore('Jane Doe', {
        difficulty: 8,
        combo: 7,
        style: 6,
        bestTrick: 5,
        controlPenalty: 2,
        overall: 24,
      }),
    ]);
    renderPage(COMP);

    fireEvent.click(screen.getByRole('button', { name: /freestyle/i }));

    // Default round is qualification: the battle-only columns are dropped.
    let table = await screen.findByRole('table');
    expect(within(table).queryByText('Best trick')).not.toBeInTheDocument();
    expect(within(table).queryByText('Control penalty')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/round/i), { target: { value: 'final' } });

    table = await screen.findByRole('table');
    expect(within(table).getByText('Best trick')).toBeInTheDocument();
    expect(within(table).getByText('Control penalty')).toBeInTheDocument();
  });

  it('renders the overall standings with server ranks, source labels and dash for no result', async () => {
    const standings: StandingsEntry[] = [
      {
        athlete: athlete('a1', 'Jane Doe'),
        rank: 1,
        source: 'final',
        bestTimeMs: 83_450,
      },
      // Bracket-placed with no time yet: provisional rank, em-dash result.
      {
        athlete: athlete('a2', 'John Roe'),
        rank: 2,
        source: 'final',
        provisional: true,
      },
      {
        athlete: athlete('a3', 'Max Moe'),
        rank: 5,
        source: 'qualification',
        bestTimeMs: 99_000,
      },
    ];
    apiFetchMock.mockResolvedValue(standings);
    renderPage(COMP);

    fireEvent.change(screen.getByLabelText(/round/i), { target: { value: 'overall' } });

    await waitFor(() => {
      const last = apiFetchMock.mock.calls.at(-1)![0] as string;
      expect(last).toContain(`/competitions/${COMP}/rankings/overall`);
      expect(last).toContain('gender=male');
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Source')).toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1); // skip header
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1:23.45')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Final')).toBeInTheDocument();
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    // The server-assigned rank renders as-is (5 after a 4-athlete bracket gap).
    expect(within(rows[2]).getByText('5')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Qualification')).toBeInTheDocument();
  });

  it('renders the combined ranking with shared =N ranks and disables the discipline toggle', async () => {
    const combined: CombinedEntry[] = [
      {
        athlete: athlete('a1', 'Jane Doe'),
        rank: 1,
        combined: 1.5,
        speedRank: 2,
        freestyleRank: 1,
      },
      {
        athlete: athlete('a2', 'John Roe'),
        rank: 1,
        combined: 1.5,
        speedRank: 1,
        freestyleRank: 2,
        provisional: true,
      },
      {
        athlete: athlete('a3', 'Max Moe'),
        rank: 3,
        combined: 3,
        speedRank: 3,
        freestyleRank: 3,
      },
    ];
    apiFetchMock.mockResolvedValue(combined);
    renderPage(COMP);

    fireEvent.change(screen.getByLabelText(/round/i), { target: { value: 'combined' } });

    await waitFor(() => {
      const last = apiFetchMock.mock.calls.at(-1)![0] as string;
      expect(last).toContain(`/competitions/${COMP}/rankings/combined`);
      expect(last).toContain('gender=male');
      // Cross-discipline by definition — no discipline param.
      expect(last).not.toContain('discipline');
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Speed rank')).toBeInTheDocument();
    expect(within(table).getByText('Freestyle rank')).toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1); // skip header
    // Server-shared rank renders =1 on both tied rows; the average to 1 decimal.
    expect(within(rows[0]).getByText('=1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1.5')).toBeInTheDocument();
    expect(within(rows[1]).getByText('=1')).toBeInTheDocument();
    // Rank, speed rank and freestyle rank all read 3 on the solo third row.
    expect(within(rows[2]).getAllByText('3')).toHaveLength(3);
    expect(within(rows[2]).getByText('3.0')).toBeInTheDocument();

    // The view is cross-discipline: the discipline toggle is disabled.
    expect(screen.getByRole('button', { name: /freestyle/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /speed/i })).toBeDisabled();
  });

  it('offers MATCH_ROUNDS rounds on the freestyle path (no training)', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderPage(COMP);

    fireEvent.click(screen.getByRole('button', { name: /freestyle/i }));

    const roundSelect = screen.getByLabelText(/round/i) as HTMLSelectElement;
    const options = Array.from(roundSelect.options).map((o) => o.value);
    expect(options).not.toContain('training');
    expect(options).toContain('final');
    expect(await screen.findByText(/no scores in/i)).toBeInTheDocument();
  });
});
