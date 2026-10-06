/**
 * Relay admission for a raw WS frame — pure, so every check that costs nothing
 * runs before the membership `GetItem`.
 *
 * Caps are in UTF-16 chars, checked before `JSON.parse` so an oversize frame
 * costs no parse. The largest legitimate frame (a freestyle `state_snapshot`)
 * is ~1.2 KB.
 */
export const RELAY_MAX_FRAME_CHARS = 8192;
/** For the frames that carry no relayable state — every byte of them is either logged or wasted. */
export const SWALLOW_MAX_CHARS = 2048;
const SMALL_FRAME_TYPES = new Set(['ping', 'ack', 'request_state']);

const TYPE_PATTERN = /^[A-Za-z_]{1,32}$/;
// compId-shaped (core/validators.ts): no `#`, so a frame can never address a `CONN#` map item.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface RelayFrame {
  type: string;
  sessionId?: string;
  data?: unknown;
  [key: string]: unknown;
}

export type DropReason = 'oversize' | 'malformed' | 'invalid' | 'invalidAck' | 'limited';

export type ParsedFrame = { ok: true; frame: RelayFrame } | { ok: false; reason: DropReason };

export const parseFrame = (body: string | null | undefined): ParsedFrame => {
  if (body == null) return { ok: false, reason: 'malformed' };
  if (body.length > RELAY_MAX_FRAME_CHARS) return { ok: false, reason: 'oversize' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid' };
  }
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.type !== 'string' || !TYPE_PATTERN.test(frame.type)) {
    return { ok: false, reason: 'invalid' };
  }
  if (
    frame.sessionId !== undefined &&
    (typeof frame.sessionId !== 'string' || !SESSION_ID_PATTERN.test(frame.sessionId))
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (SMALL_FRAME_TYPES.has(frame.type) && body.length > SWALLOW_MAX_CHARS) {
    return { ok: false, reason: 'oversize' };
  }
  return { ok: true, frame: frame as RelayFrame };
};

const ACK_OF = new Set(['start', 'stop', 'reset']);

export interface Ack {
  of: string;
  key?: number;
  page?: unknown;
  ua?: unknown;
}

/**
 * The `ack` fields the log line joins on: `of` is one of the three acked
 * types and `key` the acked message's epoch (absent for `reset`). `page`/`ua`
 * are free text, sanitised at the log line.
 */
export const parseAck = (data: unknown): Ack | null => {
  if (typeof data !== 'object' || data === null) return null;
  const { of, key, page, ua } = data as Record<string, unknown>;
  if (typeof of !== 'string' || !ACK_OF.has(of)) return null;
  if (key !== undefined && (typeof key !== 'number' || !Number.isFinite(key))) return null;
  return { of, key, page, ua };
};

const SENDER_ID_MAX_CHARS = 64;

/**
 * The only `request_state` the relay forwards: no client `data` or extra keys
 * ride the fan-out. `senderId` is kept as the envelope carries it on every
 * frame (ADR 0038).
 */
export const canonicalRequestState = (frame: RelayFrame, sessionId: string): RelayFrame => {
  const { senderId } = frame;
  return {
    type: 'request_state',
    sessionId,
    ...(typeof senderId === 'string' && senderId.length <= SENDER_ID_MAX_CHARS ? { senderId } : {}),
    data: {},
  };
};

/**
 * Admits one frame per connection per window, per container. A cost damper
 * only — a fresh container admits everything.
 */
export const createConnectionDamper = ({
  windowMs,
  maxEntries,
}: {
  windowMs: number;
  maxEntries: number;
}) => {
  const lastAdmitted = new Map<string, number>();
  return {
    admit(connectionId: string, now: number): boolean {
      const last = lastAdmitted.get(connectionId);
      if (last !== undefined && now - last < windowMs) return false;
      // Re-insert so Map order stays least-recently-admitted first.
      lastAdmitted.delete(connectionId);
      lastAdmitted.set(connectionId, now);
      if (lastAdmitted.size > maxEntries) {
        const oldest = lastAdmitted.keys().next().value;
        if (oldest !== undefined) lastAdmitted.delete(oldest);
      }
      return true;
    },
  };
};

const DROP_REASONS: readonly DropReason[] = [
  'oversize',
  'malformed',
  'invalid',
  'invalidAck',
  'limited',
];

/**
 * Frame drops are counted and logged as at most one `drop-summary` line per
 * window: a per-drop line lets a client turn its frame rate into log ingest.
 * The first drop in a quiet window logs at once.
 */
export const createDropSummary = ({
  windowMs,
  log,
}: {
  windowMs: number;
  log: (line: string) => void;
}) => {
  const counts = new Map<DropReason, number>();
  let lastFlushAt = -Infinity;
  const flush = (now: number) => {
    if (counts.size === 0 || now - lastFlushAt < windowMs) return;
    log(`drop-summary ${DROP_REASONS.map((r) => `${r}=${counts.get(r) ?? 0}`).join(' ')}`);
    counts.clear();
    lastFlushAt = now;
  };
  return {
    note(reason: DropReason, now: number) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      flush(now);
    },
    flush,
  };
};
