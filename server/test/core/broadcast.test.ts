import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock, getAllConnectionsMock, removeConnectionMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getAllConnectionsMock: vi.fn(),
  removeConnectionMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApi: class {
    send = sendMock;
  },
  PostToConnectionCommand: class {
    constructor(public readonly input: { ConnectionId: string; Data: Uint8Array }) {}
  },
  DeleteConnectionCommand: class {
    constructor(public readonly input: { ConnectionId: string }) {}
  },
}));
vi.mock('core/db', () => ({
  db: { getAllConnections: getAllConnectionsMock, removeConnection: removeConnectionMock },
}));

import {
  FANOUT_CONCURRENCY,
  broadcastToSession,
  disconnectSessionReaders,
  publishDbUpdate,
} from 'core/broadcast';

type PostCommand = { input: { ConnectionId: string } };

const gone = () => Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 410 } });
const throttled = () =>
  Object.assign(new Error('throttled'), { $metadata: { httpStatusCode: 429 } });

const connections = (...ids: string[]) =>
  ids.map((connectionId) => ({ sessionId: 's1', connectionId }));

const broadcast = () =>
  broadcastToSession({
    endpoint: 'https://ws.example.com/prod',
    sessionId: 's1',
    payload: { type: 'start' },
    excludeConnectionId: 'sender',
    // Instant, deterministic backoff so the retry tests never actually sleep.
    retry: { sleep: () => Promise.resolve(), random: () => 0 },
  });

beforeEach(() => {
  getAllConnectionsMock.mockResolvedValue(connections('sender', 'conn-1', 'conn-2', 'conn-3'));
  removeConnectionMock.mockResolvedValue(undefined);
  sendMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('broadcastToSession', () => {
  it('delivers to every connection except the sender', async () => {
    const result = await broadcast();

    expect(result).toEqual({ delivered: 3, pruned: 0, failed: 0, retried: 0 });
    const posted = sendMock.mock.calls.map(([cmd]: PostCommand[]) => cmd.input.ConnectionId);
    expect(posted).toEqual(['conn-1', 'conn-2', 'conn-3']);
  });

  it('prunes a stale (410) connection and keeps delivering', async () => {
    sendMock.mockImplementation((cmd: PostCommand) =>
      cmd.input.ConnectionId === 'conn-2' ? Promise.reject(gone()) : Promise.resolve(undefined),
    );

    const result = await broadcast();

    expect(result).toEqual({ delivered: 2, pruned: 1, failed: 0, retried: 0 });
    expect(removeConnectionMock).toHaveBeenCalledTimes(1);
    expect(removeConnectionMock).toHaveBeenCalledWith({
      sessionId: 's1',
      connectionId: 'conn-2',
    });
  });

  it('retries a throttled (429) post and counts it delivered + retried once it succeeds', async () => {
    let attempts = 0;
    sendMock.mockImplementation((cmd: PostCommand) => {
      if (cmd.input.ConnectionId !== 'conn-2') return Promise.resolve(undefined);
      attempts += 1;
      return attempts < 3 ? Promise.reject(throttled()) : Promise.resolve(undefined);
    });

    await expect(broadcast()).resolves.toEqual({
      delivered: 3,
      pruned: 0,
      failed: 0,
      retried: 1,
    });
    expect(attempts).toBe(3); // 1 initial + 2 retries
    expect(removeConnectionMock).not.toHaveBeenCalled();
  });

  it('counts a post still throttled after its retries as failed, not delivered', async () => {
    const posts = new Map<string, number>();
    sendMock.mockImplementation((cmd: PostCommand) => {
      const id = cmd.input.ConnectionId;
      posts.set(id, (posts.get(id) ?? 0) + 1);
      return id === 'conn-2' ? Promise.reject(throttled()) : Promise.resolve(undefined);
    });

    await expect(broadcast()).resolves.toEqual({
      delivered: 2,
      pruned: 0,
      failed: 1,
      retried: 0,
    });
    expect(posts.get('conn-2')).toBe(3); // exhausted MAX_POST_ATTEMPTS
    expect(removeConnectionMock).not.toHaveBeenCalled();
  });

  it('does not retry a non-throttle (410) error — prunes on the first attempt', async () => {
    const posts = new Map<string, number>();
    sendMock.mockImplementation((cmd: PostCommand) => {
      const id = cmd.input.ConnectionId;
      posts.set(id, (posts.get(id) ?? 0) + 1);
      return id === 'conn-2' ? Promise.reject(gone()) : Promise.resolve(undefined);
    });

    await expect(broadcast()).resolves.toEqual({
      delivered: 2,
      pruned: 1,
      failed: 0,
      retried: 0,
    });
    expect(posts.get('conn-2')).toBe(1);
  });

  it('counts a failed prune as failed, not pruned', async () => {
    sendMock.mockImplementation((cmd: PostCommand) =>
      cmd.input.ConnectionId === 'conn-2' ? Promise.reject(gone()) : Promise.resolve(undefined),
    );
    removeConnectionMock.mockRejectedValue(new Error('ddb down'));

    await expect(broadcast()).resolves.toEqual({ delivered: 2, pruned: 0, failed: 1, retried: 0 });
  });

  it('caps posts in flight at the fan-out concurrency limit', async () => {
    const many = ['sender', ...Array.from({ length: 60 }, (_, i) => `conn-${i}`)];
    getAllConnectionsMock.mockResolvedValue(connections(...many));
    let inFlight = 0;
    let peak = 0;
    sendMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    const result = await broadcast();

    expect(result).toEqual({ delivered: 60, pruned: 0, failed: 0, retried: 0 });
    expect(peak).toBeLessThanOrEqual(FANOUT_CONCURRENCY);
  });
});

describe('disconnectSessionReaders', () => {
  const readers = (...rows: [id: string, readOnly: boolean][]) =>
    rows.map(([connectionId, readOnly]) => ({ sessionId: 's1', connectionId, readOnly }));

  const disconnect = () =>
    disconnectSessionReaders({ endpoint: 'https://ws.example.com/prod', sessionId: 's1' });

  it('force-closes only the read-only connections, leaving the operator open', async () => {
    getAllConnectionsMock.mockResolvedValue(
      readers(['operator', false], ['reader-1', true], ['reader-2', true]),
    );

    const result = await disconnect();

    expect(result).toEqual({ disconnected: 2 });
    const closed = sendMock.mock.calls.map(([cmd]: PostCommand[]) => cmd.input.ConnectionId);
    expect(closed).toEqual(['reader-1', 'reader-2']);
  });

  it('is a no-op when the session has no read-only connections', async () => {
    getAllConnectionsMock.mockResolvedValue(readers(['operator', false]));

    await expect(disconnect()).resolves.toEqual({ disconnected: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('treats an already-gone (410) reader as disconnected and prunes its row', async () => {
    getAllConnectionsMock.mockResolvedValue(readers(['reader-1', true], ['reader-2', true]));
    sendMock.mockImplementation((cmd: PostCommand) =>
      cmd.input.ConnectionId === 'reader-1' ? Promise.reject(gone()) : Promise.resolve(undefined),
    );

    await expect(disconnect()).resolves.toEqual({ disconnected: 2 });
    expect(removeConnectionMock).toHaveBeenCalledWith({
      sessionId: 's1',
      connectionId: 'reader-1',
    });
  });
});

describe('publishDbUpdate', () => {
  const OLD_ENDPOINT = process.env.WS_API_ENDPOINT;

  afterEach(() => {
    process.env.WS_API_ENDPOINT = OLD_ENDPOINT;
  });

  const publish = () =>
    publishDbUpdate({ compId: 's1', entity: 'time', action: 'created', id: 't1' });

  it('does nothing (no throw, no broadcast) when WS_API_ENDPOINT is unset', async () => {
    delete process.env.WS_API_ENDPOINT;

    await expect(publish()).resolves.toBeUndefined();
    expect(getAllConnectionsMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('broadcasts the db_update payload to the compId session', async () => {
    process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
    getAllConnectionsMock.mockResolvedValue(connections('conn-1'));

    await expect(publish()).resolves.toBeUndefined();
    expect(getAllConnectionsMock).toHaveBeenCalledWith('s1');
    const [cmd] = sendMock.mock.calls[0] as [{ input: { Data: Uint8Array } }];
    expect(JSON.parse(Buffer.from(cmd.input.Data).toString('utf-8'))).toEqual({
      type: 'db_update',
      sessionId: 's1',
      data: { entity: 'time', action: 'created', id: 't1' },
    });
  });

  it('swallows a broadcast failure — emission is best-effort, the write already persisted', async () => {
    process.env.WS_API_ENDPOINT = 'https://ws.example.com/prod';
    getAllConnectionsMock.mockRejectedValue(new Error('ddb down'));

    await expect(publish()).resolves.toBeUndefined();
  });
});
