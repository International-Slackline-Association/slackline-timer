import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Manager } from 'app/types';

const { apiFetchMock, currentUserMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  currentUserMock: vi.fn(),
}));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});
vi.mock('app/auth/currentUser', () => ({ useCurrentUser: currentUserMock }));

import { CompetitionManagersPage } from 'app/pages/Admin/CompetitionManagersPage';

const manager = (sub: string, email: string): Manager => ({
  sub,
  email,
  grantedByEmail: 'admin@isa.org',
  grantedBySub: 'admin',
  grantedAt: 1_700_000_000_000,
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/competitions/worlds-2026/managers']}>
        <Routes>
          <Route
            path="/admin/competitions/:compId/managers"
            element={<CompetitionManagersPage />}
          />
          <Route path="/admin/competitions" element={<div>competitions list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  currentUserMock.mockReturnValue({
    loading: false,
    isSuperadmin: true,
    sub: 's',
    email: 'a@b.co',
  });
});
afterEach(() => {
  apiFetchMock.mockReset();
  currentUserMock.mockReset();
});

describe('CompetitionManagersPage', () => {
  it('lists the granted managers', async () => {
    apiFetchMock.mockResolvedValue([manager('u1', 'rider@isa.org')]);

    renderPage();

    expect(await screen.findByText('rider@isa.org')).toBeInTheDocument();
  });

  it('grants a manager by email and refetches the list', async () => {
    apiFetchMock.mockResolvedValueOnce([]); // initial list
    renderPage();
    await screen.findByText(/no managers yet/i);

    apiFetchMock.mockResolvedValueOnce(manager('u2', 'new@isa.org')); // POST result
    apiFetchMock.mockResolvedValueOnce([manager('u2', 'new@isa.org')]); // refetch

    fireEvent.change(screen.getByLabelText(/isa account email/i), {
      target: { value: 'new@isa.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/competitions/worlds-2026/managers',
        expect.objectContaining({ method: 'POST', body: { email: 'new@isa.org' } }),
      ),
    );
    expect(await screen.findByText('new@isa.org')).toBeInTheDocument();
  });

  it('revokes a manager', async () => {
    apiFetchMock.mockResolvedValueOnce([manager('u1', 'rider@isa.org')]);
    renderPage();
    await screen.findByText('rider@isa.org');

    apiFetchMock.mockResolvedValueOnce(undefined); // DELETE
    apiFetchMock.mockResolvedValueOnce([]); // refetch

    fireEvent.click(screen.getByRole('button', { name: /revoke rider@isa\.org/i }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/competitions/worlds-2026/managers/u1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('redirects a non-superadmin away from the page', async () => {
    currentUserMock.mockReturnValue({
      loading: false,
      isSuperadmin: false,
      sub: 'm',
      email: 'm@b.co',
    });

    renderPage();

    expect(await screen.findByText('competitions list')).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
