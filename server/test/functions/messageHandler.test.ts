import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock, broadcastToSessionMock, refreshConnectionTtlMock } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  broadcastToSessionMock: vi.fn(),
  refreshConnectionTtlMock: vi.fn(),
}));

vi.mock('core/db', () => ({
  db: { getConnection: getConnectionMock, refreshConnectionTtl: refreshConnectionTtlMock },
}));
vi.mock('core/broadcast', () => ({ broadcastToSession: broadcastToSessionMock }));

import { main } from '@functions/messageHandler/handler';

const event = (body: unknown, connectionId = 'conn-1'): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    requestContext: { connectionId, domainName: 'ws.example.com', stage: 'prod' },
  }) as unknown as APIGatewayProxyEvent;

const invoke = async (e: APIGatewayProxyEvent) =>
  (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };

beforeEach(() => {
  getConnectionMock.mockResolvedValue({ sessionId: 's1', connectionId: 'conn-1' });
  broadcastToSessionMock.mockResolvedValue({ delivered: 1, pruned: 0, failed: 0, retried: 0 });
  refreshConnectionTtlMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('messageHandler', () => {
  it('relays a member message to the session, excluding the sender', async () => {
    const res = await invoke(event({ type: 'start', sessionId: 's1', data: { startTime: 1 } }));

    expect(res.statusCode).toBe(200);
    expect(broadcastToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        excludeConnectionId: 'conn-1',
        payload: { type: 'start', sessionId: 's1', data: { startTime: 1 } },
      }),
    );
  });

  it('heartbeats the connection TTL on a keepalive ping without relaying', async () => {
    const res = await invoke(event({ type: 'ping', sessionId: 's1' }));

    expect(res.statusCode).toBe(200);
    expect(refreshConnectionTtlMock).toHaveBeenCalledWith({
      sessionId: 's1',
      connectionId: 'conn-1',
    });
    // Still swallowed before the membership lookup + fan-out.
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('still keepalives when the TTL heartbeat fails (row already gone)', async () => {
    refreshConnectionTtlMock.mockRejectedValue(new Error('ConditionalCheckFailedException'));

    const res = await invoke(event({ type: 'ping', sessionId: 's1' }));

    expect(res.statusCode).toBe(200);
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('drops a malformed (non-JSON) frame without erroring the invocation', async () => {
    const res = await invoke({
      body: '{not json',
      requestContext: { connectionId: 'conn-1', domainName: 'ws.example.com', stage: 'prod' },
    } as unknown as APIGatewayProxyEvent);

    expect(res.statusCode).toBe(200);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('drops a sender that is not a member of the session', async () => {
    getConnectionMock.mockResolvedValue(undefined);

    const res = await invoke(event({ type: 'start', sessionId: 's1', data: { startTime: 1 } }));

    expect(res.statusCode).toBe(200);
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('refuses to relay from a read-only (overlay) connection', async () => {
    getConnectionMock.mockResolvedValue({
      sessionId: 's1',
      connectionId: 'conn-1',
      readOnly: true,
    });

    const res = await invoke(event({ type: 'start', sessionId: 's1', data: { startTime: 1 } }));

    expect(res.statusCode).toBe(200);
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('relays a request_state from a read-only connection so panels re-broadcast state', async () => {
    getConnectionMock.mockResolvedValue({
      sessionId: 's1',
      connectionId: 'conn-1',
      readOnly: true,
    });

    const res = await invoke(event({ type: 'request_state', sessionId: 's1', data: {} }));

    expect(res.statusCode).toBe(200);
    expect(broadcastToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        excludeConnectionId: 'conn-1',
        payload: { type: 'request_state', sessionId: 's1', data: {} },
      }),
    );
  });
});
