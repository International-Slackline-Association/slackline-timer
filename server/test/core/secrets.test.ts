import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = sendMock;
  },
  GetParameterCommand: class {
    constructor(public readonly input: { Name: string; WithDecryption: boolean }) {}
  },
}));

import { getPhotoPrivateKey, getReadTokenSecret } from 'core/secrets';

// The per-container cache is module state, so each test uses its own parameter
// name — no cross-test bleed without resetting modules (blocked by the tsconfig
// module target: no dynamic import()).

beforeEach(() => {
  sendMock.mockReset();
});

afterEach(() => {
  delete process.env.READ_TOKEN_SECRET;
  delete process.env.READ_TOKEN_SECRET_PARAM;
  delete process.env.PHOTO_PRIVATE_KEY;
  delete process.env.PHOTO_PRIVATE_KEY_PARAM;
});

describe('getReadTokenSecret / getPhotoPrivateKey', () => {
  it('returns the direct env value without touching SSM (offline harnesses, tests)', async () => {
    process.env.READ_TOKEN_SECRET = 'direct-secret';
    await expect(getReadTokenSecret()).resolves.toBe('direct-secret');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fetches the SecureString by parameter name WithDecryption when only *_PARAM is set', async () => {
    process.env.READ_TOKEN_SECRET_PARAM = '/test/fetch/read-token-secret';
    sendMock.mockResolvedValue({ Parameter: { Value: 'from-ssm' } });
    await expect(getReadTokenSecret()).resolves.toBe('from-ssm');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({
      Name: '/test/fetch/read-token-secret',
      WithDecryption: true,
    });
  });

  it('caches per container: repeated reads make one SSM round trip', async () => {
    process.env.PHOTO_PRIVATE_KEY_PARAM = '/test/cache/photo-private-key';
    sendMock.mockResolvedValue({ Parameter: { Value: 'pem' } });
    await expect(Promise.all([getPhotoPrivateKey(), getPhotoPrivateKey()])).resolves.toEqual([
      'pem',
      'pem',
    ]);
    await expect(getPhotoPrivateKey()).resolves.toBe('pem');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined when neither the value nor the parameter name is configured', async () => {
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    await expect(getPhotoPrivateKey()).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('resolves undefined on a fetch failure and retries on the next read (no poisoned cache)', async () => {
    process.env.READ_TOKEN_SECRET_PARAM = '/test/retry/read-token-secret';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMock
      .mockRejectedValueOnce(new Error('ssm down'))
      .mockResolvedValueOnce({ Parameter: { Value: 'recovered' } });
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    await expect(getReadTokenSecret()).resolves.toBe('recovered');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('treats an empty parameter value as a failure, not an empty secret', async () => {
    process.env.READ_TOKEN_SECRET_PARAM = '/test/empty/read-token-secret';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMock.mockResolvedValue({ Parameter: { Value: '' } });
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});
