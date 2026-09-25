import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => {
  process.env.SPEEDLINE_TIMER_TABLE = 'slackline-timer-test';
  return { sendMock: vi.fn() };
});

vi.mock('core/aws/clients', () => ({ ddb: { send: sendMock } }));

import { db } from 'core/db';

afterEach(() => {
  vi.clearAllMocks();
});

const CONN_MAP_KEY = { PK: 'CONN#conn-1', SK: 'MAP' };

describe('db.addConnection', () => {
  it('writes the forward row and the reverse map item atomically, sharing one TTL', async () => {
    sendMock.mockResolvedValueOnce({});

    await db.addConnection({ sessionId: 's1', connectionId: 'conn-1', readOnly: true });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const items = sendMock.mock.calls[0][0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put.Item).toMatchObject({ PK: 's1', SK: 'conn-1', readOnly: true });
    // The map item is what a $disconnect (no query string) resolves the session with.
    expect(items[1].Put.Item).toMatchObject({ ...CONN_MAP_KEY, sessionId: 's1' });
    expect(items[1].Put.Item.ddb_ttl).toBe(items[0].Put.Item.ddb_ttl);
  });
});

describe('db.getConnectionSession', () => {
  it('reads the session off the reverse map item', async () => {
    sendMock.mockResolvedValueOnce({ Item: { ...CONN_MAP_KEY, sessionId: 's1' } });

    expect(await db.getConnectionSession('conn-1')).toBe('s1');
    expect(sendMock.mock.calls[0][0].input.Key).toEqual(CONN_MAP_KEY);
  });

  it('returns null when the map item is gone, so a $disconnect can degrade to the TTL', async () => {
    sendMock.mockResolvedValueOnce({});

    expect(await db.getConnectionSession('conn-1')).toBeNull();
  });
});

describe('db.removeConnection', () => {
  it('deletes both the forward row and the reverse map item', async () => {
    sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await db.removeConnection({ sessionId: 's1', connectionId: 'conn-1' });

    expect(sendMock.mock.calls.map((c) => c[0].input.Key)).toEqual([
      { PK: 's1', SK: 'conn-1' },
      CONN_MAP_KEY,
    ]);
  });
});

describe('db.refreshConnectionTtl', () => {
  it('heartbeats both rows, guarded so neither is ever resurrected', async () => {
    sendMock.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await db.refreshConnectionTtl({ sessionId: 's1', connectionId: 'conn-1' });

    const inputs = sendMock.mock.calls.map((c) => c[0].input);
    expect(inputs.map((i) => i.Key)).toEqual([{ PK: 's1', SK: 'conn-1' }, CONN_MAP_KEY]);
    expect(inputs.every((i) => i.ConditionExpression === 'attribute_exists(PK)')).toBe(true);
  });

  it('surfaces a failed forward refresh but tolerates a missing map item', async () => {
    // Map item absent (a socket predating the mapping): the forward row is what
    // the fan-out reads, so its heartbeat must still count as success.
    sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('condition failed'));
    await expect(
      db.refreshConnectionTtl({ sessionId: 's1', connectionId: 'conn-1' }),
    ).resolves.toBeUndefined();

    sendMock.mockRejectedValueOnce(new Error('condition failed')).mockResolvedValueOnce({});
    await expect(
      db.refreshConnectionTtl({ sessionId: 's1', connectionId: 'conn-1' }),
    ).rejects.toThrow('condition failed');
  });
});

describe('db.getAllConnections', () => {
  it('returns a single page in one query, surfacing the readOnly flag', async () => {
    sendMock.mockResolvedValueOnce({
      Items: [
        { PK: 's1', SK: 'conn-1' },
        { PK: 's1', SK: 'conn-2', readOnly: true },
      ],
    });

    const all = await db.getAllConnections('s1');

    expect(all).toEqual([
      { sessionId: 's1', connectionId: 'conn-1', readOnly: false },
      { sessionId: 's1', connectionId: 'conn-2', readOnly: true },
    ]);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('follows LastEvaluatedKey across pages so no recipient is dropped', async () => {
    sendMock
      .mockResolvedValueOnce({
        Items: [{ PK: 's1', SK: 'conn-1' }],
        LastEvaluatedKey: { PK: 's1', SK: 'conn-1' },
      })
      .mockResolvedValueOnce({ Items: [{ PK: 's1', SK: 'conn-2' }] });

    const all = await db.getAllConnections('s1');

    expect(all).toEqual([
      { sessionId: 's1', connectionId: 'conn-1', readOnly: false },
      { sessionId: 's1', connectionId: 'conn-2', readOnly: false },
    ]);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 's1', SK: 'conn-1' });
  });
});
