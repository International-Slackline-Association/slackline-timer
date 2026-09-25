import {
  ApiGatewayManagementApi,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

import { db } from './db';

/**
 * Max PostToConnection/DeleteConnection posts in flight per fan-out. Firing an
 * entire room at once bursts straight into the WS stage's default-route throttle
 * (ADR 0031 §2) and exhausts the SDK socket pool — the HWC 2026 reconnect storm
 * tripped exactly this (failed=59/67 for ~6s). Capping the burst draws the room
 * down at a steady rate the throttle can absorb; the 429 retry below recovers the
 * few that still bounce. 25 sits well under both the 50-socket SDK default and,
 * ×(reserved-concurrency broadcasters), the 2000 rps stage bucket.
 */
export const FANOUT_CONCURRENCY = 25;

// Per-post retry envelope. Kept small so a fully-throttled room can't push the
// fan-out past the caller's Lambda timeout (messageHandler 10s): worst case per
// post is MAX_POST_ATTEMPTS-1 backoffs ≤ RETRY_CAP_MS each (~0.35s total), and
// the concurrency cap bounds how many run at once.
const MAX_POST_ATTEMPTS = 3;
const RETRY_BASE_MS = 100;
const RETRY_CAP_MS = 500;

const httpStatus = (e: unknown): number | undefined =>
  (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

/** Half-jittered exponential backoff, so a room-wide throttle doesn't retry in
 * lockstep (the same jitter shape as the client reconnect backoff). */
const backoffMs = (attempt: number, random: () => number): number => {
  const cap = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS);
  return cap / 2 + random() * (cap / 2);
};

/**
 * One ApiGatewayManagementApi client per endpoint, reused across invocations
 * (module scope survives a warm Lambda container). Constructing a fresh client
 * per fan-out gave every span a brand-new keep-alive agent, so a warm invocation
 * still opened cold sockets and re-resolved the @connections hostname from
 * scratch. Under a reconnect storm the burst of parallel `getaddrinfo` lookups
 * saturated the resolver and threw `EBUSY` (errno -16) — which `sendWithRetry`
 * drops as non-retryable (it's not a 429/5xx), silently losing the relay (HWC
 * 2026: 24.6k `getaddrinfo EBUSY` → 24.6k dropped posts in one 30-min burst).
 * Caching the client keeps its socket pool + resolved DNS warm for the whole
 * container lifetime (with AWS_NODEJS_CONNECTION_REUSE_ENABLED=1 keep-alive), so
 * steady-state fan-outs reuse sockets and issue ~no fresh lookups. Keyed by
 * endpoint so the prod callback URL and the offline harness URL stay distinct.
 * `maxAttempts: 1` disables the SDK's own retry so `sendWithRetry` remains the
 * single delivery authority (see its docblock).
 */
const clientsByEndpoint = new Map<string, ApiGatewayManagementApi>();
const apiClient = (endpoint: string): ApiGatewayManagementApi => {
  let client = clientsByEndpoint.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApi({ endpoint, maxAttempts: 1 });
    clientsByEndpoint.set(endpoint, client);
  }
  return client;
};

/** Injectable retry timing — real timers in prod, overridable in tests so the
 * suite never actually sleeps. */
interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}
const defaultRetryDeps = (over?: Partial<RetryDeps>): RetryDeps => ({
  sleep: over?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  random: over?.random ?? Math.random,
});

/**
 * Send with bounded retry on throttling (429) and transient server errors (5xx),
 * returning the number of attempts made (1 = first-try success). Everything else
 * — a 410 (gone), any other 4xx, a transport error, or retries exhausted — is
 * rethrown for the caller to classify (prune vs. report as failed). The SDK's own
 * (opaque, compounding) retry is disabled at the client (`maxAttempts: 1`) so this
 * is the single authority and the returned delivered/failed counts are the true
 * delivery outcome, not a pre-retry snapshot.
 */
const sendWithRetry = async (send: () => Promise<unknown>, deps: RetryDeps): Promise<number> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await send();
      return attempt;
    } catch (e) {
      const status = httpStatus(e);
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (retryable && attempt < MAX_POST_ATTEMPTS) {
        await deps.sleep(backoffMs(attempt, deps.random));
        continue;
      }
      throw e;
    }
  }
};

/**
 * Run an async op over items at bounded concurrency, never rejecting — mirrors
 * `Promise.allSettled`'s result shape and index order. A worker pool of
 * `min(limit, items.length)` drains a shared cursor, so at most `limit` ops are
 * ever in flight regardless of room size.
 */
const mapSettled = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/**
 * The relay fan-out, extracted from the messageHandler Lambda so write
 * Lambdas can publish too: deliver a payload to every connection of a
 * session, excluding the sender, pruning stale (HTTP 410) connections. Posts run
 * at `FANOUT_CONCURRENCY` with a 429/5xx retry (see the tuning notes above), and
 * the returned counts are the true outcome — `retried` surfaces throttle pressure
 * before it becomes `failed`.
 */
export const broadcastToSession = async (params: {
  /** WS management endpoint: https://{api-id}.execute-api.{region}.amazonaws.com/{stage} */
  endpoint: string;
  sessionId: string;
  payload: unknown;
  excludeConnectionId?: string;
  /** Test seam: override the retry backoff timers/jitter. Prod uses real timers. */
  retry?: Partial<RetryDeps>;
}): Promise<{ delivered: number; pruned: number; failed: number; retried: number }> => {
  const deps = defaultRetryDeps(params.retry);
  const api = apiClient(params.endpoint);
  const data = Buffer.from(JSON.stringify(params.payload), 'utf-8');

  const connections = (await db.getAllConnections(params.sessionId)).filter(
    (c) => c.connectionId !== params.excludeConnectionId,
  );

  const results = await mapSettled(connections, FANOUT_CONCURRENCY, async (conn) => {
    try {
      const attempts = await sendWithRetry(
        () =>
          api.send(new PostToConnectionCommand({ ConnectionId: conn.connectionId, Data: data })),
        deps,
      );
      return { kind: 'delivered' as const, attempts };
    } catch (e) {
      if (httpStatus(e) === 410) {
        await db.removeConnection({ sessionId: params.sessionId, connectionId: conn.connectionId });
        return { kind: 'pruned' as const, attempts: 1 };
      }
      throw e;
    }
  });

  let delivered = 0;
  let pruned = 0;
  let failed = 0;
  let retried = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      failed += 1;
      console.error('post to connection failed:', result.reason);
    } else if (result.value.kind === 'pruned') {
      pruned += 1;
    } else {
      delivered += 1;
      if (result.value.attempts > 1) retried += 1;
    }
  }

  return { delivered, pruned, failed, retried };
};

/**
 * Force-close every read-only (overlay) connection of a session — the WS side
 * of read-token revocation. Bumping `tokenVersion` only blocks the *next*
 * `$connect`; an already-open overlay keeps receiving the live feed until its
 * socket drops (up to the connection-row TTL). So on revoke we also drop the
 * open sockets, matching the documented "revokes instantly" (ADR 0003 / 0026).
 * A closed reader reconnects with the same now-stale token and is denied.
 * A 410 (already gone) counts as disconnected and prunes the row, like broadcast.
 * Shares the bounded-concurrency + 429 retry of `broadcastToSession`.
 */
export const disconnectSessionReaders = async (params: {
  endpoint: string;
  sessionId: string;
  retry?: Partial<RetryDeps>;
}): Promise<{ disconnected: number }> => {
  const deps = defaultRetryDeps(params.retry);
  const api = apiClient(params.endpoint);

  const readers = (await db.getAllConnections(params.sessionId)).filter((c) => c.readOnly);

  const results = await mapSettled(readers, FANOUT_CONCURRENCY, async (conn) => {
    try {
      await sendWithRetry(
        () => api.send(new DeleteConnectionCommand({ ConnectionId: conn.connectionId })),
        deps,
      );
    } catch (e) {
      if (httpStatus(e) === 410) {
        await db.removeConnection({ sessionId: params.sessionId, connectionId: conn.connectionId });
        return;
      }
      throw e;
    }
  });

  let disconnected = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('disconnect reader failed:', result.reason);
    } else {
      disconnected += 1;
    }
  }
  return { disconnected };
};

export type DbUpdateEntity = 'competition' | 'athlete' | 'time' | 'match' | 'score';
export type DbUpdateAction = 'created' | 'updated' | 'deleted';

/**
 * Server-side `db_update` notification — the analogue of timertimer's `"db"`
 * PubSub topic. Emitted by every write Lambda after a successful write so
 * live pages re-fetch; emission is best-effort and must never fail the write.
 * The fan-out outcome is logged (not discarded): a non-zero `failed`/`retried`
 * is how a db_update delivery problem shows up in CloudWatch at all — previously
 * these counts were dropped, so a throttled db_update fan-out was invisible (the
 * HWC 2026 blind spot).
 */
export const publishDbUpdate = async (params: {
  compId: string;
  entity: DbUpdateEntity;
  action: DbUpdateAction;
  id: string;
}): Promise<void> => {
  const endpoint = process.env.WS_API_ENDPOINT;
  if (!endpoint) {
    console.warn('WS_API_ENDPOINT not set — skipping db_update broadcast');
    return;
  }
  try {
    const { delivered, pruned, failed, retried } = await broadcastToSession({
      endpoint,
      sessionId: params.compId,
      payload: {
        type: 'db_update',
        sessionId: params.compId,
        data: { entity: params.entity, action: params.action, id: params.id },
      },
    });
    console.log(
      `db_update ${params.entity} ${params.action} session=${params.compId} delivered=${delivered} pruned=${pruned} failed=${failed} retried=${retried}`,
    );
  } catch (e) {
    console.error('db_update broadcast failed (write already persisted):', e);
  }
};
