import { describe, expect, it } from 'vitest';

import type { CountdownWSMessage } from 'app/hooks/useWebSocket';
import {
  WARMUP_TIMER_ID,
  initialWarmupState,
  initialWarmupStore,
  peerWarmupEvent,
  reduce,
  warmupCardState,
  warmupDisplay,
  warmupReducer,
  warmupSnapshotRow,
  type WarmupState,
} from 'app/util/warmupChannel';

const DEFAULT_S = 300;
const DEFAULT_MS = DEFAULT_S * 1000;

const idle = (): WarmupState => initialWarmupState(DEFAULT_S);
const running = (startedAt = 0): WarmupState =>
  reduce(idle(), { type: 'START', at: startedAt }).state;
const expired = (): WarmupState => reduce(running(0), { type: 'EXPIRE' }).state;
/** A window the operator stopped `elapsedMs` in — idle, below its default. */
const stopped = (elapsedMs: number): WarmupState =>
  reduce(running(0), { type: 'STOP', at: elapsedMs }).state;

describe('warmupChannel — START', () => {
  it('starts an idle clock anchored at the event wall clock, beeps short, broadcasts the shared epoch', () => {
    const r = reduce(idle(), { type: 'START', at: 1000 });
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: DEFAULT_MS, startedAt: 1000 });
    expect(r.effects).toEqual([
      { kind: 'audio', sound: 'short' },
      {
        kind: 'ws',
        message: {
          type: 'start_countdown',
          timerId: WARMUP_TIMER_ID,
          data: { remainingMs: DEFAULT_MS, startedAt: 1000 },
        },
      },
    ]);
  });

  it('ignores a re-press while running', () => {
    const r = reduce(running(0), { type: 'START', at: 5000 });
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: DEFAULT_MS, startedAt: 0 });
    expect(r.effects).toHaveLength(0);
  });

  it('cannot start a spent clock (no zero-length broadcast — re-arm first)', () => {
    const r = reduce(expired(), { type: 'START', at: 5000 });
    expect(r.state.clock).toEqual({ kind: 'expired' });
    expect(r.effects).toHaveLength(0);
  });
});

describe('warmupChannel — STOP', () => {
  it('freezes the derived remaining and broadcasts it', () => {
    const r = reduce(running(0), { type: 'STOP', at: 20_000 });
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: DEFAULT_MS - 20_000 });
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'stop_countdown',
          timerId: WARMUP_TIMER_ID,
          data: { remainingMs: DEFAULT_MS - 20_000 },
        },
      },
    ]);
  });

  it('a stop at/after the crossing lands as expired', () => {
    const r = reduce(running(0), { type: 'STOP', at: DEFAULT_MS + 1 });
    expect(r.state.clock).toEqual({ kind: 'expired' });
    expect(r.effects).toContainEqual({
      kind: 'ws',
      message: { type: 'stop_countdown', timerId: WARMUP_TIMER_ID, data: { remainingMs: 0 } },
    });
  });

  it('is a no-op while not running', () => {
    const before = idle();
    const r = reduce(before, { type: 'STOP', at: 1000 });
    expect(r.state).toBe(before);
    expect(r.effects).toHaveLength(0);
  });
});

describe('warmupChannel — RESET / EXPIRE / SET_DEFAULT', () => {
  it('RESET (the Re-arm press) re-arms to the default and broadcasts', () => {
    const r = reduce(expired(), { type: 'RESET' });
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: DEFAULT_MS });
    expect(r.effects).toEqual([
      {
        kind: 'ws',
        message: {
          type: 'reset_countdown',
          timerId: WARMUP_TIMER_ID,
          data: { remainingMs: DEFAULT_MS },
        },
      },
    ]);
  });

  it('EXPIRE freezes at zero and sounds the warm-up alert — and broadcasts nothing (every surface beeps off its own Countdown)', () => {
    const r = reduce(running(0), { type: 'EXPIRE' });
    expect(r.state.clock).toEqual({ kind: 'expired' });
    // The warm-up's own tone, never the run-zero `long` (audit S14). Nothing
    // else changes: the card holds its shape and swaps the transport in place.
    expect(r.effects).toEqual([{ kind: 'audio', sound: 'alert' }]);
    expect(r.state.defaultSeconds).toBe(DEFAULT_S);
  });

  it('a stale EXPIRE (after a stop/reset) is a no-op', () => {
    const stopped = reduce(running(0), { type: 'STOP', at: 10_000 }).state;
    const r = reduce(stopped, { type: 'EXPIRE' });
    expect(r.state).toBe(stopped);
    expect(r.effects).toHaveLength(0);
  });

  it('SET_DEFAULT re-arms an idle clock to the new default (editing the field re-arms)', () => {
    const r = reduce(idle(), { type: 'SET_DEFAULT', seconds: 120 });
    expect(r.state.defaultSeconds).toBe(120);
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: 120_000 });
    expect(r.effects).toHaveLength(0);
  });

  it('SET_DEFAULT revives a spent clock (the field edit is a re-arm)', () => {
    const r = reduce(expired(), { type: 'SET_DEFAULT', seconds: 60 });
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: 60_000 });
  });

  it('SET_DEFAULT never touches a running clock (the new default applies from the next RESET)', () => {
    const r = reduce(running(0), { type: 'SET_DEFAULT', seconds: 60 });
    expect(r.state.defaultSeconds).toBe(60);
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: DEFAULT_MS, startedAt: 0 });
  });
});

describe('warmupChannel — PEER mirroring (ADR 0038: wire is truth, never a ws effect)', () => {
  it('PEER_START mirrors the run anchored at the shared wire epoch, beeps short', () => {
    const r = reduce(idle(), { type: 'PEER_START', startedAt: 1234, remainingMs: 200_000 });
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: 200_000, startedAt: 1234 });
    expect(r.effects).toEqual([{ kind: 'audio', sound: 'short' }]);
  });

  it('PEER_STOP freezes at the authoritative wire remaining, silently', () => {
    const r = reduce(running(0), { type: 'PEER_STOP', remainingMs: 42_000 });
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: 42_000 });
    expect(r.effects).toHaveLength(0);
  });

  it('a PEER_STOP at zero lands as expired', () => {
    const r = reduce(running(0), { type: 'PEER_STOP', remainingMs: 0 });
    expect(r.state.clock).toEqual({ kind: 'expired' });
  });

  it('PEER_RESET re-arms to the wire value', () => {
    const r = reduce(expired(), { type: 'PEER_RESET', remainingMs: 90_000 });
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: 90_000 });
    expect(r.effects).toHaveLength(0);
  });
});

describe('warmupChannel — PEER_SNAPSHOT hydration', () => {
  it('a running row anchors to the shared wire epoch', () => {
    const r = reduce(expired(), {
      type: 'PEER_SNAPSHOT',
      at: 9_999,
      timers: [
        { timerId: WARMUP_TIMER_ID, remainingMs: 150_000, isRunning: true, startedAt: 5000 },
      ],
    });
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: 150_000, startedAt: 5000 });
    expect(r.effects).toHaveLength(0);
  });

  it('a pre-feature running row (no startedAt) falls back to the receipt clock', () => {
    const r = reduce(idle(), {
      type: 'PEER_SNAPSHOT',
      at: 9_999,
      timers: [{ timerId: WARMUP_TIMER_ID, remainingMs: 150_000, isRunning: true }],
    });
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: 150_000, startedAt: 9_999 });
  });

  it('a resting row with remaining hydrates idle; a spent one hydrates expired', () => {
    const rested = reduce(idle(), {
      type: 'PEER_SNAPSHOT',
      at: 0,
      timers: [{ timerId: WARMUP_TIMER_ID, remainingMs: 60_000, isRunning: false }],
    });
    expect(rested.state.clock).toEqual({ kind: 'idle', remainingMs: 60_000 });

    const spent = reduce(idle(), {
      type: 'PEER_SNAPSHOT',
      at: 0,
      timers: [{ timerId: WARMUP_TIMER_ID, remainingMs: 0, isRunning: false }],
    });
    expect(spent.state.clock).toEqual({ kind: 'expired' });
  });

  it('a snapshot without the warm-up channel leaves the local state standing', () => {
    const before = running(0);
    const r = reduce(before, {
      type: 'PEER_SNAPSHOT',
      at: 0,
      timers: [{ timerId: 1, remainingMs: 100_000, isRunning: true }],
    });
    expect(r.state).toBe(before);
  });

  // ADR 0046 §2, one channel over: the room owns the armed budget. A joiner that
  // kept its own `defaultSeconds` read a HELD window as ARMED (the card compares
  // the remaining against the default it holds) and would then re-arm the whole
  // room to that default on its next RESET.
  it("adopts the room's armed budget, so a held window does not read ARMED", () => {
    const joiner = initialWarmupState(120); // a 2-min format default...
    const r = reduce(joiner, {
      at: 0,
      type: 'PEER_SNAPSHOT',
      // ...against a room armed to 5 min and stopped 1 min in.
      timers: [
        { timerId: WARMUP_TIMER_ID, remainingMs: 240_000, isRunning: false, armedMs: DEFAULT_MS },
      ],
    });
    expect(r.state.defaultSeconds).toBe(DEFAULT_S);
    expect(r.state.clock).toEqual({ kind: 'idle', remainingMs: 240_000 });
    expect(warmupCardState(r.state)).toEqual({ tier: 'held', word: 'STOPPED · 04:00 LEFT' });
  });

  it("adopts the room's armed budget on a running row too", () => {
    // The running branch needs it for the phase AFTER this one: the joiner's
    // Reset (and its own card, once the clock rests) re-arms to the room's
    // budget, not to the preset this panel happened to open with.
    const r = reduce(initialWarmupState(120), {
      at: 0,
      type: 'PEER_SNAPSHOT',
      timers: [
        {
          timerId: WARMUP_TIMER_ID,
          remainingMs: 150_000,
          isRunning: true,
          startedAt: 5000,
          armedMs: DEFAULT_MS,
        },
      ],
    });
    expect(r.state.defaultSeconds).toBe(DEFAULT_S);
    expect(r.state.clock).toEqual({ kind: 'running', remainingMs: 150_000, startedAt: 5000 });
  });

  it('keeps the local default when the row carries no armed budget (pre-feature peer)', () => {
    const r = reduce(initialWarmupState(120), {
      at: 0,
      type: 'PEER_SNAPSHOT',
      timers: [{ timerId: WARMUP_TIMER_ID, remainingMs: 60_000, isRunning: false }],
    });
    expect(r.state.defaultSeconds).toBe(120);
  });
});

describe('warmupChannel — derived views', () => {
  it('warmupDisplay is the clock union itself (idle/running/expired map 1:1)', () => {
    expect(warmupDisplay(idle())).toEqual({ kind: 'idle', remainingMs: DEFAULT_MS });
    expect(warmupDisplay(running(7))).toEqual({
      kind: 'running',
      remainingMs: DEFAULT_MS,
      startedAt: 7,
    });
    expect(warmupDisplay(expired())).toEqual({ kind: 'expired' });
  });

  // The one row `clock.kind` cannot supply on its own is `held`: a stopped
  // window is `idle` too, so only the distance to the armed default separates
  // "waiting to start" from "used, and holding what is left" (audit S02).
  it.each([
    ['a fresh window', idle(), { tier: 'armed', word: 'ARMED' }],
    ['a counting window', running(0), { tier: 'running', word: 'RUNNING' }],
    ['a window stopped mid-way', stopped(1000), { tier: 'held', word: 'STOPPED · 04:59 LEFT' }],
    ['a spent window', expired(), { tier: 'over', word: 'WARM-UP OVER' }],
  ])('warmupCardState words %s', (_case, state, card) => {
    expect(warmupCardState(state)).toEqual(card);
  });

  it('re-arms the word: a stop at the default, a RESET and a default edit all read ARMED', () => {
    const armed = { tier: 'armed', word: 'ARMED' };
    expect(warmupCardState(stopped(0))).toEqual(armed);
    expect(warmupCardState(reduce(stopped(1000), { type: 'RESET' }).state)).toEqual(armed);
    expect(
      warmupCardState(reduce(stopped(1000), { type: 'SET_DEFAULT', seconds: 60 }).state),
    ).toEqual(armed);
  });

  it('warmupSnapshotRow hands over the pre-send control row per phase', () => {
    // `armedMs` rides every phase (ADR 0046 §2 amendment): it is what lets the
    // audience surface tell a stopped window from a fresh one.
    expect(warmupSnapshotRow(idle())).toEqual({
      timerId: WARMUP_TIMER_ID,
      lastRemainingMs: DEFAULT_MS,
      isRunning: false,
      startedAt: null,
      armedMs: DEFAULT_MS,
    });
    expect(warmupSnapshotRow(running(7))).toEqual({
      timerId: WARMUP_TIMER_ID,
      lastRemainingMs: DEFAULT_MS,
      isRunning: true,
      startedAt: 7,
      armedMs: DEFAULT_MS,
    });
    expect(warmupSnapshotRow(expired())).toEqual({
      timerId: WARMUP_TIMER_ID,
      lastRemainingMs: 0,
      isRunning: false,
      startedAt: null,
      armedMs: DEFAULT_MS,
    });
    // A window stopped part-way keeps the armed budget it was stopped out of —
    // the distance between the two is the whole point.
    expect(warmupSnapshotRow(stopped(60_000))).toEqual({
      timerId: WARMUP_TIMER_ID,
      lastRemainingMs: DEFAULT_MS - 60_000,
      isRunning: false,
      startedAt: null,
      armedMs: DEFAULT_MS,
    });
  });
});

describe('warmupChannel — peerWarmupEvent (wire → event table)', () => {
  const msg = (partial: Partial<CountdownWSMessage> & { type: CountdownWSMessage['type'] }) =>
    ({ sessionId: 's', ...partial }) as CountdownWSMessage;

  it('translates the timerId-0 clock family, preferring the shared wire anchor', () => {
    expect(
      peerWarmupEvent(
        msg({ type: 'start_countdown', timerId: 0, data: { remainingMs: 1000, startedAt: 5 } }),
        99,
      ),
    ).toEqual({ type: 'PEER_START', startedAt: 5, remainingMs: 1000 });
    expect(
      peerWarmupEvent(
        msg({ type: 'start_countdown', timerId: 0, data: { remainingMs: 1000 } }),
        99,
      ),
    ).toEqual({ type: 'PEER_START', startedAt: 99, remainingMs: 1000 });
    expect(
      peerWarmupEvent(msg({ type: 'stop_countdown', timerId: 0, data: { remainingMs: 800 } }), 99),
    ).toEqual({ type: 'PEER_STOP', remainingMs: 800 });
    expect(
      peerWarmupEvent(msg({ type: 'reset_countdown', timerId: 0, data: { remainingMs: 900 } }), 99),
    ).toEqual({ type: 'PEER_RESET', remainingMs: 900 });
  });

  it('returns null for other channels and session-scoped messages', () => {
    expect(
      peerWarmupEvent(msg({ type: 'start_countdown', timerId: 1, data: { remainingMs: 1 } }), 0),
    ).toBeNull();
    expect(
      peerWarmupEvent(msg({ type: 'start_countdown', timerId: 3, data: { remainingMs: 1 } }), 0),
    ).toBeNull();
    expect(peerWarmupEvent(msg({ type: 'request_state', data: {} }), 0)).toBeNull();
  });
});

describe('warmupChannel — store adapter (effects-as-data + DRAIN)', () => {
  it('queues transition effects and clears them on DRAIN', () => {
    const armed = initialWarmupStore(DEFAULT_S);
    const started = warmupReducer(armed, { type: 'START', at: 0 });
    expect(started.effects).toHaveLength(2);
    // A second event before the drain appends, never replaces.
    const stopped = warmupReducer(started, { type: 'STOP', at: 1000 });
    expect(stopped.effects).toHaveLength(3);
    const drained = warmupReducer(stopped, { type: 'DRAIN' });
    expect(drained.effects).toHaveLength(0);
    expect(drained.warmup).toBe(stopped.warmup);
  });
});
