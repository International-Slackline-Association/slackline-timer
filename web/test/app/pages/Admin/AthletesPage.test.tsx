import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Athlete } from 'app/types';

// Keep the real ApiError; stub only the network call.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

// Stub the upload helper (its own unit test covers the hash/presign/PUT flow).
const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('app/api/photoUpload', () => ({
  uploadAthletePhoto: uploadMock,
  ACCEPTED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  acceptedFormatsHint: () => 'JPG, PNG or WebP, max 8 MB',
}));

import { ApiError } from 'app/api/client';
import { AthletesPage } from 'app/pages/Admin/AthletesPage';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderPage = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SelectedCompetitionProvider>
          <AthletesPage />
        </SelectedCompetitionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const athlete = (athleteId: string, name: string, over: Partial<Athlete> = {}): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
  ...over,
});

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
  uploadMock.mockReset();
});

describe('AthletesPage', () => {
  it('prompts to select a competition when none is selected', () => {
    renderPage(null);
    expect(screen.getByText(/select a competition first/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('lists the selected competition athletes', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
    renderPage(COMP);

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('John Roe')).toBeInTheDocument();
    expect(apiFetchMock.mock.calls[0][0]).toBe(`/competitions/${COMP}/athletes`);
  });

  it('shows an empty state when there are no athletes', async () => {
    apiFetchMock.mockResolvedValue([]);
    renderPage(COMP);
    expect(await screen.findByText(/no athletes yet/i)).toBeInTheDocument();
  });

  it('creates an athlete from the form', async () => {
    let stored: Athlete[] = [];
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === `/competitions/${COMP}/athletes` && !opts?.method)
        return Promise.resolve(stored);
      if (path === `/competitions/${COMP}/athletes` && opts?.method === 'POST') {
        const created = { ...(opts.body as object), athleteId: 'a1', compId: COMP } as Athlete;
        stored = [...stored, created];
        return Promise.resolve(created);
      }
      throw new Error(`unexpected ${opts?.method ?? 'GET'} ${path}`);
    });

    renderPage(COMP);
    await screen.findByText(/no athletes yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add athlete/i }));
    expect(await screen.findByText('New athlete')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^last name/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^short name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^birth date/i), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: 'USA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/athletes`, {
        method: 'POST',
        body: {
          firstName: 'Jane',
          lastName: 'Doe',
          name: 'Jane Doe',
          shortName: 'Jane',
          birthDate: '1990-01-01',
          country: 'USA',
          gender: 'male',
        },
      }),
    );
    await waitFor(() => expect(screen.queryByText('New athlete')).not.toBeInTheDocument());
  });

  it('edits an athlete, preserving the existing photoKey', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (!opts?.method)
        return Promise.resolve([athlete('a1', 'Jane Doe', { photoKey: 'photos/x.jpg' })]);
      if (opts.method === 'PUT') return Promise.resolve(opts.body as Athlete);
      throw new Error(`unexpected ${opts?.method} ${path}`);
    });

    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Jane Doe' }));
    expect(await screen.findByText('Edit athlete')).toBeInTheDocument();

    const lastNameInput = screen.getByLabelText(/^last name/i) as HTMLInputElement;
    expect(lastNameInput.value).toBe('Doe');
    fireEvent.change(lastNameInput, { target: { value: 'Smith' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/athletes/a1`, {
        method: 'PUT',
        body: expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Smith',
          name: 'Jane Smith',
          photoKey: 'photos/x.jpg',
        }),
      }),
    );
  });

  it('deletes an athlete after confirmation', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (!opts?.method) return Promise.resolve([athlete('a1', 'Jane Doe')]);
      if (opts.method === 'DELETE') return Promise.resolve(undefined);
      throw new Error(`unexpected ${opts?.method} ${path}`);
    });

    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Jane Doe' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/athletes/a1`, {
        method: 'DELETE',
      }),
    );
  });

  it('surfaces a 409 when deleting a referenced athlete', async () => {
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (!opts?.method) return Promise.resolve([athlete('a1', 'Jane Doe')]);
      return Promise.reject(
        new ApiError(409, 'athlete has recorded times — delete or reassign those first'),
      );
    });

    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Jane Doe' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/athlete has recorded times/i)).toBeInTheDocument();
  });

  it('shows a broadcast card preview of the edited athlete in the form', async () => {
    apiFetchMock.mockResolvedValue([athlete('a1', 'Jane Doe', { country: 'USA' })]);

    renderPage(COMP);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Jane Doe' }));
    await screen.findByText('Edit athlete');

    // The preview renders the on-air AthleteCard + name strip with the bold-first
    // / light-last split — the operator sees the broadcast card without a live
    // overlay. Both surfaces render the name, hence getAllByText.
    expect(screen.getByText('Broadcast preview')).toBeInTheDocument();
    const firsts = screen.getAllByText('Jane');
    const lasts = screen.getAllByText('Doe');
    expect(firsts.some((el) => window.getComputedStyle(el).fontWeight === '700')).toBe(true);
    expect(lasts.some((el) => window.getComputedStyle(el).fontWeight === '300')).toBe(true);
  });

  it('uploads a photo and saves the returned photoKey on create', async () => {
    uploadMock.mockResolvedValue('photos/worlds-2026/abc.png');
    apiFetchMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (!opts?.method) return Promise.resolve([]);
      if (opts.method === 'POST')
        return Promise.resolve({ ...(opts.body as object), athleteId: 'a1', compId: COMP });
      throw new Error(`unexpected ${opts?.method} ${path}`);
    });

    renderPage(COMP);
    await screen.findByText(/no athletes yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add athlete/i }));
    await screen.findByText('New athlete');

    const file = new File(['bytes'], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(COMP, file));

    fireEvent.change(screen.getByLabelText(/^first name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^last name/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^short name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^birth date/i), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText(/^country/i), { target: { value: 'USA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/competitions/${COMP}/athletes`, {
        method: 'POST',
        body: expect.objectContaining({ name: 'Jane Doe', photoKey: 'photos/worlds-2026/abc.png' }),
      }),
    );
  });
});
