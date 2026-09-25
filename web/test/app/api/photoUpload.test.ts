import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { MAX_PHOTO_BYTES, acceptedFormatsHint, uploadAthletePhoto } from 'app/api/photoUpload';

const fetchMock = vi.fn();

// A 32-byte digest of 0xab → 64-char lowercase hex 'ab' repeated.
const DIGEST = new Uint8Array(32).fill(0xab).buffer;
const EXPECTED_SHA = 'ab'.repeat(32);

/** Minimal File stand-in (jsdom Blob.arrayBuffer is flaky; we mock the digest). */
const fakeFile = (type: string, size = 8): File =>
  ({ type, size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(DIGEST) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiFetchMock.mockReset();
  fetchMock.mockReset();
});

describe('uploadAthletePhoto', () => {
  it('hashes the file, presigns, POSTs the policy form to S3, and returns the photoKey', async () => {
    apiFetchMock.mockResolvedValue({
      url: 'https://s3.example/bucket',
      fields: { key: 'photos/worlds-2026/abc.png', 'Content-Type': 'image/png', policy: 'p' },
      photoKey: 'photos/worlds-2026/abc.png',
      expiresIn: 300,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const file = fakeFile('image/png');
    const key = await uploadAthletePhoto('worlds-2026', file);

    expect(key).toBe('photos/worlds-2026/abc.png');
    expect(apiFetchMock).toHaveBeenCalledWith('/competitions/worlds-2026/photo-uploads', {
      method: 'POST',
      body: { contentType: 'image/png', sha256: EXPECTED_SHA },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s3.example/bucket');
    expect(init.method).toBe('POST');
    // No Authorization header on the direct-to-S3 POST.
    expect(init.headers).toBeUndefined();
    // FormData carries the policy fields then the file part (file must be last).
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('key')).toBe('photos/worlds-2026/abc.png');
    expect(form.get('Content-Type')).toBe('image/png');
    expect(form.get('policy')).toBe('p');
    expect(form.has('file')).toBe(true);
    expect([...form.keys()].at(-1)).toBe('file');
  });

  it('rejects an unsupported image type before any network call, naming accepted types', async () => {
    await expect(uploadAthletePhoto('c1', fakeFile('image/gif'))).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: expect.stringContaining('JPG'),
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversize file before any network call', async () => {
    await expect(
      uploadAthletePhoto('c1', fakeFile('image/png', MAX_PHOTO_BYTES + 1)),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: expect.stringMatching(/too large/i),
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws an ApiError carrying the status when the S3 POST fails', async () => {
    apiFetchMock.mockResolvedValue({
      url: 'https://s3.example/bucket',
      fields: { key: 'photos/c1/x.jpg' },
      photoKey: 'photos/c1/x.jpg',
      expiresIn: 300,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(uploadAthletePhoto('c1', fakeFile('image/jpeg'))).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
    });
  });
});

describe('acceptedFormatsHint', () => {
  it('lists the accepted formats and the size cap', () => {
    const hint = acceptedFormatsHint();
    expect(hint).toContain('JPG');
    expect(hint).toContain('PNG');
    expect(hint).toContain('WebP');
    expect(hint).toMatch(/max \d+ MB/);
  });
});
