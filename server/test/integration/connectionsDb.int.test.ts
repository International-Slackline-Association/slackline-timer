import { randomUUID } from 'node:crypto';

import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { main as connectionHandler } from '@functions/connectionHandler/handler';
import { ddb } from 'core/aws/clients';
import { CONNECTION_TTL_SECONDS, db } from 'core/db';

import { clearPartition, ensureTables, isDynamoReachable, TIMER_TABLE } from './helpers';

/**
 * Integration tests for the relay connections table (core/db.ts) against the
 * local DynamoDB container, plus the $connect/$disconnect Lambda driven with
 * real API Gateway event shapes. This is the table the relay handlers and the
 * broadcast fan-out read/write; the unit suites never exercise it.
 *
 * Self-skips when the container is down — see helpers.ts.
 */

const reachable = isDynamoReachable();

const newSession = () => `sess-${randomUUID()}`;

/** Raw read of the reverse map item ($disconnect's only lookup). */
const readMapItem = async (connectionId: string) =>
  (
    await ddb.send(
      new GetCommand({ TableName: TIMER_TABLE, Key: { PK: `CONN#${connectionId}`, SK: 'MAP' } }),
    )
  ).Item;

describe.skipIf(!reachable)('connections db integration', () => {
  beforeAll(async () => {
    await ensureTables();
  });

  const sessions: string[] = [];
  const conns: string[] = [];
  const track = (sessionId: string) => {
    sessions.push(sessionId);
    return sessionId;
  };
  /** Registered so afterEach also clears the connection's CONN# map partition. */
  const newConn = () => {
    const connectionId = `conn-${randomUUID()}`;
    conns.push(connectionId);
    return connectionId;
  };
  afterEach(async () => {
    await Promise.all([
      ...sessions.splice(0).map((s) => clearPartition(TIMER_TABLE, s)),
      ...conns.splice(0).map((c) => clearPartition(TIMER_TABLE, `CONN#${c}`)),
    ]);
  });

  it('adds a connection and reads it back with a 20-minute TTL', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();
    const before = Math.floor(Date.now() / 1000);
    await db.addConnection({ sessionId, connectionId });

    const got = await db.getConnection({ sessionId, connectionId });
    expect(got).toEqual({ sessionId, connectionId, readOnly: false });

    // ddb_ttl should land ~20 min out — read the raw item (getConnection drops it).
    const raw = await ddb.send(
      new GetCommand({ TableName: TIMER_TABLE, Key: { PK: sessionId, SK: connectionId } }),
    );
    const ttl = raw.Item?.ddb_ttl as number;
    expect(ttl).toBeGreaterThanOrEqual(before + CONNECTION_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS + 5);
  });

  it('maps the connection back to its session, so a $disconnect can find it', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();
    const before = Math.floor(Date.now() / 1000);
    await db.addConnection({ sessionId, connectionId });

    expect(await db.getConnectionSession(connectionId)).toBe(sessionId);
    // Same TTL treatment as the forward row: a missed $disconnect can't leak it.
    const ttl = (await readMapItem(connectionId))?.ddb_ttl as number;
    expect(ttl).toBeGreaterThanOrEqual(before + CONNECTION_TTL_SECONDS - 5);

    // The map lives outside every session partition, so the fan-out never sees it.
    expect(await db.getAllConnections(sessionId)).toEqual([
      { sessionId, connectionId, readOnly: false },
    ]);
  });

  it('returns null for an unmapped connection (predating the map, or TTL-expired)', async () => {
    expect(await db.getConnectionSession(newConn())).toBeNull();
  });

  it('heartbeats a live row (preserving readOnly) but never resurrects an absent one', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();

    // A refresh for a row that was never written must NOT create it (the
    // attribute_exists guard) — else a ping could resurrect a pruned connection,
    // and a row born here would carry no readOnly flag (an overlay could inject).
    await expect(db.refreshConnectionTtl({ sessionId, connectionId })).rejects.toThrow();
    expect(await db.getConnection({ sessionId, connectionId })).toBeNull();

    // A refresh for a live row bumps ddb_ttl back to ~now + TTL, and the SET-only
    // update preserves readOnly (a Put would have dropped it).
    await db.addConnection({ sessionId, connectionId, readOnly: true });
    await db.refreshConnectionTtl({ sessionId, connectionId });
    expect(await db.getConnection({ sessionId, connectionId })).toEqual({
      sessionId,
      connectionId,
      readOnly: true,
    });
    const raw = await ddb.send(
      new GetCommand({ TableName: TIMER_TABLE, Key: { PK: sessionId, SK: connectionId } }),
    );
    const ttl = raw.Item?.ddb_ttl as number;
    const now = Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThanOrEqual(now - 5);
    expect(ttl).toBeLessThanOrEqual(now + CONNECTION_TTL_SECONDS + 5);
    // The map item rides the same heartbeat, so it can never expire out from
    // under a socket that is still open (else its $disconnect can't resolve).
    expect((await readMapItem(connectionId))?.ddb_ttl).toBe(ttl);
  });

  it('still heartbeats the forward row when the map item is missing', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();
    await db.addConnection({ sessionId, connectionId });
    await ddb.send(
      new DeleteCommand({ TableName: TIMER_TABLE, Key: { PK: `CONN#${connectionId}`, SK: 'MAP' } }),
    );

    // A socket opened before the map existed must not lose its heartbeat and get
    // evicted from a live room 20 min later.
    await expect(db.refreshConnectionTtl({ sessionId, connectionId })).resolves.toBeUndefined();
    expect(await db.getConnection({ sessionId, connectionId })).not.toBeNull();
    expect(await readMapItem(connectionId)).toBeUndefined();
  });

  it('flags read-only (overlay) connections so the relay can refuse their writes', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();
    await db.addConnection({ sessionId, connectionId, readOnly: true });
    expect(await db.getConnection({ sessionId, connectionId })).toMatchObject({ readOnly: true });
  });

  it('returns null for an absent connection', async () => {
    expect(await db.getConnection({ sessionId: newSession(), connectionId: newConn() })).toBeNull();
  });

  it('lists every connection in a session and isolates by sessionId', async () => {
    const a = track(newSession());
    const b = track(newSession());
    const aConns = [newConn(), newConn(), newConn()];
    await Promise.all(
      aConns.map((connectionId) => db.addConnection({ sessionId: a, connectionId })),
    );
    await db.addConnection({ sessionId: b, connectionId: newConn() });

    const inA = await db.getAllConnections(a);
    expect(inA.map((c) => c.connectionId).sort()).toEqual([...aConns].sort());
    expect(inA.every((c) => c.sessionId === a)).toBe(true);
    expect(await db.getAllConnections(b)).toHaveLength(1);
  });

  it('removes both the connection row and its map item, idempotently', async () => {
    const sessionId = track(newSession());
    const connectionId = newConn();
    await db.addConnection({ sessionId, connectionId });
    await db.removeConnection({ sessionId, connectionId });
    expect(await db.getConnection({ sessionId, connectionId })).toBeNull();
    // The 410 prune (core/broadcast.ts) funnels through here too, so a pruned
    // connection leaves no map item behind either.
    expect(await db.getConnectionSession(connectionId)).toBeNull();
    // deleting a missing row must not throw (stale-connection pruning relies on this)
    await expect(db.removeConnection({ sessionId, connectionId })).resolves.toBeUndefined();
  });
});

/**
 * The relay Lambda driven with the **real** API Gateway event shapes — the
 * regression fence for the never-reaped-connection bug: `$disconnect` carries no
 * `queryStringParameters` (they exist on `$connect` only), so a handler that
 * needs the sessionId from the query string 400s and the row survives until its
 * TTL. `scripts/localWsHarness.mjs` used to pass them on close, which is exactly
 * why local dev never reproduced production.
 */
describe.skipIf(!reachable)('connectionHandler integration (real event shapes)', () => {
  beforeAll(async () => {
    await ensureTables();
  });

  const invoke = async (event: Record<string, unknown>) =>
    (await connectionHandler(event as never, {} as never, () => undefined)) as unknown as {
      statusCode: number;
    };

  const connect = (sessionId: string, connectionId: string, readOnly = false) =>
    invoke({
      requestContext: {
        routeKey: '$connect',
        connectionId,
        authorizer: { readOnly: String(readOnly) },
      },
      queryStringParameters: { sessionId, Authorization: 'token' },
    });

  /** A production `$disconnect`: routeKey + connectionId, nothing else. */
  const disconnect = (connectionId: string) =>
    invoke({ requestContext: { routeKey: '$disconnect', connectionId } });

  it('reaps the connection on a $disconnect that knows only its connectionId', async () => {
    const sessionId = newSession();
    const connectionId = `conn-${randomUUID()}`;
    expect((await connect(sessionId, connectionId, true)).statusCode).toBe(200);
    expect(await db.getAllConnections(sessionId)).toHaveLength(1);

    expect((await disconnect(connectionId)).statusCode).toBe(200);
    expect(await db.getAllConnections(sessionId)).toEqual([]);
    expect(await db.getConnectionSession(connectionId)).toBeNull();
  });

  it('is idempotent on a repeated $disconnect (no mapping left to resolve)', async () => {
    const connectionId = `conn-${randomUUID()}`;
    expect((await disconnect(connectionId)).statusCode).toBe(200);
  });
});
