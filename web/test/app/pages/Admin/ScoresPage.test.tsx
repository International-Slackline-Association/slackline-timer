import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, Gender, Score } from 'app/types';

// Keep the real ApiError; stub only the network call.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { ScoresPage } from 'app/pages/Admin/ScoresPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderPage = (compId: string | null, search = '') => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/scores${search}`]}>
        <SelectedCompetitionProvider>
          <ScoresPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const athlete = (athleteId: string, name: string, gender: Gender = 'male'): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender,
});

const score = (scoreId: string, over: Partial<Score> = {}): Score => ({
  scoreId,
  compId: COMP,
  athleteId: 'a1',
  round: 'qualification',
  difficulty: 5,
  combo: 4,
  style: 3,
  bestTrick: 2,
  controlPenalty: 1,
  overall: 13,
  ...over,
});

const ATHLETES = [athlete('a1', 'Jane Doe', 'female'), athlete('a2', 'John Roe')];

/** Dispatch apiFetch on path/method; athletes always present, scores configurable. */
const wireApi = (
  scores: Score[],
  onWrite?: (method: string, body: unknown, path: string) => Score | void,
) => {
  apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === `/competitions/${COMP}/athletes` && !opts?.method)
      return Promise.resolve(ATHLETES);
    if (path.startsWith(`/competitions/${COMP}/scores`) && !opts?.method)
      return Promise.resolve(scores);
    if (opts?.method && onWrite) {
      const result = onWrite(opts.method, opts.body, path);
      return Promise.resolve(result ?? undefined);
    }
    throw new Error(`unexpected ${opts?.method ?? 'GET'} ${path}`);
  });
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('ScoresPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('lists scores with athlete names and component values', async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final', overall: 25 })]);
    renderPage(COMP);

    // Scope to the table: athlete names and round labels also appear as
    // <option>s in the filter dropdowns.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).getByText('13.00')).toBeInTheDocument();
    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).getByText('25.00')).toBeInTheDocument();
    expect(within(table).getByText('Final')).toBeInTheDocument();
  });

  it('renders a legacy record missing numeric fields as 0.00 instead of crashing', async () => {
    // A record persisted before a component existed (or otherwise partial) has
    // `undefined` where a number is typed. The render must degrade to 0.00, not
    // throw on `undefined.toFixed` and blank the whole page.
    wireApi([
      score('s1', {
        round: 'final',
        bestTrick: undefined,
        controlPenalty: undefined,
        overall: undefined,
      } as Partial<Score>),
    ]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    // Difficulty/combo/style survive; the three absent fields show 0.00.
    expect(within(table).getAllByText('0.00').length).toBeGreaterThanOrEqual(3);
  });

  it('shows an empty state when there are no scores', async () => {
    wireApi([]);
    renderPage(COMP);
    expect(await screen.findByText(/no scores recorded yet/i)).toBeInTheDocument();
  });

  it('filters by round', async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by round/i), { target: { value: 'final' } });

    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('drops the best trick + control penalty columns when filtered to qualification (rule F8)', async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final', overall: 25 })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    // All rounds: the battle-only columns are present.
    expect(within(table).getByText('Best trick')).toBeInTheDocument();
    expect(within(table).getByText('Control penalty')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/filter by round/i), {
      target: { value: 'qualification' },
    });

    expect(within(table).queryByText('Best trick')).not.toBeInTheDocument();
    expect(within(table).queryByText('Control penalty')).not.toBeInTheDocument();
  });

  it('filters by athlete', async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by athlete/i), { target: { value: 'a2' } });

    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  // The Freestyle board's locked panel is the one correction path
  // (FREESTYLE_BOARD_UX §4.9): it links here mid-competition for ONE row, so
  // the link's filters are applied on arrival instead of being re-set by hand.
  describe('a correction link', () => {
    it('lands on the athlete and round it names', async () => {
      wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
      renderPage(COMP, '?athlete=a2&round=final');

      const table = await screen.findByRole('table');
      expect(within(table).getByText('John Roe')).toBeInTheDocument();
      expect(within(table).queryByText('Jane Doe')).not.toBeInTheDocument();
      expect(screen.getByLabelText(/filter by athlete/i)).toHaveValue('a2');
      expect(screen.getByLabelText(/filter by round/i)).toHaveValue('final');
    });

    it('is still a page: the operator can widen the filters it arrived with', async () => {
      wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
      renderPage(COMP, '?athlete=a2&round=final');
      const table = await screen.findByRole('table');

      fireEvent.change(screen.getByLabelText(/filter by athlete/i), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(/filter by round/i), { target: { value: '' } });

      expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
      expect(within(table).getByText('John Roe')).toBeInTheDocument();
    });

    // A stale bookmark, or the other competition selected in this tab: an
    // athlete the roster doesn't have would otherwise empty the table under a
    // picker showing nothing.
    it('drops an athlete this competition does not have', async () => {
      wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
      renderPage(COMP, '?athlete=ghost&round=final');

      const table = await screen.findByRole('table');
      expect(within(table).getByText('John Roe')).toBeInTheDocument();
      expect(screen.getByLabelText(/filter by athlete/i)).toHaveValue('');
    });
  });

  it('sorts by overall, highest first, DNF last', async () => {
    wireApi([
      score('s1'), // overall 13
      score('s2', { athleteId: 'a2', round: 'final', overall: 25 }),
      score('s3', { round: 'final', overall: 30, dnf: true }),
    ]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    const rows = within(table)
      .getAllByRole('row')
      .slice(1) // header
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('25.00');
    expect(rows[1]).toContain('13.00');
    expect(rows[2]).toContain('DNF');
  });

  it("shows each score's athlete gender", async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Female')).toBeInTheDocument();
    expect(within(table).getByText('Male')).toBeInTheDocument();
  });

  it('filters by gender', async () => {
    wireApi([score('s1'), score('s2', { athleteId: 'a2', round: 'final' })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by gender/i), { target: { value: 'female' } });

    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).queryByText('John Roe')).not.toBeInTheDocument();
  });

  it('creates a quali score, hiding + zeroing the battle-only components (rule F8)', async () => {
    const created: Score[] = [];
    wireApi(created, (method, body) => {
      if (method === 'POST') {
        const s = { ...(body as object), scoreId: 's1', compId: COMP, overall: 12 } as Score;
        created.push(s);
        return s;
      }
    });
    renderPage(COMP);
    await screen.findByText(/no scores recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add score/i }));
    expect(await screen.findByText('New score')).toBeInTheDocument();

    // Default round is qualification: best trick / control penalty are hidden.
    expect(screen.queryByLabelText(/^best trick/i)).toBeNull();
    expect(screen.queryByLabelText(/^control penalty/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^athlete/i), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText(/^difficulty/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^combo/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/^style/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores`, {
        method: 'POST',
        body: {
          athleteId: 'a1',
          round: 'qualification',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 0,
          controlPenalty: 0,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByText('New score')).not.toBeInTheDocument());
  });

  it('creates a battle score from the form, omitting overall so the server computes it', async () => {
    const created: Score[] = [];
    wireApi(created, (method, body) => {
      if (method === 'POST') {
        const s = { ...(body as object), scoreId: 's1', compId: COMP, overall: 14 } as Score;
        created.push(s);
        return s;
      }
    });
    renderPage(COMP);
    await screen.findByText(/no scores recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add score/i }));
    expect(await screen.findByText('New score')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^round/i), { target: { value: 'final' } });
    fireEvent.change(screen.getByLabelText(/^athlete/i), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText(/^difficulty/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^combo/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/^style/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^best trick/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^control penalty/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores`, {
        method: 'POST',
        body: {
          athleteId: 'a1',
          round: 'final',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 2,
          controlPenalty: 1,
        },
      }),
    );
    await waitFor(() => expect(screen.queryByText('New score')).not.toBeInTheDocument());
  });

  it('sends an explicit overall when one is typed', async () => {
    wireApi([], (method, body) =>
      method === 'POST'
        ? ({ ...(body as object), scoreId: 's1', compId: COMP } as Score)
        : undefined,
    );
    renderPage(COMP);
    await screen.findByText(/no scores recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add score/i }));
    await screen.findByText('New score');
    fireEvent.change(screen.getByLabelText(/^round/i), { target: { value: 'final' } });
    fireEvent.change(screen.getByLabelText(/^athlete/i), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText(/^difficulty/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^combo/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/^style/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^best trick/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^control penalty/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^overall/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores`, {
        method: 'POST',
        body: {
          athleteId: 'a1',
          round: 'final',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 2,
          controlPenalty: 1,
          overall: 20,
        },
      }),
    );
  });

  it('previews the computed overall from the components', async () => {
    wireApi([]);
    renderPage(COMP);
    await screen.findByText(/no scores recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add score/i }));
    await screen.findByText('New score');
    fireEvent.change(screen.getByLabelText(/^round/i), { target: { value: 'final' } });
    fireEvent.change(screen.getByLabelText(/^difficulty/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/^combo/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/^style/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^best trick/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^control penalty/i), { target: { value: '1' } });

    expect(await screen.findByText(/computed overall: 13/i)).toBeInTheDocument();
  });

  it('edits a score', async () => {
    wireApi([score('s1')], (method, body) => (method === 'PUT' ? (body as Score) : undefined));
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /edit score for jane doe/i }));
    expect(await screen.findByText('Edit score')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^round/i), { target: { value: 'final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores/s1`, {
        method: 'PUT',
        body: {
          athleteId: 'a1',
          round: 'final',
          difficulty: 5,
          combo: 4,
          style: 3,
          bestTrick: 2,
          controlPenalty: 1,
          overall: 13,
        },
      }),
    );
  });

  it('deletes a score after confirmation', async () => {
    wireApi([score('s1')], (method) => (method === 'DELETE' ? undefined : undefined));
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /delete score for jane doe/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/scores/s1`, {
        method: 'DELETE',
      }),
    );
  });

  it('surfaces a server error when a delete fails', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `/competitions/${COMP}/athletes`) return Promise.resolve(ATHLETES);
      if (!opts?.method) return Promise.resolve([score('s1')]);
      return Promise.reject(new ApiError(500, 'could not delete the score'));
    });
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /delete score for jane doe/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/could not delete the score/i)).toBeInTheDocument();
  });
});
