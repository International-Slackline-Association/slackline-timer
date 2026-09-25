import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';

const {
  getCompetitionMock,
  grantManagerMock,
  revokeManagerMock,
  listManagersMock,
  resolveUserByEmailMock,
} = vi.hoisted(() => ({
  getCompetitionMock: vi.fn(),
  grantManagerMock: vi.fn(),
  revokeManagerMock: vi.fn(),
  listManagersMock: vi.fn(),
  resolveUserByEmailMock: vi.fn(),
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
  getCompetitionMock.mockResolvedValue({ compId: COMP, name: 'Worlds' });
});

afterEach(() => {
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
