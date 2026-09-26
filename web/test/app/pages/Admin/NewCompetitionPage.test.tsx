import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Competition } from 'app/types';

// Keep the real ApiError (the page does `instanceof ApiError`); only stub the
// network call so the hooks exercise React Query against controllable data.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { ApiError } from 'app/api/client';
import { NewCompetitionPage } from 'app/pages/Admin/NewCompetitionPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/competitions/new']}>
        <SelectedCompetitionProvider>
          <Routes>
            <Route path="/admin/competitions/new" element={<NewCompetitionPage />} />
            <Route path="/admin/competitions" element={<div>Competitions list</div>} />
          </Routes>
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('NewCompetitionPage', () => {
  it('posts the form values, selects the competition, and returns to the list', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === '/competitions' && opts?.method === 'POST') {
        return Promise.resolve(opts.body as Competition);
      }
      throw new Error(`unexpected ${opts?.method ?? 'GET'} ${path}`);
    });

    renderPage();

    fireEvent.change(screen.getByLabelText(/competition id/i), {
      target: { value: 'worlds-2026' },
    });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Worlds 2026' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-07-03' } });
    fireEvent.click(screen.getByRole('button', { name: /create competition/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/competitions', {
        method: 'POST',
        body: {
          compId: 'worlds-2026',
          name: 'Worlds 2026',
          startDate: '2026-07-01',
          endDate: '2026-07-03',
        },
      }),
    );

    expect(window.localStorage.getItem('speedline.selectedCompId')).toBe('worlds-2026');
    expect(await screen.findByText('Competitions list')).toBeInTheDocument();
  });

  it('surfaces validation details from a failed create', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(400, 'invalid competition', ['name is required']));

    renderPage();

    fireEvent.change(screen.getByLabelText(/competition id/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-07-03' } });
    fireEvent.click(screen.getByRole('button', { name: /create competition/i }));

    expect(await screen.findByText(/invalid competition: name is required/i)).toBeInTheDocument();
  });
});
