import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The HTTP API authorizer's role classification (ADR 0045): timeradmin →
 * global admin, any other verified ISA login → scoped manager (grant checks
 * happen per request in core/http, NOT here), read token → reader. The
 * verifier is mocked; the read-token path runs the real HMAC code.
 */

const { verifyMock, getCompetitionMock, getReadTokenSecretMock } = vi.hoisted(() => {
  process.env.COGNITO_USER_POOL_ID = 'eu-central-1_test';
  process.env.COGNITO_CLIENT_ID = 'client-test';
  process.env.COGNITO_TIMER_GROUP = 'timeradmin';
  return {
    verifyMock: vi.fn(),
    getCompetitionMock: vi.fn(),
    getReadTokenSecretMock: vi.fn(),
  };
});

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: verifyMock }) },
}));
vi.mock('core/competitionDb', () => ({
  competitionDb: { getCompetition: getCompetitionMock },
}));
vi.mock('core/secrets', () => ({ getReadTokenSecret: getReadTokenSecretMock }));

import { main } from '@functions/httpAuthorizer/handler';
import type { AuthContext } from 'core/http';
import { mintReadToken } from 'core/readToken';

const SECRET = 'test-secret';

const invoke = async (authorization?: string) =>
  (await main(
    { headers: authorization ? { authorization } : {} } as never,
    {} as never,
    () => undefined,
  )) as { isAuthorized: boolean; context: AuthContext };

afterEach(() => vi.clearAllMocks());

describe('httpAuthorizer role classification', () => {
  it('classifies a timeradmin as global admin, carrying sub/email', async () => {
    verifyMock.mockResolvedValue({
      sub: 'admin-sub',
      email: 'admin@isa.org',
      'cognito:groups': ['timeradmin', 'other'],
    });

    const res = await invoke('Bearer cognito-token');

    expect(res.isAuthorized).toBe(true);
    expect(res.context).toEqual({
      role: 'admin',
      compId: '*',
      sub: 'admin-sub',
      email: 'admin@isa.org',
    });
  });

  it('classifies any other verified ISA login as a scoped manager (not a deny)', async () => {
    verifyMock.mockResolvedValue({ sub: 'user-sub', email: 'rider@isa.org' });

    const res = await invoke('cognito-token');

    expect(res.isAuthorized).toBe(true);
    expect(res.context).toEqual({
      role: 'manager',
      compId: '',
      sub: 'user-sub',
      email: 'rider@isa.org',
    });
  });

  it('denies when no Authorization header is present', async () => {
    const res = await invoke(undefined);
    expect(res.isAuthorized).toBe(false);
  });

  it('accepts a live read token as a comp-scoped reader', async () => {
    verifyMock.mockRejectedValue(new Error('not a cognito token'));
    getReadTokenSecretMock.mockResolvedValue(SECRET);
    getCompetitionMock.mockResolvedValue({ compId: 'worlds-2026', tokenVersion: 3 });

    const { token } = mintReadToken({
      compId: 'worlds-2026',
      tokenVersion: 3,
      expiresAt: Date.now() + 60_000,
      secret: SECRET,
    });
    const res = await invoke(token);

    expect(res.isAuthorized).toBe(true);
    expect(res.context).toEqual({ role: 'reader', compId: 'worlds-2026' });
  });

  it('denies a read token whose tokenVersion was bumped (revoked)', async () => {
    verifyMock.mockRejectedValue(new Error('not a cognito token'));
    getReadTokenSecretMock.mockResolvedValue(SECRET);
    getCompetitionMock.mockResolvedValue({ compId: 'worlds-2026', tokenVersion: 4 });

    const { token } = mintReadToken({
      compId: 'worlds-2026',
      tokenVersion: 3,
      expiresAt: Date.now() + 60_000,
      secret: SECRET,
    });

    expect((await invoke(token)).isAuthorized).toBe(false);
  });

  it('denies a token that is neither a Cognito IdToken nor a valid read token', async () => {
    verifyMock.mockRejectedValue(new Error('not a cognito token'));
    getReadTokenSecretMock.mockResolvedValue(SECRET);

    expect((await invoke('garbage.garbage.garbage')).isAuthorized).toBe(false);
  });
});
