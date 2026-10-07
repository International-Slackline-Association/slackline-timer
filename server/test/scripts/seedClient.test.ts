import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PHOTO_BYTES as SERVER_MAX_PHOTO_BYTES } from '@functions/photoUpload/handler';

import { MAX_PHOTO_BYTES, makeCall, uploadPhoto } from '../../scripts/lib/seedClient.mjs';

describe('seedClient uploadPhoto', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'seed-photo-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('caps uploads at the presign policy limit', () => {
    expect(MAX_PHOTO_BYTES).toBe(SERVER_MAX_PHOTO_BYTES);
  });

  it('refuses an oversized file before presigning', async () => {
    const file = join(dir, 'big.jpg');
    await writeFile(file, Buffer.alloc(MAX_PHOTO_BYTES + 1));
    const call = vi.fn();

    await expect(uploadPhoto(call, 'worlds-2026', file)).rejects.toThrow(
      /big\.jpg .* over the 1048576 B upload cap/,
    );
    expect(call).not.toHaveBeenCalled();
  });
});

describe('seedClient makeCall', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respond = (status: number, body?: unknown) =>
    new Response(body === undefined ? '' : JSON.stringify(body), { status });

  it('retries a per-route 429 until the write lands', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(429, { message: 'Too Many Requests' }))
      .mockResolvedValueOnce(respond(429, { message: 'Too Many Requests' }))
      .mockResolvedValueOnce(respond(201, { athleteId: 'a1' }));
    vi.stubGlobal('fetch', fetchMock);
    const call = makeCall({ api: 'https://api.test', token: 't', retryDelayMs: 1 });

    await expect(call('POST', '/competitions/c/athletes', { name: 'x' })).resolves.toEqual({
      status: 201,
      body: { athleteId: 'a1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and surfaces the 429', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(respond(429)));
    vi.stubGlobal('fetch', fetchMock);
    const call = makeCall({ api: 'https://api.test', token: 't', retryDelayMs: 1, maxRetries: 2 });

    await expect(call('GET', '/competitions')).resolves.toEqual({ status: 429, body: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(400, { error: 'bad' }));
    vi.stubGlobal('fetch', fetchMock);
    const call = makeCall({ api: 'https://api.test', token: 't', retryDelayMs: 1 });

    await expect(call('POST', '/competitions/c/times', {})).resolves.toEqual({
      status: 400,
      body: { error: 'bad' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
