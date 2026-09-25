import { APIGatewayProxyHandler } from 'aws-lambda';
import { broadcastToSession } from 'core/broadcast';
import { db } from 'core/db';

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

const traceSummary = (data: unknown): string => {
  if (typeof data !== 'object' || data === null) return '';
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TRACE_DATA_FIELDS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return Object.keys(out).length ? ` details=${JSON.stringify(out)}` : '';
};

export const main: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;

  // A malformed frame from an authorized client is a drop, not an invocation error.
  let message: { type?: string; sessionId?: string; data?: unknown };
  try {
    message = JSON.parse(event.body || '{}');
  } catch {
    console.log(`drop: malformed frame from ${connectionId}`);
    return { statusCode: 200, body: 'Dropped' };
  }
  const sessionId = message.sessionId || 'default';

  // App-level keepalive (ADR 0024): clients ping every ~8 min so API Gateway's
  // 10-min idle timeout never fires. The send itself already reset the idle timer.
  // The ping also heartbeats this connection's row (refreshConnectionTtl) so its
  // short TTL can prune dead rows fast without ever evicting a live socket
  // (db.ts) — conditional-on-existence there, so a ping racing an expiry/prune
  // can't resurrect the row, and a failed refresh must never fail the keepalive.
  // Handled before the membership/read-only checks and the fan-out: a ping stays
  // out of the drop log and never relays.
  if (message.type === 'ping') {
    await db.refreshConnectionTtl({ sessionId, connectionId }).catch(() => {});
    return { statusCode: 200, body: 'Keepalive' };
  }

  try {
    // Sender must be a member of the session; read-only (overlay) connections can't inject.
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
    if (message.type === 'ack') {
      const d = (message.data ?? {}) as {
        of?: unknown;
        key?: unknown;
        page?: unknown;
        ua?: unknown;
      };
      console.log(
        `ack ${d.of ?? '?'} key=${d.key ?? '-'} page=${d.page ?? '?'} from ${connectionId} session=${sessionId} ua="${d.ua ?? '?'}"`,
      );
      return { statusCode: 200, body: 'Ack' };
    }
    // Read-only (overlay) connections can't inject relayable state — with one
    // exception: `request_state` carries no data of its own, it only prompts the
    // read-write control panels to re-broadcast their current selection/snapshot,
    // which the overlay is already authorized to read. Without this an overlay
    // joining mid-event can never catch up (the board re-pushes `updateSelection`
    // only on a change / its own OPEN / a peer panel's request), so a freshly-
    // opened VS/SVO overlay sticks on its positional fallback until the operator
    // pokes the board again.
    if (sender.readOnly && message.type !== 'request_state') {
      console.log(`drop: read-only connection ${connectionId} tried to send ${message.type}`);
      return { statusCode: 200, body: 'Dropped' };
    }

    // Offline: the local WS harness management API (WS_API_ENDPOINT), not the domainName/stage URL.
    const endpoint =
      process.env.IS_OFFLINE === 'true'
        ? (process.env.WS_API_ENDPOINT ?? 'http://127.0.0.1:3001')
        : `https://${event.requestContext.domainName}/${event.requestContext.stage}`;

    const { delivered, pruned, failed, retried } = await broadcastToSession({
      endpoint,
      sessionId,
      payload: message,
      excludeConnectionId: connectionId,
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
