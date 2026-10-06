import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, resizeImageMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  resizeImageMock: vi.fn(),
}));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});
vi.mock('app/util/resizeImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/util/resizeImage')>();
  return { ...actual, resizeImage: resizeImageMock };
});

import { MAX_SOURCE_BYTES, acceptedFormatsHint, uploadAthletePhoto } from 'app/api/photoUpload';
import { ImageTooLargeError } from 'app/util/resizeImage';

const fetchMock = vi.fn();

// A 32-byte digest of 0xab → 64-char lowercase hex 'ab' repeated.
const DIGEST = new Uint8Array(32).fill(0xab).buffer;
const EXPECTED_SHA = 'ab'.repeat(32);

/** Minimal File stand-in (jsdom Blob.arrayBuffer is flaky; we mock the digest). */
const fakeFile = (type: string, size = 8): File =>
  ({ type, size, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

const RESIZED_BYTES = new ArrayBuffer(4);
const resized = new Blob(['jpeg'], { type: 'image/jpeg' });
resized.arrayBuffer = async () => RESIZED_BYTES;

beforeEach(() => {
  resizeImageMock.mockResolvedValue(resized);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(DIGEST) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiFetchMock.mockReset();
  fetchMock.mockReset();
  resizeImageMock.mockReset();
});

describe('uploadAthletePhoto', () => {
  it('resizes, hashes the JPEG, presigns, POSTs the policy form to S3, returns the photoKey', async () => {
    apiFetchMock.mockResolvedValue({
      url: 'https://s3.example/bucket',
      fields: {
        key: 'photos/worlds-2026/abc.jpg',
        'Content-Type': 'image/jpeg',
        'x-amz-checksum-algorithm': 'SHA256',
        'x-amz-checksum-sha256': 'q6ur',
        policy: 'p',
      },
      photoKey: 'photos/worlds-2026/abc.jpg',
      expiresIn: 300,
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const file = fakeFile('image/png');
    const key = await uploadAthletePhoto('worlds-2026', file);

    expect(key).toBe('photos/worlds-2026/abc.jpg');
    expect(resizeImageMock).toHaveBeenCalledWith(file, expect.anything());
    expect(crypto.subtle.digest).toHaveBeenCalledWith('SHA-256', RESIZED_BYTES);
    expect(apiFetchMock).toHaveBeenCalledWith('/competitions/worlds-2026/photo-uploads', {
      method: 'POST',
      body: { contentType: 'image/jpeg', sha256: EXPECTED_SHA },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s3.example/bucket');
    expect(init.method).toBe('POST');
    // No Authorization header on the direct-to-S3 POST.
    expect(init.headers).toBeUndefined();
    // FormData carries every policy field verbatim, then the file part (last).
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('key')).toBe('photos/worlds-2026/abc.jpg');
    expect(form.get('Content-Type')).toBe('image/jpeg');
    expect(form.get('x-amz-checksum-algorithm')).toBe('SHA256');
    expect(form.get('x-amz-checksum-sha256')).toBe('q6ur');
    expect(form.get('policy')).toBe('p');
    expect((form.get('file') as Blob).size).toBe(resized.size);
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

  it('rejects a source file over 30 MB before decoding it', async () => {
    await expect(
      uploadAthletePhoto('c1', fakeFile('image/png', MAX_SOURCE_BYTES + 1)),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: expect.stringMatching(/too large/i),
    });
    expect(resizeImageMock).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('accepts a source file above the 1 MiB upload cap (it is resized)', async () => {
    apiFetchMock.mockResolvedValue({ url: 'u', fields: {}, photoKey: 'k', expiresIn: 300 });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(uploadAthletePhoto('c1', fakeFile('image/jpeg', 12 * 1024 * 1024))).resolves.toBe(
      'k',
    );
  });

  it('turns an undecodable image into a 400 before any network call', async () => {
    resizeImageMock.mockRejectedValue(new DOMException('bad', 'InvalidStateError'));

    await expect(uploadAthletePhoto('c1', fakeFile('image/jpeg'))).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: expect.stringMatching(/could not read/i),
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an image that cannot be shrunk under the cap', async () => {
    resizeImageMock.mockRejectedValue(new ImageTooLargeError());

    await expect(uploadAthletePhoto('c1', fakeFile('image/jpeg'))).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: expect.stringMatching(/after resizing/i),
    });
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
