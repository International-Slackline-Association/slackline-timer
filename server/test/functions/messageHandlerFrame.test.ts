import { describe, expect, it } from 'vitest';

import {
  canonicalRequestState,
  createDropSummary,
  createConnectionDamper,
  parseAck,
  parseFrame,
  RELAY_MAX_FRAME_CHARS,
  SWALLOW_MAX_CHARS,
} from '@functions/messageHandler/frame';

const padded = (frame: Record<string, unknown>, length: number): string => {
  const base = JSON.stringify({ ...frame, pad: '' });
  return JSON.stringify({ ...frame, pad: 'x'.repeat(length - base.length) });
};

describe('parseFrame', () => {
  it('accepts a relay frame and keeps every field', () => {
    const body = JSON.stringify({ type: 'stop', sessionId: 'comp-1', senderId: 'u', data: {} });

    expect(parseFrame(body)).toEqual({ ok: true, frame: JSON.parse(body) });
  });

  it('accepts an absent sessionId', () => {
    expect(parseFrame('{"type":"start"}')).toEqual({ ok: true, frame: { type: 'start' } });
  });

  it('caps relay frames at RELAY_MAX_FRAME_CHARS', () => {
    const atCap = padded({ type: 'state_snapshot', sessionId: 's1' }, RELAY_MAX_FRAME_CHARS);
    expect(parseFrame(atCap).ok).toBe(true);
    expect(parseFrame(`${atCap} `)).toEqual({ ok: false, reason: 'oversize' });
  });

  it.each(['ping', 'ack', 'request_state'])('caps %s at SWALLOW_MAX_CHARS', (type) => {
    const atCap = padded({ type, sessionId: 's1' }, SWALLOW_MAX_CHARS);
    expect(parseFrame(atCap).ok).toBe(true);
    expect(parseFrame(`${atCap} `)).toEqual({ ok: false, reason: 'oversize' });
  });

  it('reports unparseable JSON as malformed', () => {
    expect(parseFrame('{not json')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseFrame(null)).toEqual({ ok: false, reason: 'malformed' });
  });

  it.each([
    'null',
    '[]',
    '"x"',
    '123',
    '{}',
    '{"type":5}',
    '{"type":""}',
    '{"type":"a\\nb"}',
    `{"type":"${'a'.repeat(33)}"}`,
    '{"type":"start","sessionId":{}}',
    '{"type":"start","sessionId":""}',
    '{"type":"start","sessionId":"a#b"}',
    `{"type":"start","sessionId":"${'s'.repeat(65)}"}`,
  ])('rejects %s as invalid', (body) => {
    expect(parseFrame(body)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('parseAck', () => {
  it.each(['start', 'stop', 'reset'])('accepts of=%s', (of) => {
    expect(parseAck({ of, key: 1, page: '/p', ua: 'UA' })).toEqual({
      of,
      key: 1,
      page: '/p',
      ua: 'UA',
    });
  });

  it('accepts an absent key (reset)', () => {
    expect(parseAck({ of: 'reset', page: '/p', ua: 'UA' })?.key).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    'x',
    { of: 'stop\nkey=1' },
    { of: 'resume', key: 1 },
    { of: 'stop', key: '1' },
    { of: 'stop', key: null },
  ])('rejects %j', (data) => {
    expect(parseAck(data)).toBeNull();
  });
});

describe('canonicalRequestState', () => {
  it('keeps only type, sessionId and a string senderId, with empty data', () => {
    expect(
      canonicalRequestState(
        {
          type: 'request_state',
          sessionId: 'ignored',
          senderId: 'panel-1',
          data: { pad: 'x' },
          replyTo: 'conn-9',
          junk: 1,
        },
        's1',
      ),
    ).toEqual({ type: 'request_state', sessionId: 's1', senderId: 'panel-1', data: {} });
  });

  it.each([5, {}, 's'.repeat(65)])('drops senderId %j', (senderId) => {
    expect(canonicalRequestState({ type: 'request_state', senderId }, 's1')).toEqual({
      type: 'request_state',
      sessionId: 's1',
      data: {},
    });
  });
});

describe('createConnectionDamper', () => {
  it('admits one refresh per connection per window', () => {
    const damper = createConnectionDamper({ windowMs: 60_000, maxEntries: 10 });

    expect(damper.admit('c1', 0)).toBe(true);
    expect(damper.admit('c1', 59_999)).toBe(false);
    expect(damper.admit('c2', 59_999)).toBe(true);
    expect(damper.admit('c1', 60_000)).toBe(true);
  });

  it('evicts the least recently admitted connection past maxEntries', () => {
    const damper = createConnectionDamper({ windowMs: 60_000, maxEntries: 2 });
    damper.admit('c1', 0);
    damper.admit('c2', 1);
    damper.admit('c3', 2);

    expect(damper.admit('c1', 3)).toBe(true);
    expect(damper.admit('c3', 4)).toBe(false);
  });
});

describe('createDropSummary', () => {
  it('logs the first drop, then at most one summary line per window', () => {
    const lines: string[] = [];
    const summary = createDropSummary({ windowMs: 60_000, log: (l) => lines.push(l) });

    summary.note('oversize', 1_000);
    summary.note('oversize', 2_000);
    summary.note('malformed', 3_000);
    summary.note('invalidAck', 4_000);
    summary.note('limited', 5_000);
    expect(lines).toEqual(['drop-summary oversize=1 malformed=0 invalid=0 invalidAck=0 limited=0']);

    summary.note('invalid', 61_000);
    expect(lines).toEqual([
      'drop-summary oversize=1 malformed=0 invalid=0 invalidAck=0 limited=0',
      'drop-summary oversize=1 malformed=1 invalid=1 invalidAck=1 limited=1',
    ]);
  });

  it('flushes pending counts once the window has elapsed without a further drop', () => {
    const lines: string[] = [];
    const summary = createDropSummary({ windowMs: 60_000, log: (l) => lines.push(l) });
    summary.note('oversize', 0);
    summary.note('oversize', 1);

    summary.flush(59_999);
    expect(lines).toHaveLength(1);
    summary.flush(60_000);
    expect(lines[1]).toBe('drop-summary oversize=1 malformed=0 invalid=0 invalidAck=0 limited=0');
    summary.flush(200_000);
    expect(lines).toHaveLength(2);
  });
});
