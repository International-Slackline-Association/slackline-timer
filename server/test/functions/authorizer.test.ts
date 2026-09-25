import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The WS $connect authorizer (ADR 0045): a timeradmin may join any real
 * competition; any other ISA login is a scoped manager and may only join a
 * competition they hold a grant on — an ungranted manager can't even open the
 * socket. Readers stay pinned to their token's compId.
 */

const { verifyMock, getCompetitionMock, getManagerGrantMock, getReadTokenSecretMock } = vi.hoisted(
  () => {
    process.env.COGNITO_USER_POOL_ID = 'eu-central-1_test';
    process.env.COGNITO_CLIENT_ID = 'client-test';
    process.env.COGNITO_TIMER_GROUP = 'timeradmin';
    return {
      verifyMock: vi.fn(),
      getCompetitionMock: vi.fn(),
      getManagerGrantMock: vi.fn(),
      getReadTokenSecretMock: vi.fn(),
    };
  },
);

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify: verifyMock }) },
}));
vi.mock('core/competitionDb', () => ({
  competitionDb: { getCompetition: getCompetitionMock, getManagerGrant: getManagerGrantMock },
}));
vi.mock('core/secrets', () => ({ getReadTokenSecret: getReadTokenSecretMock }));

import { main } from '@functions/authorizer/handler';
import { mintReadToken } from 'core/readToken';

const SECRET = 'test-secret';
const COMP = 'worlds-2026';

const invoke = async (params: Record<string, string>) =>
  (await main(
    { queryStringParameters: params, methodArn: 'arn:aws:execute-api:local/$connect' } as never,
    {} as never,
    () => undefined,
  )) as {
    principalId: string;
    policyDocument: { Statement: { Effect: string }[] };
    context?: Record<string, string>;
  };

const effectOf = (res: Awaited<ReturnType<typeof invoke>>) =>
  res.policyDocument.Statement[0].Effect;

afterEach(() => vi.clearAllMocks());

describe('WS $connect authorizer', () => {
  it('lets a timeradmin join any real competition without a grant check', async () => {
    verifyMock.mockResolvedValue({ sub: 'admin-sub', 'cognito:groups': ['timeradmin'] });
    getCompetitionMock.mockResolvedValue({ compId: COMP, tokenVersion: 1 });

    const res = await invoke({ Authorization: 'cognito-token', sessionId: COMP });

    expect(effectOf(res)).toBe('Allow');
    expect(res.context).toEqual({ readOnly: 'false' });
    expect(getManagerGrantMock).not.toHaveBeenCalled();
  });

  it('denies an operator joining the literal "default" fallback session', async () => {
    verifyMock.mockResolvedValue({ sub: 'admin-sub', 'cognito:groups': ['timeradmin'] });

    const res = await invoke({ Authorization: 'cognito-token', sessionId: 'default' });

    expect(effectOf(res)).toBe('Deny');
  });

  it('lets a granted manager join their competition as a full operator', async () => {
    verifyMock.mockResolvedValue({ sub: 'mgr-sub' });
    getCompetitionMock.mockResolvedValue({ compId: COMP, tokenVersion: 1 });
    getManagerGrantMock.mockResolvedValue({ sub: 'mgr-sub', email: 'rider@isa.org' });

    const res = await invoke({ Authorization: 'cognito-token', sessionId: COMP });

    expect(effectOf(res)).toBe('Allow');
    expect(res.context).toEqual({ readOnly: 'false' });
    expect(getManagerGrantMock).toHaveBeenCalledWith(COMP, 'mgr-sub');
  });

  it('denies an ungranted manager — the socket never opens', async () => {
    verifyMock.mockResolvedValue({ sub: 'mgr-sub' });
    getCompetitionMock.mockResolvedValue({ compId: COMP, tokenVersion: 1 });
    getManagerGrantMock.mockResolvedValue(null);

    const res = await invoke({ Authorization: 'cognito-token', sessionId: COMP });

    expect(effectOf(res)).toBe('Deny');
  });

  it('denies a manager joining a competition that does not exist', async () => {
    verifyMock.mockResolvedValue({ sub: 'mgr-sub' });
    getCompetitionMock.mockResolvedValue(null);

    const res = await invoke({ Authorization: 'cognito-token', sessionId: 'ghost-comp' });

    expect(effectOf(res)).toBe('Deny');
    expect(getManagerGrantMock).not.toHaveBeenCalled();
  });

  it('admits a read token only into its own session, flagged read-only', async () => {
    verifyMock.mockRejectedValue(new Error('not a cognito token'));
    getReadTokenSecretMock.mockResolvedValue(SECRET);
    getCompetitionMock.mockResolvedValue({ compId: COMP, tokenVersion: 3 });

    const { token } = mintReadToken({
      compId: COMP,
      tokenVersion: 3,
      expiresAt: Date.now() + 60_000,
      secret: SECRET,
    });

    const ownSession = await invoke({ Authorization: token, sessionId: COMP });
    expect(effectOf(ownSession)).toBe('Allow');
    expect(ownSession.context).toEqual({ readOnly: 'true' });

    const foreignSession = await invoke({ Authorization: token, sessionId: 'other-comp' });
    expect(effectOf(foreignSession)).toBe('Deny');
  });
});
