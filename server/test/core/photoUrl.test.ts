import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { attachPhotoUrl, createPhotoUrlSigner, photoUrlSignerFromEnv } from 'core/photoUrl';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('createPhotoUrlSigner', () => {
  const sign = createPhotoUrlSigner({
    cdnDomain: 'dphotos.cloudfront.net',
    keyPairId: 'K2JCJMDEHXQW5F',
    privateKeyPem,
  });

  it('signs a canned-policy URL with expiry, key pair id, and signature', () => {
    const expiresAt = Date.parse('2026-07-07T00:00:00Z');
    const url = new URL(sign('photos/worlds-2026/abc123.jpg', expiresAt));

    expect(url.origin).toBe('https://dphotos.cloudfront.net');
    expect(url.pathname).toBe('/photos/worlds-2026/abc123.jpg');
    expect(url.searchParams.get('Key-Pair-Id')).toBe('K2JCJMDEHXQW5F');
    expect(url.searchParams.get('Expires')).toBe(String(Math.round(expiresAt / 1000)));
    expect(url.searchParams.get('Signature')).toBeTruthy();
  });

  it('produces different signatures for different keys/expiries', () => {
    const a = sign('photos/c/a.jpg', Date.parse('2026-07-07T00:00:00Z'));
    const b = sign('photos/c/b.jpg', Date.parse('2026-07-07T00:00:00Z'));
    const c = sign('photos/c/a.jpg', Date.parse('2026-07-08T00:00:00Z'));
    const sig = (u: string) => new URL(u).searchParams.get('Signature');
    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });
});

describe('attachPhotoUrl', () => {
  const sign = createPhotoUrlSigner({
    cdnDomain: 'dphotos.cloudfront.net',
    keyPairId: 'KEYID',
    privateKeyPem,
  });
  const expiresAt = Date.parse('2026-07-07T00:00:00Z');

  it('adds a signed photoUrl when a photoKey is present', () => {
    const jane: { name: string; photoKey?: string } = {
      name: 'Jane',
      photoKey: 'photos/c/x.jpg',
    };
    const out = attachPhotoUrl(jane, sign, expiresAt);
    expect(out.photoUrl).toContain('https://dphotos.cloudfront.net/photos/c/x.jpg?');
    expect(out.photoUrl).toContain('Signature=');
  });

  it('passes entities through untouched without a photoKey or signer', () => {
    const noPhoto: { name: string; photoKey?: string } = { name: 'Jane' };
    expect(attachPhotoUrl(noPhoto, sign, expiresAt)).toEqual({ name: 'Jane' });
    const withKey: { name: string; photoKey?: string } = { name: 'J', photoKey: 'k' };
    expect(attachPhotoUrl(withKey, null, expiresAt)).toEqual({ name: 'J', photoKey: 'k' });
  });
});

describe('photoUrlSignerFromEnv', () => {
  afterEach(() => {
    delete process.env.PHOTO_CDN_DOMAIN;
    delete process.env.PHOTO_KEY_PAIR_ID;
    delete process.env.PHOTO_PRIVATE_KEY;
    delete process.env.IS_OFFLINE;
    delete process.env.PHOTOS_BUCKET;
    delete process.env.S3_PUBLIC_URL;
    delete process.env.S3_ENDPOINT;
  });

  it('returns null when the photo pipeline is not configured', async () => {
    await expect(photoUrlSignerFromEnv()).resolves.toBeNull();
  });

  it('returns a working signer when fully configured', async () => {
    process.env.PHOTO_CDN_DOMAIN = 'dphotos.cloudfront.net';
    process.env.PHOTO_KEY_PAIR_ID = 'KEYID';
    process.env.PHOTO_PRIVATE_KEY = privateKeyPem;
    const signer = await photoUrlSignerFromEnv();
    expect(signer).not.toBeNull();
    expect(signer!('photos/c/x.jpg', Date.parse('2026-07-07T00:00:00Z'))).toContain('Signature=');
  });

  describe('offline (LocalStack S3) signer', () => {
    it('emits the direct path-style object URL, unsigned, ignoring expiry', async () => {
      process.env.IS_OFFLINE = 'true';
      process.env.PHOTOS_BUCKET = 'slackline-timer-v1-photos-local';
      process.env.S3_PUBLIC_URL = 'http://localhost:4566';
      const signer = await photoUrlSignerFromEnv();
      expect(signer).not.toBeNull();
      const url = signer!('photos/demo/abc.jpg', Date.parse('2026-07-07T00:00:00Z'));
      expect(url).toBe('http://localhost:4566/slackline-timer-v1-photos-local/photos/demo/abc.jpg');
    });

    it('falls back to S3_ENDPOINT then the default LocalStack port for the public base', async () => {
      process.env.IS_OFFLINE = 'true';
      process.env.PHOTOS_BUCKET = 'b';
      process.env.S3_ENDPOINT = 'http://127.0.0.1:4566';
      expect((await photoUrlSignerFromEnv())!('k.jpg', 0)).toBe('http://127.0.0.1:4566/b/k.jpg');

      delete process.env.S3_ENDPOINT;
      expect((await photoUrlSignerFromEnv())!('k.jpg', 0)).toBe('http://localhost:4566/b/k.jpg');
    });

    it('prefers the CloudFront signer when a CDN domain is present even offline', async () => {
      process.env.IS_OFFLINE = 'true';
      process.env.PHOTOS_BUCKET = 'b';
      process.env.PHOTO_CDN_DOMAIN = 'dphotos.cloudfront.net';
      process.env.PHOTO_KEY_PAIR_ID = 'KEYID';
      process.env.PHOTO_PRIVATE_KEY = privateKeyPem;
      expect(
        (await photoUrlSignerFromEnv())!('photos/c/x.jpg', Date.parse('2026-07-07T00:00:00Z')),
      ).toContain('Signature=');
    });

    it('returns null offline without a bucket (nothing to point at)', async () => {
      process.env.IS_OFFLINE = 'true';
      await expect(photoUrlSignerFromEnv()).resolves.toBeNull();
    });
  });
});
