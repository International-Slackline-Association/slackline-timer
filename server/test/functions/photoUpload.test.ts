import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';

const { createPresignedPostMock, getCompetitionMock } = vi.hoisted(() => ({
  createPresignedPostMock: vi.fn(),
  getCompetitionMock: vi.fn(),
}));

vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: createPresignedPostMock }));
vi.mock('core/aws/clients', () => ({ s3: {} }));
vi.mock('core/competitionDb', () => ({
  competitionDb: { getCompetition: getCompetitionMock },
}));

import { checksumSha256Base64, main } from '@functions/photoUpload/handler';

const SHA = 'ab'.repeat(32);

type Event = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const event = (
  overrides: {
    role?: AuthContext['role'];
    compId?: string;
    body?: unknown;
  } = {},
): Event =>
  ({
    pathParameters: { compId: overrides.compId ?? 'worlds-2026' },
    requestContext: {
      authorizer: { lambda: { role: overrides.role ?? 'admin', compId: '*' } },
    },
    body: JSON.stringify(overrides.body ?? { contentType: 'image/png', sha256: SHA }),
    isBase64Encoded: false,
  }) as unknown as Event;

const invoke = async (e: Event) => {
  const res = (await main(e, {} as never, () => undefined)) as {
    statusCode: number;
    body: string;
  };
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => {
  process.env.PHOTOS_BUCKET = 'slackline-timer-photos-test';
  getCompetitionMock.mockResolvedValue({ compId: 'worlds-2026' });
  createPresignedPostMock.mockResolvedValue({
    url: 'https://s3.example/slackline-timer-photos-test',
    fields: { key: 'photos/worlds-2026/abc.png', 'Content-Type': 'image/png' },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PHOTOS_BUCKET;
});

describe('photoUpload handler', () => {
  it('mints a presigned POST and returns url + fields + photoKey', async () => {
    const res = await invoke(event());

    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe('https://s3.example/slackline-timer-photos-test');
    expect(res.body.fields).toMatchObject({ key: 'photos/worlds-2026/abc.png' });
    expect(res.body.photoKey).toBe(`photos/worlds-2026/${SHA}.png`);
  });

  it('constrains the POST policy to the content-hashed key, 1 MiB, and the content type', async () => {
    await invoke(event());

    expect(createPresignedPostMock).toHaveBeenCalledTimes(1);
    const arg = createPresignedPostMock.mock.calls[0][1];
    expect(arg.Bucket).toBe('slackline-timer-photos-test');
    expect(arg.Key).toBe(`photos/worlds-2026/${SHA}.png`);
    expect(arg.Conditions).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 1024 * 1024],
        ['eq', '$Content-Type', 'image/png'],
      ]),
    );
    expect(arg.Fields).toMatchObject({ 'Content-Type': 'image/png' });
  });

  it('binds the bytes to the declared hash via S3 checksum fields', async () => {
    await invoke(event());

    const arg = createPresignedPostMock.mock.calls[0][1];
    expect(arg.Fields).toMatchObject({
      'x-amz-checksum-algorithm': 'SHA256',
      'x-amz-checksum-sha256': Buffer.from(SHA, 'hex').toString('base64'),
    });
  });

  it('converts the hex digest to the base64 S3 expects', () => {
    const hex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(checksumSha256Base64(hex)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('rejects an unknown content type before presigning', async () => {
    const res = await invoke(event({ body: { contentType: 'image/gif', sha256: SHA } }));

    expect(res.statusCode).toBe(400);
    expect(createPresignedPostMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed sha256 before presigning', async () => {
    const res = await invoke(event({ body: { contentType: 'image/png', sha256: 'nope' } }));

    expect(res.statusCode).toBe(400);
    expect(createPresignedPostMock).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    const res = await invoke(event({ role: 'reader' }));

    expect(res.statusCode).toBe(403);
    expect(getCompetitionMock).not.toHaveBeenCalled();
  });

  it('404s an unknown competition', async () => {
    getCompetitionMock.mockResolvedValue(undefined);
    const res = await invoke(event({ compId: 'ghost' }));

    expect(res.statusCode).toBe(404);
    expect(createPresignedPostMock).not.toHaveBeenCalled();
  });

  it('503s when the bucket is not configured', async () => {
    delete process.env.PHOTOS_BUCKET;
    const res = await invoke(event());

    expect(res.statusCode).toBe(503);
  });
});
