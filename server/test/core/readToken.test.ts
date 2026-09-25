import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { MAX_READ_TOKEN_TTL_SECONDS, mintReadToken, verifyReadToken } from 'core/readToken';

const NOW = 1_760_000_000_000; // fixed epoch ms
const SECRET = 'test-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

const mint = (overrides: Partial<Parameters<typeof mintReadToken>[0]> = {}) =>
  mintReadToken({
    compId: 'worlds-2026',
    tokenVersion: 1,
    expiresAt: NOW + 3 * DAY_MS,
    secret: SECRET,
    now: NOW,
    ...overrides,
  });

describe('mint + verify round trip', () => {
  it('verifies its own token and returns the claims', () => {
    const { token } = mint();
    const result = verifyReadToken({ token, secret: SECRET, now: NOW });
    expect(result).toEqual({
      ok: true,
      claims: {
        compId: 'worlds-2026',
        role: 'reader',
        tokenVersion: 1,
        iat: Math.floor(NOW / 1000),
        exp: Math.floor((NOW + 3 * DAY_MS) / 1000),
      },
    });
  });

  it('reports the actual expiry (epoch ms)', () => {
    const { expiresAt } = mint();
    expect(expiresAt).toBe(Math.floor((NOW + 3 * DAY_MS) / 1000) * 1000);
  });
});

describe('expiry cap', () => {
  it('clamps the expiry to the 10-day maximum', () => {
    const { token, expiresAt } = mint({ expiresAt: NOW + 90 * DAY_MS });
    expect(expiresAt).toBe(Math.floor((NOW + MAX_READ_TOKEN_TTL_SECONDS * 1000) / 1000) * 1000);
    const result = verifyReadToken({ token, secret: SECRET, now: NOW });
    expect(result.ok).toBe(true);
  });

  it('refuses to mint an already-expired token', () => {
    expect(() => mint({ expiresAt: NOW - 1000 })).toThrow(/expired/);
  });
});

describe('verification failures', () => {
  it('rejects an expired token', () => {
    const { token } = mint();
    const result = verifyReadToken({ token, secret: SECRET, now: NOW + 4 * DAY_MS });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a wrong secret', () => {
    const { token } = mint();
    expect(verifyReadToken({ token, secret: 'other', now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects tampered claims (compId swap)', () => {
    const { token } = mint();
    const [h, c, s] = token.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    claims.compId = 'another-comp';
    const tampered = [h, Buffer.from(JSON.stringify(claims)).toString('base64url'), s].join('.');
    expect(verifyReadToken({ token: tampered, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects malformed input', () => {
    expect(verifyReadToken({ token: 'not-a-jwt', secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyReadToken({ token: 'a.b.c', secret: SECRET, now: NOW }).ok).toBe(false);
  });

  it('rejects a token whose role is not reader', () => {
    // Forge a "writer" token signed with the right secret: signature is valid,
    // claims must still be rejected.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(
      JSON.stringify({
        compId: 'worlds-2026',
        role: 'writer',
        tokenVersion: 1,
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 60,
      }),
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(`${header}.${claims}`)
      .digest()
      .toString('base64url');
    expect(
      verifyReadToken({ token: `${header}.${claims}.${sig}`, secret: SECRET, now: NOW }),
    ).toEqual({ ok: false, reason: 'bad_claims' });
  });
});
