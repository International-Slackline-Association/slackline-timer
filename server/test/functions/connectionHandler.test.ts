import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addConnectionMock, getConnectionSessionMock, removeConnectionMock } = vi.hoisted(() => ({
  addConnectionMock: vi.fn(),
  getConnectionSessionMock: vi.fn(),
  removeConnectionMock: vi.fn(),
}));

vi.mock('core/db', () => ({
  db: {
    addConnection: addConnectionMock,
    getConnectionSession: getConnectionSessionMock,
    removeConnection: removeConnectionMock,
  },
}));

import { main } from '@functions/connectionHandler/handler';

/**
 * $connect events carry the query string; **$disconnect events do not** — API
 * Gateway attaches queryStringParameters to $connect only. That asymmetry is the
 * whole point of these tests: a $disconnect must resolve its session from the
 * reverse map item, never from the (absent) query string.
 */
const connectEvent = (
  queryStringParameters: Record<string, string> | null,
  authorizer?: Record<string, string>,
): APIGatewayProxyEvent =>
  ({
    queryStringParameters,
    requestContext: { routeKey: '$connect', connectionId: 'conn-1', authorizer },
  }) as unknown as APIGatewayProxyEvent;

const disconnectEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: { routeKey: '$disconnect', connectionId: 'conn-1' },
  }) as unknown as APIGatewayProxyEvent;

const invoke = async (e: APIGatewayProxyEvent) =>
  (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };

beforeEach(() => {
  addConnectionMock.mockResolvedValue(undefined);
  getConnectionSessionMock.mockResolvedValue('s1');
  removeConnectionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('connectionHandler $connect', () => {
  it('registers the connection for the joined session', async () => {
    const res = await invoke(connectEvent({ sessionId: 's1' }));

    expect(res.statusCode).toBe(200);
    expect(addConnectionMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      sessionId: 's1',
      readOnly: false,
    });
  });

  it('flags an overlay (read-token) connection read-only from the authorizer context', async () => {
    await invoke(connectEvent({ sessionId: 's1' }, { readOnly: 'true' }));

    expect(addConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true, sessionId: 's1' }),
    );
  });

  it('400s without a sessionId and writes nothing', async () => {
    const res = await invoke(connectEvent(null));

    expect(res.statusCode).toBe(400);
    expect(addConnectionMock).not.toHaveBeenCalled();
  });

  it('500s when the write fails, so API Gateway refuses the socket', async () => {
    addConnectionMock.mockRejectedValue(new Error('ddb down'));

    const res = await invoke(connectEvent({ sessionId: 's1' }));

    expect(res.statusCode).toBe(500);
  });
});

describe('connectionHandler $disconnect', () => {
  it('resolves the session from the reverse map and reaps the connection', async () => {
    const res = await invoke(disconnectEvent());

    expect(res.statusCode).toBe(200);
    expect(getConnectionSessionMock).toHaveBeenCalledWith('conn-1');
    expect(removeConnectionMock).toHaveBeenCalledWith({ sessionId: 's1', connectionId: 'conn-1' });
  });

  it('never 400s for the missing query string a real $disconnect event has', async () => {
    const res = await invoke(disconnectEvent());

    expect(res.statusCode).not.toBe(400);
  });

  it('returns 200 without deleting when the map item is gone (TTL-expired or duplicate)', async () => {
    getConnectionSessionMock.mockResolvedValue(null);

    const res = await invoke(disconnectEvent());

    expect(res.statusCode).toBe(200);
    expect(removeConnectionMock).not.toHaveBeenCalled();
  });

  it('500s when the lookup or delete fails', async () => {
    getConnectionSessionMock.mockRejectedValue(new Error('ddb down'));

    expect((await invoke(disconnectEvent())).statusCode).toBe(500);

    getConnectionSessionMock.mockResolvedValue('s1');
    removeConnectionMock.mockRejectedValue(new Error('ddb down'));

    expect((await invoke(disconnectEvent())).statusCode).toBe(500);
  });
});

describe('connectionHandler', () => {
  it('throws on an unsupported route', async () => {
    await expect(
      invoke({
        requestContext: { routeKey: '$default', connectionId: 'conn-1' },
      } as unknown as APIGatewayProxyEvent),
    ).rejects.toThrow(/Unsupported route/);
  });
});
