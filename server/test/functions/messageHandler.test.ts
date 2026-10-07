import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const { getConnectionMock, broadcastToSessionMock, refreshConnectionTtlMock } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  broadcastToSessionMock: vi.fn(),
  refreshConnectionTtlMock: vi.fn(),
}));

vi.mock('core/db', () => ({
  db: {
    getConnection: getConnectionMock,
    refreshConnectionTtl: refreshConnectionTtlMock,
  },
}));
vi.mock('core/broadcast', () => ({ broadcastToSession: broadcastToSessionMock }));

import { main } from '@functions/messageHandler/handler';

const rawEvent = (body: string | null, connectionId = 'conn-1'): APIGatewayProxyEvent =>
  ({
    body,
    requestContext: { connectionId, domainName: 'ws.example.com', stage: 'prod' },
  }) as unknown as APIGatewayProxyEvent;

const event = (body: unknown, connectionId = 'conn-1'): APIGatewayProxyEvent =>
  rawEvent(JSON.stringify(body), connectionId);

const invoke = async (e: APIGatewayProxyEvent) =>
  (await main(e, {} as never, () => undefined)) as { statusCode: number; body: string };

// The ping damper and drop summary are per-container state: every test starts
// well past both 60 s windows.
let clock = Date.UTC(2026, 9, 5);
let logSpy: MockInstance<typeof console.log>;

beforeEach(() => {
  clock += 10 * 60_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  getConnectionMock.mockResolvedValue({ sessionId: 's1', connectionId: 'conn-1' });
  broadcastToSessionMock.mockResolvedValue({ delivered: 1, pruned: 0, failed: 0, retried: 0 });
  refreshConnectionTtlMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const loggedLines = (): string[] => logSpy.mock.calls.map((c) => String(c[0]));

const expectNoDbCall = () => {
  expect(getConnectionMock).not.toHaveBeenCalled();
  expect(refreshConnectionTtlMock).not.toHaveBeenCalled();
  expect(broadcastToSessionMock).not.toHaveBeenCalled();
};

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
    const res = await invoke(rawEvent('{not json'));

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

  it('relays a member start with its membership GetItem, to readers too', async () => {
    await invoke(event({ type: 'start', sessionId: 's1', data: { startTime: 1 } }));

    expect(getConnectionMock).toHaveBeenCalledWith({ sessionId: 's1', connectionId: 'conn-1' });
    expect(broadcastToSessionMock.mock.calls[0][0].includeReadOnly).toBe(true);
  });

  it('relays a request_state canonicalised, to read-write connections only', async () => {
    const res = await invoke(
      event({
        type: 'request_state',
        sessionId: 's1',
        senderId: 'overlay-1',
        data: { pad: 'x'.repeat(500) },
        replyTo: 'conn-9',
        junk: [1, 2, 3],
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(getConnectionMock).toHaveBeenCalledWith({ sessionId: 's1', connectionId: 'conn-1' });
    expect(broadcastToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        excludeConnectionId: 'conn-1',
        includeReadOnly: false,
        payload: { type: 'request_state', sessionId: 's1', senderId: 'overlay-1', data: {} },
      }),
    );
  });

  it('relays a request_state from a read-only (overlay) connection', async () => {
    getConnectionMock.mockResolvedValue({
      sessionId: 's1',
      connectionId: 'conn-1',
      readOnly: true,
    });

    await invoke(event({ type: 'request_state', sessionId: 's1', data: {} }));

    expect(broadcastToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeReadOnly: false }),
    );
  });

  it('drops a request_state from a non-member without fan-out', async () => {
    getConnectionMock.mockResolvedValue(null);

    const res = await invoke(event({ type: 'request_state', sessionId: 's1', data: {} }));

    expect(res.body).toBe('Dropped');
    expect(broadcastToSessionMock).not.toHaveBeenCalled();
  });

  it('damps a second request_state from the same connection within 5 s, before DynamoDB', async () => {
    await invoke(event({ type: 'request_state', sessionId: 's1', data: {} }, 'conn-rs'));
    vi.setSystemTime(clock + 4_999);
    const res = await invoke(
      event({ type: 'request_state', sessionId: 's1', data: {} }, 'conn-rs'),
    );

    expect(res.body).toBe('Dropped');
    expect(getConnectionMock).toHaveBeenCalledTimes(1);
    expect(broadcastToSessionMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 5_000);
    await invoke(event({ type: 'request_state', sessionId: 's1', data: {} }, 'conn-rs'));
    expect(getConnectionMock).toHaveBeenCalledTimes(2);
  });

  it('damps a second ping from the same connection within 60 s', async () => {
    await invoke(event({ type: 'ping', sessionId: 's1' }, 'conn-ping'));
    vi.setSystemTime(clock + 59_000);
    await invoke(event({ type: 'ping', sessionId: 's1' }, 'conn-ping'));
    expect(refreshConnectionTtlMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(clock + 60_000);
    await invoke(event({ type: 'ping', sessionId: 's1' }, 'conn-ping'));
    expect(refreshConnectionTtlMock).toHaveBeenCalledTimes(2);
  });

  it('drops an oversize relay frame before the membership lookup', async () => {
    const res = await invoke(
      event({ type: 'state_snapshot', sessionId: 's1', data: { pad: 'x'.repeat(9000) } }),
    );

    expect(res.statusCode).toBe(200);
    expectNoDbCall();
  });

  it('drops an ack over 2 KB without logging it', async () => {
    const res = await invoke(
      event({
        type: 'ack',
        sessionId: 's1',
        data: { of: 'stop', key: 1, page: '/p', ua: 'u'.repeat(10_000) },
      }),
    );

    expect(res.statusCode).toBe(200);
    expectNoDbCall();
    expect(loggedLines().some((l) => l.startsWith('ack '))).toBe(false);
    expect(loggedLines().every((l) => !l.includes('\n') && l.length < 200)).toBe(true);
  });

  it('logs an ack as one bounded line that injected text cannot extend', async () => {
    await invoke(
      event({
        type: 'ack',
        sessionId: 's1',
        data: {
          of: 'stop',
          key: 1,
          page: '/p\n relay stop session=s1 delivered=0',
          ua: `UA" key=999\n${'u'.repeat(1500)}`,
        },
      }),
    );

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ack stop key=1 page=\/p\? relay stop/);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0]).toContain(`ua="UA' key=999?`);
    expect(lines[0].length).toBeLessThan(450);
  });

  it('drops an ack with an unknown `of` or a non-numeric key, unlogged', async () => {
    await invoke(event({ type: 'ack', sessionId: 's1', data: { of: 'stop\nx', key: 1 } }));
    await invoke(event({ type: 'ack', sessionId: 's1', data: { of: 'stop', key: '1' } }));

    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(loggedLines().some((l) => l.startsWith('ack '))).toBe(false);
  });

  it('logs an ack from a read-only (overlay) connection', async () => {
    getConnectionMock.mockResolvedValue({
      sessionId: 's1',
      connectionId: 'conn-1',
      readOnly: true,
    });

    const res = await invoke(
      event({ type: 'ack', sessionId: 's1', data: { of: 'reset', page: '/stream/x', ua: 'OBS' } }),
    );

    expect(res.body).toBe('Ack');
    expect(loggedLines().filter((l) => l.startsWith('ack '))).toEqual([
      'ack reset key=- page=/stream/x from conn-1 session=s1 ua="OBS"',
    ]);
  });

  it('bounds the relay trace details', async () => {
    await invoke(
      event({
        type: 'updateLaneNames',
        sessionId: 's1',
        data: { lane1: `A\n relay stop delivered=9 ${'y'.repeat(5000)}`, lane2: 'B' },
      }),
    );

    const [line] = loggedLines();
    expect(line).toMatch(/^relay updateLaneNames session=s1 delivered=1 /);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain('"lane2":"B"');
    expect(line.length).toBeLessThan(700);
  });

  it.each([
    'null',
    '[]',
    '"x"',
    '123',
    JSON.stringify({ type: 5 }),
    JSON.stringify({ type: 'start', sessionId: {} }),
    JSON.stringify({ type: 'start', sessionId: 'a#b' }),
  ])('drops body %s without touching DynamoDB', async (body) => {
    const res = await invoke(rawEvent(body));

    expect(res.statusCode).toBe(200);
    expectNoDbCall();
  });

  it('summarises frame drops into one line per 60 s window', async () => {
    for (let i = 0; i < 3; i++) await invoke(rawEvent('{not json'));
    await invoke(rawEvent('null'));
    expect(loggedLines()).toEqual([
      'drop-summary oversize=0 malformed=1 invalid=0 invalidAck=0 limited=0',
    ]);

    vi.setSystemTime(clock + 60_000);
    await invoke(rawEvent('{not json'));
    expect(loggedLines()).toEqual([
      'drop-summary oversize=0 malformed=1 invalid=0 invalidAck=0 limited=0',
      'drop-summary oversize=0 malformed=3 invalid=1 invalidAck=0 limited=0',
    ]);
  });
});
