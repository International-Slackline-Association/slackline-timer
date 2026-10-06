import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PHOTO_BYTES as SERVER_MAX_PHOTO_BYTES } from '@functions/photoUpload/handler';

import { MAX_PHOTO_BYTES, uploadPhoto } from '../../scripts/lib/seedClient.mjs';

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
