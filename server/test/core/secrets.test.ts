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

const DIRECT_SECRET = 'direct-read-token-secret-0123456789';
const SSM_SECRET = 'ssm-read-token-secret-0123456789abc';
const RECOVERED_SECRET = 'recovered-read-token-secret-012345';

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
    process.env.READ_TOKEN_SECRET = DIRECT_SECRET;
    await expect(getReadTokenSecret()).resolves.toBe(DIRECT_SECRET);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('fetches the SecureString by parameter name WithDecryption when only *_PARAM is set', async () => {
    process.env.READ_TOKEN_SECRET_PARAM = '/test/fetch/read-token-secret';
    sendMock.mockResolvedValue({ Parameter: { Value: SSM_SECRET } });
    await expect(getReadTokenSecret()).resolves.toBe(SSM_SECRET);
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
      .mockResolvedValueOnce({ Parameter: { Value: RECOVERED_SECRET } });
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    await expect(getReadTokenSecret()).resolves.toBe(RECOVERED_SECRET);
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

describe('getReadTokenSecret minimum length', () => {
  it('rejects a secret under 32 UTF-8 bytes, logging once per container without the value', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.READ_TOKEN_SECRET = 'short-secret';
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    process.env.READ_TOKEN_SECRET = 'x'.repeat(31);
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('too short');
    expect(logged).not.toContain('short-secret');
    errorSpy.mockRestore();
  });

  it('measures bytes, not characters', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.READ_TOKEN_SECRET = 'é'.repeat(16);
    await expect(getReadTokenSecret()).resolves.toBe('é'.repeat(16));
    process.env.READ_TOKEN_SECRET = 'é'.repeat(15);
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it('rejects a short SSM value too', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.READ_TOKEN_SECRET_PARAM = '/test/short/read-token-secret';
    sendMock.mockResolvedValue({ Parameter: { Value: 'too-short' } });
    await expect(getReadTokenSecret()).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it('does not apply to the photo private key', async () => {
    process.env.PHOTO_PRIVATE_KEY = 'pem';
    await expect(getPhotoPrivateKey()).resolves.toBe('pem');
  });
});
