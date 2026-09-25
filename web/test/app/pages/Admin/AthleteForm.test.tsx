import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real photoUpload validation; stub only the network seams it uses.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { MAX_PHOTO_BYTES } from 'app/api/photoUpload';
import { AthleteForm } from 'app/pages/Admin/AthleteForm';

const COMP = 'worlds-2026';
const fetchMock = vi.fn();

const renderForm = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AthleteForm compId={COMP} open onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/**
 * A picked file. `size` defaults small; `arrayBuffer` is present because the
 * happy path hashes the bytes (crypto.subtle is stubbed below).
 */
const fakeFile = (name: string, type: string, size = 8): File =>
  ({ name, type, size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

const pickPhoto = (file: File) =>
  fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', {
    subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiFetchMock.mockReset();
  fetchMock.mockReset();
});

describe('AthleteForm photo upload', () => {
  it('shows the accepted-formats helper text', () => {
    renderForm();
    expect(screen.getByText(/JPG, PNG or WebP, max \d+ MB/)).toBeInTheDocument();
  });

  it('shows an error and does not enable a photo when the format is unsupported', async () => {
    renderForm();
    pickPhoto(fakeFile('a.gif', 'image/gif'));

    expect(await screen.findByText(/unsupported image type/i)).toBeInTheDocument();
    // No presign / PUT happened — the type guard fired before any network call.
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // The button still offers to upload (no photoKey was set).
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
  });

  it('shows an error when the file is oversize', async () => {
    renderForm();
    pickPhoto(fakeFile('big.png', 'image/png', MAX_PHOTO_BYTES + 1));

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
  });

  it('clears the error and offers to replace the photo after a valid upload', async () => {
    apiFetchMock.mockResolvedValue({
      url: 'https://s3.example/bucket',
      fields: { key: 'photos/worlds-2026/abc.png' },
      photoKey: 'photos/worlds-2026/abc.png',
      expiresIn: 300,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    renderForm();

    // First a bad pick surfaces the Alert…
    pickPhoto(fakeFile('a.gif', 'image/gif'));
    expect(await screen.findByText(/unsupported image type/i)).toBeInTheDocument();

    // …then a valid pick clears it and the button flips to "Replace photo".
    pickPhoto(fakeFile('a.png', 'image/png'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Replace photo' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/unsupported image type/i)).not.toBeInTheDocument();
    // Save stays enabled (not stuck disabled by a lingering upload state).
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });
});
