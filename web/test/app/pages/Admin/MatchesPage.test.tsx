import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, Match } from 'app/types';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { MatchesPage } from 'app/pages/Admin/MatchesPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderPage = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <MatchesPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const athlete = (athleteId: string, name: string, gender: 'male' | 'female' = 'male'): Athlete => ({
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

const match = (matchId: string, over: Partial<Match> = {}): Match => ({
  matchId,
  compId: COMP,
  discipline: 'speed',
  round: 'final',
  roundName: 'Final 1',
  gender: 'male',
  position: 0,
  ...over,
});

const ATHLETES = [
  athlete('a1', 'Jane Doe'),
  athlete('a2', 'John Roe'),
  athlete('a3', 'Mia Fox', 'female'),
];

/** Dispatch apiFetch: athletes always present, matches filtered by ?gender=. */
const wireApi = (
  matchesByGender: { male?: Match[]; female?: Match[] },
  onWrite?: (method: string, body: unknown, path: string) => Match | void,
) => {
  apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === `/competitions/${COMP}/athletes` && !opts?.method)
      return Promise.resolve(ATHLETES);
    if (path.includes('/matches') && !opts?.method) {
      const gender = path.includes('gender=female') ? 'female' : 'male';
      const discipline = path.includes('discipline=freestyle') ? 'freestyle' : 'speed';
      return Promise.resolve(
        (matchesByGender[gender] ?? []).filter((m) => m.discipline === discipline),
      );
    }
    if (opts?.method && onWrite)
      return Promise.resolve(onWrite(opts.method, opts.body, path) ?? undefined);
    throw new Error(`unexpected ${opts?.method ?? 'GET'} ${path}`);
  });
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('MatchesPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('lists matches for the default gender with resolved athlete names and winner', async () => {
    wireApi({ male: [match('m1', { athlete1Id: 'a1', athlete2Id: 'a2', winnerId: 'a1' })] });
    renderPage(COMP);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Final 1')).toBeInTheDocument();
    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    // Jane Doe appears twice: as athlete 1 and as the winner.
    expect(within(table).getAllByText('Jane Doe')).toHaveLength(2);

    const path = apiFetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/matches'),
    )![0] as string;
    expect(path).toContain('gender=male');
  });

  it('refetches when switching gender', async () => {
    wireApi({
      male: [match('m1')],
      female: [match('m2', { gender: 'female', roundName: 'Womens Final' })],
    });
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.change(screen.getByLabelText(/^gender/i), { target: { value: 'female' } });
    expect(await screen.findByText('Womens Final')).toBeInTheDocument();
  });

  it('refetches when switching discipline', async () => {
    wireApi({
      male: [match('m1'), match('f1', { discipline: 'freestyle', roundName: 'Freestyle Final' })],
    });
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.click(screen.getByRole('button', { name: 'Freestyle' }));
    expect(await screen.findByText('Freestyle Final')).toBeInTheDocument();

    const paths = apiFetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.includes('/matches'));
    expect(paths.some((p) => p.includes('discipline=freestyle'))).toBe(true);
  });

  it('shows an empty state when there are no matches', async () => {
    wireApi({ male: [] });
    renderPage(COMP);
    expect(await screen.findByText(/no men matches yet/i)).toBeInTheDocument();
  });

  it('creates a match from the form', async () => {
    const created: Match[] = [];
    wireApi({ male: created }, (method, body) => {
      if (method === 'POST') {
        const m = { ...(body as object), matchId: 'm1', compId: COMP } as Match;
        created.push(m);
        return m;
      }
    });
    renderPage(COMP);
    await screen.findByText(/no men matches yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add match/i }));
    expect(await screen.findByText('New match')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/round name/i), { target: { value: 'Semi 1' } });
    fireEvent.change(screen.getByLabelText(/^athlete 1/i), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText(/^athlete 2/i), { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches`, {
        method: 'POST',
        body: {
          discipline: 'speed',
          round: 'quarter',
          roundName: 'Semi 1',
          gender: 'male',
          position: 0,
          athlete1Id: 'a1',
          athlete2Id: 'a2',
        },
      }),
    );
  });

  it('lets the winner be set to an assigned athlete', async () => {
    wireApi({ male: [match('m1', { athlete1Id: 'a1', athlete2Id: 'a2' })] }, (method, body) =>
      method === 'PUT' ? (body as Match) : undefined,
    );
    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: /edit final 1/i }));
    await screen.findByText('Edit match');

    fireEvent.change(screen.getByLabelText(/^winner/i), { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/m1`, {
        method: 'PUT',
        body: expect.objectContaining({ winnerId: 'a2', athlete1Id: 'a1', athlete2Id: 'a2' }),
      }),
    );
  });

  it('deletes a match after confirmation', async () => {
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: /delete final 1/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/m1`, {
        method: 'DELETE',
      }),
    );
  });

  it('renders the playoff bracket with athletes in their named slots', async () => {
    wireApi({
      male: [
        match('q1', {
          round: 'quarter',
          roundName: 'Quarter 1',
          position: 1,
          athlete1Id: 'a1',
          athlete2Id: 'a2',
          winnerId: 'a1',
        }),
        match('f1', { round: 'final', position: 1, athlete1Id: 'a1' }),
      ],
    });
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.click(screen.getByRole('button', { name: 'Bracket' }));

    // Short names land in the playoff8 slot boxes (quarter 1 athlete1/athlete2).
    const bracket = await screen.findByTestId('playoff-bracket');
    expect(
      within(within(bracket).getByTestId('slot-box_a_1')).getByText('Jane'),
    ).toBeInTheDocument();
    expect(
      within(within(bracket).getByTestId('slot-box_a_3')).getByText('John'),
    ).toBeInTheDocument();
    // The finalist flows into the final-left slot too.
    expect(
      within(within(bracket).getByTestId('slot-box_final_l')).getByText('Jane'),
    ).toBeInTheDocument();
  });

  it('previews the name-tree bracket variant via the layout toggle', async () => {
    wireApi({
      male: [
        match('sf1', {
          round: 'small_final',
          roundName: 'Small Final',
          position: 1,
          athlete1Id: 'a1',
          winnerId: 'a1',
        }),
      ],
    });
    renderPage(COMP);
    await screen.findByText('Small Final');

    fireEvent.click(screen.getByRole('button', { name: 'Bracket' }));
    // Profile variant has no small-final winner plate.
    expect(screen.queryByTestId('slot-small_winner')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Names' }));
    // The name tree exposes the small-final winner slot.
    expect(await screen.findByTestId('slot-small_winner')).toBeInTheDocument();
  });

  it('seeds the quarters via the unified advance-bracket control', async () => {
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    await screen.findByText('Final 1');

    // The qualification row of the from-stage dropdown routes through advance
    // (the server dispatches qualification → seed).
    fireEvent.change(screen.getByLabelText(/advance bracket/i), {
      target: { value: 'qualification' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^advance bracket$/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/advance`, {
        method: 'POST',
        body: { discipline: 'speed', gender: 'male', fromRound: 'qualification', force: false },
      }),
    );
  });

  it('sends the seed stage override when the operator forces one', async () => {
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.change(screen.getByLabelText(/advance bracket/i), {
      target: { value: 'qualification' },
    });
    fireEvent.change(screen.getByLabelText(/seed stage/i), { target: { value: 'half' } });
    fireEvent.click(screen.getByRole('button', { name: /^advance bracket$/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/advance`, {
        method: 'POST',
        body: {
          discipline: 'speed',
          gender: 'male',
          fromRound: 'qualification',
          force: false,
          stage: 'half',
        },
      }),
    );
  });

  it('offers the seed stage control only on the qualification step', async () => {
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    await screen.findByText('Final 1');

    expect(screen.getByLabelText(/seed stage/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/advance bracket/i), { target: { value: 'quarter' } });
    expect(screen.queryByLabelText(/seed stage/i)).not.toBeInTheDocument();
  });

  it('advances a winners round via the unified advance-bracket control', async () => {
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.change(screen.getByLabelText(/advance bracket/i), { target: { value: 'quarter' } });
    fireEvent.click(screen.getByRole('button', { name: /^advance bracket$/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/advance`, {
        method: 'POST',
        body: { discipline: 'speed', gender: 'male', fromRound: 'quarter', force: false },
      }),
    );
  });

  it('confirms on a 409 and re-submits the seed with force', async () => {
    let advanceCalls = 0;
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === `/competitions/${COMP}/athletes`) return Promise.resolve(ATHLETES);
      if (path.includes('/matches') && !opts?.method) return Promise.resolve([match('m1')]);
      if (path.endsWith('/matches/advance')) {
        advanceCalls += 1;
        const body = opts?.body as { force?: boolean };
        if (!body.force) return Promise.reject(new ApiError(409, 'already seeded'));
        return Promise.resolve([]);
      }
      throw new Error(`unexpected ${opts?.method ?? 'GET'} ${path}`);
    });
    renderPage(COMP);
    await screen.findByText('Final 1');

    fireEvent.change(screen.getByLabelText(/advance bracket/i), {
      target: { value: 'qualification' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^advance bracket$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/already seeded/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /overwrite/i }));

    await waitFor(() => expect(advanceCalls).toBe(2));
    expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/matches/advance`, {
      method: 'POST',
      body: { discipline: 'speed', gender: 'male', fromRound: 'qualification', force: true },
    });
  });

  it('keeps the toolbar to two wrapping rows, seeding beside the filter it acts on', async () => {
    // Title + discipline + view + Add match crowded the header row off the page
    // at 1024/1280 (the h4 collapsed into the toggles, the buttons broke over two
    // lines). The seeding actions belong with the gender they seed, and both rows
    // wrap rather than squeeze.
    wireApi({ male: [match('m1')] }, () => undefined);
    renderPage(COMP);
    await screen.findByText('Final 1');

    const advance = screen.getByRole('button', { name: /^advance bracket$/i });
    const titleRow = screen.getByRole('heading', { name: 'Matches' }).parentElement!;
    const filterRow = screen.getByLabelText('Gender').closest('.MuiStack-root')!.parentElement!;

    // The seeding actions sit with the gender they seed, not in the title row.
    expect(filterRow).toContainElement(advance);
    expect(titleRow).not.toContainElement(advance);
    // One control, not one per toolbar row.
    expect(screen.getAllByRole('button', { name: /^advance bracket$/i })).toHaveLength(1);

    for (const row of [titleRow, filterRow]) {
      expect(window.getComputedStyle(row).flexWrap).toBe('wrap');
    }
  });

  it('surfaces a server error on the list', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === `/competitions/${COMP}/athletes`) return Promise.resolve(ATHLETES);
      return Promise.reject(new ApiError(500, 'matches blew up'));
    });
    renderPage(COMP);
    expect(await screen.findByText(/matches blew up/i)).toBeInTheDocument();
  });
});
