import { APIGatewayProxyHandler } from 'aws-lambda';
import { broadcastToSession } from 'core/broadcast';
import { db } from 'core/db';
import { safe, safeQuoted } from 'core/logSafe';
import { isOffline } from 'core/offline';

import {
  canonicalRequestState,
  createConnectionDamper,
  createDropSummary,
  parseAck,
  parseFrame,
} from './frame';

/**
 * Relay-trace detail: the allowlisted `data` fields worth logging per message
 * (lane/timing/selection identity — enough to reconstruct a run's timeline
 * from CloudWatch alone). Full message bodies are still never logged.
 */
const TRACE_DATA_FIELDS = [
  'timerId',
  'startTime',
  'stopTime',
  'phase',
  'lane1',
  'lane2',
  'athlete1Id',
  'athlete2Id',
  'round',
  'gender',
  'matchId',
] as const;

const TRACE_MAX_CHARS = 512;

const traceSummary = (data: unknown): string => {
  if (typeof data !== 'object' || data === null) return '';
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TRACE_DATA_FIELDS) {
    const value = source[key];
    if (value === undefined) continue;
    // Numbers stay numbers so Logs Insights can still compare epochs.
    out[key] =
      typeof value === 'number' || typeof value === 'boolean'
        ? value
        : safe(typeof value === 'string' ? value : JSON.stringify(value));
  }
  return Object.keys(out).length ? ` details=${JSON.stringify(out).slice(0, TRACE_MAX_CHARS)}` : '';
};

const DAMPER_WINDOW_MS = 60_000;
// A client pings every 8 min against CONNECTION_TTL_SECONDS (core/db.ts), so
// more than one refresh per connection per minute is a flood.
const pingDamper = createConnectionDamper({ windowMs: DAMPER_WINDOW_MS, maxEntries: 5000 });
// A page sends one `request_state` per socket OPEN (ADR 0050).
const requestStateDamper = createConnectionDamper({ windowMs: 5_000, maxEntries: 5000 });
const drops = createDropSummary({ windowMs: DAMPER_WINDOW_MS, log: (line) => console.log(line) });

export const main: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const now = Date.now();

  // A bad frame from an authorized client is a drop, not an invocation error.
  // `type` and `sessionId` are pattern-checked here, so they log unescaped below.
  const parsed = parseFrame(event.body);
  if (!parsed.ok) {
    drops.note(parsed.reason, now);
    return { statusCode: 200, body: 'Dropped' };
  }
  drops.flush(now);
  const message = parsed.frame;
  const sessionId = message.sessionId ?? 'default';

  // Keepalive (ADR 0024): the send itself resets API Gateway's idle timer; the
  // ping also heartbeats the connection row's TTL (db.refreshConnectionTtl), and
  // a failed refresh must never fail the keepalive. Handled before the
  // membership/read-only checks: a ping never relays and stays out of the drop log.
  if (message.type === 'ping') {
    if (pingDamper.admit(connectionId, now)) {
      await db.refreshConnectionTtl({ sessionId, connectionId }).catch(() => {});
    }
    return { statusCode: 200, body: 'Keepalive' };
  }

  const ack = message.type === 'ack' ? parseAck(message.data) : null;
  if (message.type === 'ack' && !ack) {
    drops.note('invalidAck', now);
    return { statusCode: 200, body: 'Dropped' };
  }

  const isRequestState = message.type === 'request_state';
  if (isRequestState && !requestStateDamper.admit(connectionId, now)) {
    drops.note('limited', now);
    return { statusCode: 200, body: 'Dropped' };
  }

  try {
    const sender = await db.getConnection({ sessionId, connectionId });
    if (!sender) {
      console.log(`drop: ${connectionId} is not a member of session ${sessionId}`);
      return { statusCode: 200, body: 'Dropped' };
    }

    // Receipt ack (debug telemetry): displays confirm timer-critical messages
    // (start/stop/reset) they consumed. Swallowed — NEVER fanned out (an ack
    // relayed to N connections is an ack-storm) — but logged so Logs Insights
    // can join a `relay stop … delivered=N` line with the acks for its key and
    // name the consumers that went silent. Allowed from read-only overlays
    // (handled before the guard below); carries no relayable state.
    if (ack) {
      console.log(
        `ack ${ack.of} key=${ack.key ?? '-'} page=${safe(ack.page ?? '?')} from ${connectionId} session=${sessionId} ua="${safeQuoted(ack.ua ?? '?')}"`,
      );
      return { statusCode: 200, body: 'Ack' };
    }
    // Read-only (overlay) connections can't inject relayable state. Their one
    // admitted frame, `request_state`, only prompts the panels to re-send state
    // the overlay may already read; it is relayed canonical and to panels only.
    if (sender.readOnly && !isRequestState) {
      console.log(`drop: read-only connection ${connectionId} tried to send ${message.type}`);
      return { statusCode: 200, body: 'Dropped' };
    }

    // Offline: the local WS harness management API (WS_API_ENDPOINT), not the domainName/stage URL.
    const endpoint = isOffline()
      ? (process.env.WS_API_ENDPOINT ?? 'http://127.0.0.1:3001')
      : `https://${event.requestContext.domainName}/${event.requestContext.stage}`;

    const { delivered, pruned, failed, retried } = await broadcastToSession({
      endpoint,
      sessionId,
      payload: isRequestState ? canonicalRequestState(message, sessionId) : message,
      excludeConnectionId: connectionId,
      includeReadOnly: !isRequestState,
    });
    // Per-message delivery trace: `pruned` means a peer's socket was already
    // dead when we relayed (it missed this message until it reconnects and
    // re-requests state); `failed` is a post that exhausted its retries (still
    // throttled, or a transport error); `retried` is posts that bounced on a 429
    // but recovered. Grep CloudWatch for `pruned=[1-9]` / `failed=[1-9]` to spot
    // lost relays, `retried=[1-9]` for rising throttle pressure before it bites.
    console.log(
      `relay ${message.type} session=${sessionId} delivered=${delivered} pruned=${pruned} failed=${failed} retried=${retried}${traceSummary(message.data)}`,
    );

    return { statusCode: 200, body: 'Message broadcast successfully' };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
