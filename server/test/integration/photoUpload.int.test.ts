import { createHash, randomUUID } from 'node:crypto';

import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { compPk } from 'core/keys';

import {
  callHandler,
  clearPartition,
  COMPETITION_TABLE,
  ensureTables,
  isDynamoReachable,
} from './helpers';

/**
 * The photoUpload presign against LocalStack S3: the returned POST policy is
 * replayed as the browser would (every field, file part last). The handler and
 * `core/aws/clients` are imported after `IS_OFFLINE` is stubbed so the S3
 * client points at the container. Self-skips when the container is down.
 *
 * LocalStack (3.8) verifies the checksum fields but ignores
 * `content-length-range`, so the size bounds are pinned by the unit test only.
 */

const reachable = isDynamoReachable();

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:4566';
const BUCKET = 'slackline-timer-v1-photos-it';

interface Presign {
  url: string;
  fields: Record<string, string>;
  photoKey: string;
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const post = async ({ url, fields }: Presign, bytes: Uint8Array<ArrayBuffer>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append('file', new Blob([bytes], { type: fields['Content-Type'] }));
  const res = await fetch(url, { method: 'POST', body: form });
  return { status: res.status, text: await res.text() };
};

describe.skipIf(!reachable)('photoUpload presigned POST against LocalStack S3', () => {
  const compId = `it-photo-${randomUUID()}`;
  let presign: (sha256: string) => Promise<Presign>;

  beforeAll(async () => {
    vi.stubEnv('IS_OFFLINE', 'true');
    vi.stubEnv('S3_ENDPOINT', S3_ENDPOINT);
    vi.stubEnv('PHOTOS_BUCKET', BUCKET);
    vi.resetModules();

    await ensureTables();
    const bucketClient = new S3Client({
      endpoint: S3_ENDPOINT,
      region: 'eu-central-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'local', secretAccessKey: 'locallocal' },
    });
    await bucketClient.send(new CreateBucketCommand({ Bucket: BUCKET })).catch((e: unknown) => {
      const name = (e as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
    });

    const { main: competitions } = await import('@functions/competitions/handler');
    const { main: photoUpload } = await import('@functions/photoUpload/handler');
    const created = await callHandler(competitions, {
      routeKey: 'POST /competitions',
      body: { compId, name: 'Photo Worlds', startDate: '2026-06-01', endDate: '2026-06-05' },
    });
    expect(created.statusCode).toBe(201);

    presign = async (sha256) => {
      const res = await callHandler<Presign>(photoUpload, {
        routeKey: 'POST /competitions/{compId}/photo-uploads',
        pathParameters: { compId },
        body: { contentType: 'image/jpeg', sha256 },
      });
      expect(res.statusCode).toBe(200);
      return res.body;
    };
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await clearPartition(COMPETITION_TABLE, compPk(compId));
  });

  it('accepts bytes matching the declared hash', async () => {
    const bytes = new Uint8Array(
      randomUUID()
        .split('')
        .map((c) => c.charCodeAt(0)),
    );
    const res = await post(await presign(sha256Hex(bytes)), bytes);
    expect(res.status, res.text).toBeLessThan(300);
  });

  it('rejects bytes not matching the declared hash', async () => {
    const declared = new Uint8Array([1, 2, 3, 4]);
    const res = await post(await presign(sha256Hex(declared)), new Uint8Array([9, 9, 9, 9]));
    expect(res.status, res.text).toBe(400);
    expect(res.text).toMatch(/checksum/i);
  });
});
