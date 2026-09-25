import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext } from 'core/http';

const { bumpTokenVersionMock, disconnectSessionReadersMock } = vi.hoisted(() => ({
  bumpTokenVersionMock: vi.fn(),
  disconnectSessionReadersMock: vi.fn(),
}));

vi.mock('core/competitionDb', () => ({
  competitionDb: { bumpTokenVersion: bumpTokenVersionMock },
}));
vi.mock('core/broadcast', () => ({
  publishDbUpdate: vi.fn(),
  disconnectSessionReaders: disconnectSessionReadersMock,
}));

import { main } from '@functions/competitions/handler';

const COMP = 'worlds-2026';

const revokeEvent = (auth: AuthContext) =>
  ({
    routeKey: 'POST /competitions/{compId}/revoke-read-tokens',
    pathParameters: { compId: COMP },
    requestContext: { authorizer: { lambda: auth } },
  }) as unknown as APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>;

const invoke = async (e: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthContext>) =>
  (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };

beforeEach(() => {
  process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
  bumpTokenVersionMock.mockResolvedValue(2);
  disconnectSessionReadersMock.mockResolvedValue({ disconnected: 3 });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.WS_API_ENDPOINT;
});

describe('competitions revoke-read-tokens', () => {
  it('bumps the version and force-closes the session readers (instant cut-off)', async () => {
    const res = await invoke(revokeEvent({ role: 'admin', compId: '*' }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ revoked: true });
    expect(bumpTokenVersionMock).toHaveBeenCalledWith(COMP);
    expect(disconnectSessionReadersMock).toHaveBeenCalledWith({
      endpoint: 'https://ws.example.com/prod',
      sessionId: COMP,
    });
  });

  it('still succeeds when force-closing the sockets fails (version bump persisted)', async () => {
    disconnectSessionReadersMock.mockRejectedValue(new Error('ws down'));

    const res = await invoke(revokeEvent({ role: 'admin', compId: '*' }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ revoked: true });
  });

  it('rejects a reader (non-admin) with 403 before touching anything', async () => {
    const res = await invoke(revokeEvent({ role: 'reader', compId: COMP }));

    expect(res.statusCode).toBe(403);
    expect(bumpTokenVersionMock).not.toHaveBeenCalled();
    expect(disconnectSessionReadersMock).not.toHaveBeenCalled();
  });
});
