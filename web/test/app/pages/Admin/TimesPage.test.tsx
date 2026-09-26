import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, Gender, Time } from 'app/types';
import { DNF_SENTINEL } from 'app/util/time';

// Keep the real ApiError; stub only the network call.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { TimesPage } from 'app/pages/Admin/TimesPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderPage = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <TimesPage />
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

const time = (timeId: string, over: Partial<Time> = {}): Time => ({
  timeId,
  compId: COMP,
  athleteId: 'a1',
  round: 'qualification',
  timeMs: 83_450, // 1:23.45
  startTime: 1_700_000_000_000,
  ...over,
});

const ATHLETES = [athlete('a1', 'Jane Doe', 'female'), athlete('a2', 'John Roe')];

/** Dispatch apiFetch on path/method; athletes always present, times configurable. */
const wireApi = (
  times: Time[],
  onWrite?: (method: string, body: unknown, path: string) => Time | void,
) => {
  apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === `/competitions/${COMP}/athletes` && !opts?.method)
      return Promise.resolve(ATHLETES);
    if (path.startsWith(`/competitions/${COMP}/times`) && !opts?.method)
      return Promise.resolve(times);
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

describe('TimesPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('lists times with athlete names and formatted elapsed time', async () => {
    wireApi([time('t1'), time('t2', { athleteId: 'a2', round: 'final', timeMs: 62_000 })]);
    renderPage(COMP);

    // Scope to the table: athlete names and round labels also appear as
    // <option>s in the filter dropdowns.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).getByText('1:23.45')).toBeInTheDocument();
    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).getByText('1:02.00')).toBeInTheDocument();
    expect(within(table).getByText('Final')).toBeInTheDocument();
  });

  it('renders the DNF sentinel as DNF', async () => {
    wireApi([time('t1', { timeMs: DNF_SENTINEL })]);
    renderPage(COMP);
    expect(await screen.findByText('DNF')).toBeInTheDocument();
  });

  it('shows an empty state when there are no times', async () => {
    wireApi([]);
    renderPage(COMP);
    expect(await screen.findByText(/no times recorded yet/i)).toBeInTheDocument();
  });

  it('filters by round', async () => {
    wireApi([time('t1'), time('t2', { athleteId: 'a2', round: 'final', timeMs: 62_000 })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by round/i), { target: { value: 'final' } });

    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('filters by athlete', async () => {
    wireApi([time('t1'), time('t2', { athleteId: 'a2', round: 'final', timeMs: 62_000 })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by athlete/i), { target: { value: 'a2' } });

    expect(within(table).getByText('John Roe')).toBeInTheDocument();
    expect(within(table).queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('sorts fastest first, DNF sentinel last', async () => {
    wireApi([
      time('t1'), // 1:23.45
      time('t2', { athleteId: 'a2', round: 'final', timeMs: DNF_SENTINEL }),
      time('t3', { athleteId: 'a2', timeMs: 62_000 }),
    ]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    const rows = within(table)
      .getAllByRole('row')
      .slice(1) // header
      .map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('1:02.00');
    expect(rows[1]).toContain('1:23.45');
    expect(rows[2]).toContain('DNF');
  });

  it("shows each time's athlete gender", async () => {
    wireApi([time('t1'), time('t2', { athleteId: 'a2', timeMs: 62_000 })]);
    renderPage(COMP);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Female')).toBeInTheDocument();
    expect(within(table).getByText('Male')).toBeInTheDocument();
  });

  it('filters by gender', async () => {
    wireApi([time('t1'), time('t2', { athleteId: 'a2', round: 'final', timeMs: 62_000 })]);
    renderPage(COMP);
    const table = await screen.findByRole('table');
    within(table).getByText('Jane Doe');

    fireEvent.change(screen.getByLabelText(/filter by gender/i), { target: { value: 'female' } });

    expect(within(table).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(table).queryByText('John Roe')).not.toBeInTheDocument();
  });

  it('creates a time from the form', async () => {
    const created: Time[] = [];
    wireApi(created, (method, body) => {
      if (method === 'POST') {
        const t = { ...(body as object), timeId: 't1', compId: COMP } as Time;
        created.push(t);
        return t;
      }
    });
    renderPage(COMP);
    await screen.findByText(/no times recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add time/i }));
    expect(await screen.findByText('New time')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^athlete/i), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText(/^time/i), { target: { value: '1:23.45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/times`, {
        method: 'POST',
        body: { athleteId: 'a1', round: 'qualification', timeMs: 83_450 },
      }),
    );
    await waitFor(() => expect(screen.queryByText('New time')).not.toBeInTheDocument());
  });

  it('creates a DNF time saving the sentinel', async () => {
    wireApi([], (method, body) =>
      method === 'POST' ? ({ ...(body as object), timeId: 't1', compId: COMP } as Time) : undefined,
    );
    renderPage(COMP);
    await screen.findByText(/no times recorded yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add time/i }));
    await screen.findByText('New time');
    fireEvent.change(screen.getByLabelText(/^athlete/i), { target: { value: 'a1' } });
    fireEvent.click(screen.getByLabelText(/dnf/i));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/times`, {
        method: 'POST',
        body: { athleteId: 'a1', round: 'qualification', timeMs: DNF_SENTINEL },
      }),
    );
  });

  it('edits a time, preserving the existing startTime', async () => {
    wireApi([time('t1')], (method, body) => (method === 'PUT' ? (body as Time) : undefined));
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /edit time for jane doe/i }));
    expect(await screen.findByText('Edit time')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^round/i), { target: { value: 'final' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/times/t1`, {
        method: 'PUT',
        body: {
          athleteId: 'a1',
          round: 'final',
          timeMs: 83_450,
          startTime: 1_700_000_000_000,
        },
      }),
    );
  });

  it('deletes a time after confirmation', async () => {
    wireApi([time('t1')], (method) => (method === 'DELETE' ? undefined : undefined));
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /delete time for jane doe/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/times/t1`, {
        method: 'DELETE',
      }),
    );
  });

  it('surfaces a server error when a delete fails', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `/competitions/${COMP}/athletes`) return Promise.resolve(ATHLETES);
      if (!opts?.method) return Promise.resolve([time('t1')]);
      return Promise.reject(new ApiError(500, 'could not delete the time'));
    });
    renderPage(COMP);

    fireEvent.click(await screen.findByRole('button', { name: /delete time for jane doe/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/could not delete the time/i)).toBeInTheDocument();
  });
});
