import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';

const {
  getCompetitionMock,
  grantManagerMock,
  revokeManagerMock,
  listManagersMock,
  resolveUserByEmailMock,
  disconnectSessionMock,
} = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  grantManagerMock: vi.fn(),
  revokeManagerMock: vi.fn(),
  listManagersMock: vi.fn(),
  resolveUserByEmailMock: vi.fn(),
  disconnectSessionMock: vi.fn(),
}));

vi.mock('core/competitionDb', () => ({
  competitionDb: {
    getCompetition: getCompetitionMock,
    grantManager: grantManagerMock,
    revokeManager: revokeManagerMock,
    listManagers: listManagersMock,
  },
}));
vi.mock('core/cognitoUsers', () => ({ resolveUserByEmail: resolveUserByEmailMock }));
vi.mock('core/broadcast', () => ({ disconnectSession: disconnectSessionMock }));

import { main } from '@functions/managers/handler';

const COMP = 'worlds-2026';
const admin: AuthContext = { role: 'admin', compId: '*', sub: 'admin-sub', email: 'admin@b.co' };

const event = (routeKey: string, auth: AuthContext, opts: { body?: unknown; sub?: string } = {}) =>
  ({
    routeKey,
    pathParameters: { compId: COMP, ...(opts.sub ? { sub: opts.sub } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    requestContext: { authorizer: { lambda: auth } },
  }) as unknown as APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const invoke = async (e: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>) =>
  (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };

beforeEach(() => {
  process.env.COGNITO_USER_POOL_ID = 'eu-central-1_test';
  process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
  getCompetitionMock.mockResolvedValue({ compId: COMP, name: 'Worlds' });
  disconnectSessionMock.mockResolvedValue({ disconnected: 1 });
});

afterEach(() => {
  delete process.env.WS_API_ENDPOINT;
  vi.clearAllMocks();
});

describe('managers handler', () => {
  it('lists grants for an admin', async () => {
    listManagersMock.mockResolvedValue([{ sub: 's1', email: 'a@b.co' }]);

    const res = await invoke(event('GET /competitions/{compId}/managers', admin));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([{ sub: 's1', email: 'a@b.co' }]);
  });

  it('resolves email→sub and grants access', async () => {
    resolveUserByEmailMock.mockResolvedValue({ sub: 'sub-42', email: 'rider@isa.org' });

    const res = await invoke(
      event('POST /competitions/{compId}/managers', admin, { body: { email: 'rider@isa.org' } }),
    );

    expect(res.statusCode).toBe(201);
    expect(resolveUserByEmailMock).toHaveBeenCalledWith('eu-central-1_test', 'rider@isa.org');
    expect(grantManagerMock).toHaveBeenCalledWith(
      COMP,
      expect.objectContaining({
        sub: 'sub-42',
        email: 'rider@isa.org',
        grantedBySub: 'admin-sub',
        grantedByEmail: 'admin@b.co',
      }),
    );
  });

  it('404s when no ISA user has that email', async () => {
    resolveUserByEmailMock.mockResolvedValue(null);

    const res = await invoke(
      event('POST /competitions/{compId}/managers', admin, { body: { email: 'ghost@isa.org' } }),
    );

    expect(res.statusCode).toBe(404);
    expect(grantManagerMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed email', async () => {
    const res = await invoke(
      event('POST /competitions/{compId}/managers', admin, { body: { email: 'not-an-email' } }),
    );

    expect(res.statusCode).toBe(400);
    expect(resolveUserByEmailMock).not.toHaveBeenCalled();
  });

  it('revokes a grant by sub', async () => {
    const res = await invoke(
      event('DELETE /competitions/{compId}/managers/{sub}', admin, { sub: 'sub-42' }),
    );

    expect(res.statusCode).toBe(204);
    expect(revokeManagerMock).toHaveBeenCalledWith(COMP, 'sub-42');
  });

  it("closes the revoked manager's open sockets on that competition, after the revoke", async () => {
    const res = await invoke(
      event('DELETE /competitions/{compId}/managers/{sub}', admin, { sub: 'sub-42' }),
    );

    expect(res.statusCode).toBe(204);
    expect(disconnectSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://ws.example.com/prod', sessionId: COMP }),
    );
    const { match } = disconnectSessionMock.mock.calls[0][0];
    expect(match({ principal: 'sub-42' })).toBe(true);
    expect(match({ principal: 'other-sub' })).toBe(false);
    expect(match({ principal: undefined })).toBe(false);
    expect(revokeManagerMock.mock.invocationCallOrder[0]).toBeLessThan(
      disconnectSessionMock.mock.invocationCallOrder[0],
    );
  });

  it('still 204s when closing the sockets fails (the revoke persisted)', async () => {
    disconnectSessionMock.mockRejectedValue(new Error('ws down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await invoke(
      event('DELETE /competitions/{compId}/managers/{sub}', admin, { sub: 'sub-42' }),
    );

    expect(res.statusCode).toBe(204);
    expect(revokeManagerMock).toHaveBeenCalledWith(COMP, 'sub-42');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('warns and skips the socket close when WS_API_ENDPOINT is unset', async () => {
    delete process.env.WS_API_ENDPOINT;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await invoke(
      event('DELETE /competitions/{compId}/managers/{sub}', admin, { sub: 'sub-42' }),
    );

    expect(res.statusCode).toBe(204);
    expect(disconnectSessionMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WS_API_ENDPOINT'));
    warn.mockRestore();
  });

  it('rejects a manager (non-admin) with 403 before any work', async () => {
    const manager: AuthContext = { role: 'manager', compId: '', sub: 'm1' };

    const res = await invoke(
      event('POST /competitions/{compId}/managers', manager, { body: { email: 'x@isa.org' } }),
    );

    expect(res.statusCode).toBe(403);
    expect(getCompetitionMock).not.toHaveBeenCalled();
    expect(grantManagerMock).not.toHaveBeenCalled();
  });
});
