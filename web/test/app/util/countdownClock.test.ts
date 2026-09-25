import { describe, expect, it } from 'vitest';

import {
  clockFromMessage,
  clockFromRecovery,
  initClockStore,
  reduceClock,
  type ClockStore,
} from 'app/util/countdownClock';
import type { CountdownDisplayState } from 'app/util/timerChannel';

// Pure-core table tests (HSM rule 3): no React, no mocks, no fake timers —
// wall clock rides in on `at`.

describe('clockFromMessage (wire → union mapper)', () => {
  it('start_countdown anchors to the shared wire epoch when present', () => {
    expect(
      clockFromMessage(
        { type: 'start_countdown', timerId: 1, data: { remainingMs: 90_000, startedAt: 5_000 } },
        7_200,
      ),
    ).toEqual({ kind: 'running', remainingMs: 90_000, startedAt: 5_000 });
  });

  it('start_countdown falls back to receipt time for a pre-feature sender', () => {
    expect(
      clockFromMessage(
        { type: 'start_countdown', timerId: 1, data: { remainingMs: 90_000 } },
        7_200,
      ),
    ).toEqual({ kind: 'running', remainingMs: 90_000, startedAt: 7_200 });
  });

  it('stop_countdown above zero freezes as idle at the wire remaining', () => {
    expect(
      clockFromMessage({ type: 'stop_countdown', timerId: 1, data: { remainingMs: 3_000 } }, 0),
    ).toEqual({ kind: 'idle', remainingMs: 3_000 });
  });

  it('stop_countdown at/below zero lands as expired (the crossing face, warm-up restingClock semantics)', () => {
    expect(
      clockFromMessage({ type: 'stop_countdown', timerId: 1, data: { remainingMs: 0 } }, 0),
    ).toEqual({ kind: 'expired' });
  });

  it('reset_countdown re-arms idle even at zero (an explicit re-arm, never expired)', () => {
    expect(
      clockFromMessage({ type: 'reset_countdown', timerId: 1, data: { remainingMs: 0 } }, 0),
    ).toEqual({ kind: 'idle', remainingMs: 0 });
  });

  it('start_break holds the run and anchors the break clock to the wire epoch', () => {
    expect(
      clockFromMessage(
        {
          type: 'start_break',
          timerId: 1,
          data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 1, startedAt: 2_000 },
        },
        9_999,
      ),
    ).toEqual({
      kind: 'onBreak',
      heldMs: 45_000,
      breakMs: 30_000,
      breakStartedAt: 2_000,
      breaksLeft: 1,
    });
  });

  it('start_break falls back to receipt time without a wire epoch', () => {
    const state = clockFromMessage(
      {
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 2 },
      },
      1_234,
    );
    expect(state).toMatchObject({ kind: 'onBreak', breakStartedAt: 1_234, breaksLeft: 2 });
  });

  it('end_break clears the break, holding the run paused (manual resume)', () => {
    expect(
      clockFromMessage({ type: 'end_break', timerId: 1, data: { runRemainingMs: 45_000 } }, 0),
    ).toEqual({ kind: 'idle', remainingMs: 45_000 });
  });
});

describe('clockFromRecovery (snapshot row → union mapper)', () => {
  it('recovers a running lane anchored to the shared send epoch', () => {
    expect(
      clockFromRecovery({ remainingMs: 60_000, isRunning: true, startedAt: 4_000 }, 5_500),
    ).toEqual({
      kind: 'running',
      remainingMs: 60_000,
      startedAt: 4_000,
    });
  });

  it('falls back to receipt time for a pre-feature snapshot', () => {
    expect(clockFromRecovery({ remainingMs: 60_000, isRunning: true }, 5_500)).toEqual({
      kind: 'running',
      remainingMs: 60_000,
      startedAt: 5_500,
    });
  });

  it('recovers an on-break lane with the run held paused', () => {
    expect(
      clockFromRecovery(
        {
          remainingMs: 45_000,
          isRunning: false,
          onBreak: true,
          breakRemainingMs: 18_000,
          breakStartedAt: 3_000,
          breaksLeft: 0,
        },
        9_000,
      ),
    ).toEqual({
      kind: 'onBreak',
      heldMs: 45_000,
      breakMs: 18_000,
      breakStartedAt: 3_000,
      breaksLeft: 0,
    });
  });

  it('onBreak wins over isRunning — the old illegal combo collapses to the held break', () => {
    // The boolean bag let a malformed row tick the run AND the break at once;
    // the union makes that unrepresentable: on break, the run is held.
    const state = clockFromRecovery(
      { remainingMs: 45_000, isRunning: true, onBreak: true, breakRemainingMs: 10_000 },
      0,
    );
    expect(state.kind).toBe('onBreak');
  });

  it('recovers a resting lane as idle at the recovered remaining', () => {
    expect(clockFromRecovery({ remainingMs: 33_000, isRunning: false }, 0)).toEqual({
      kind: 'idle',
      remainingMs: 33_000,
    });
  });
});

describe('initClockStore (ceil seed off the union anchor)', () => {
  it('seeds a running clock to the whole second in progress (a stale anchor never flashes :59)', () => {
    // The anchor is 7ms old by apply time; a raw floor would show 01:59 for a
    // 02:00 start. The seed ceils to the second in progress.
    expect(
      initClockStore({ kind: 'running', remainingMs: 120_000, startedAt: 1_000 }, 1_007),
    ).toEqual({
      state: { kind: 'running', remainingMs: 120_000, startedAt: 1_000 },
      liveMs: 120_000,
    });
  });

  it('seeds a mid-run hydration to the derived whole second', () => {
    const { liveMs } = initClockStore(
      { kind: 'running', remainingMs: 90_000, startedAt: 0 },
      10_500,
    );
    expect(liveMs).toBe(80_000);
  });

  it('seeds the break clock off the break anchor', () => {
    const onBreak: CountdownDisplayState = {
      kind: 'onBreak',
      heldMs: 45_000,
      breakMs: 30_000,
      breakStartedAt: 0,
      breaksLeft: 1,
    };
    expect(initClockStore(onBreak, 5_000).liveMs).toBe(25_000);
  });

  it('seeds idle to the armed budget and expired to zero', () => {
    expect(initClockStore({ kind: 'idle', remainingMs: 120_000 }, 99).liveMs).toBe(120_000);
    expect(initClockStore({ kind: 'expired' }, 99).liveMs).toBe(0);
  });
});

describe('reduceClock (pure transitions)', () => {
  const running: ClockStore = {
    state: { kind: 'running', remainingMs: 90_000, startedAt: 0 },
    liveMs: 90_000,
  };
  const onBreak: ClockStore = {
    state: {
      kind: 'onBreak',
      heldMs: 45_000,
      breakMs: 30_000,
      breakStartedAt: 0,
      breaksLeft: 1,
    },
    liveMs: 30_000,
  };

  it('TICK derives the run numeral raw off the anchor (real elapsed, never -1000)', () => {
    // A throttled tab fires the tick 11s in: the numeral reflects wall time.
    expect(reduceClock(running, { type: 'TICK', at: 11_000 }).liveMs).toBe(79_000);
  });

  it('TICK derives the break numeral off the break anchor, clamped at zero', () => {
    expect(reduceClock(onBreak, { type: 'TICK', at: 5_000 }).liveMs).toBe(25_000);
    expect(reduceClock(onBreak, { type: 'TICK', at: 99_000 }).liveMs).toBe(0);
  });

  it('TICK keeps the state variant untouched (display projection only)', () => {
    expect(reduceClock(running, { type: 'TICK', at: 11_000 }).state).toBe(running.state);
  });

  it('TICK is a same-store no-op on idle/expired (no re-render)', () => {
    const idle: ClockStore = { state: { kind: 'idle', remainingMs: 5_000 }, liveMs: 5_000 };
    expect(reduceClock(idle, { type: 'TICK', at: 123 })).toBe(idle);
    const expired: ClockStore = { state: { kind: 'expired' }, liveMs: 0 };
    expect(reduceClock(expired, { type: 'TICK', at: 123 })).toBe(expired);
  });

  it('RUN_ZERO transitions running → expired and freezes the numeral at 0', () => {
    expect(reduceClock(running, { type: 'RUN_ZERO' })).toEqual({
      state: { kind: 'expired' },
      liveMs: 0,
    });
  });

  it('RUN_ZERO is guarded — a stale fire after a stop/reset is a no-op', () => {
    const idle: ClockStore = { state: { kind: 'idle', remainingMs: 3_000 }, liveMs: 3_000 };
    expect(reduceClock(idle, { type: 'RUN_ZERO' })).toBe(idle);
  });

  it('BREAK_ZERO transitions onBreak → idle at the held run (paused for a manual Start)', () => {
    expect(reduceClock(onBreak, { type: 'BREAK_ZERO' })).toEqual({
      state: { kind: 'idle', remainingMs: 45_000 },
      liveMs: 45_000,
    });
  });

  it('BREAK_ZERO is guarded outside a break', () => {
    expect(reduceClock(running, { type: 'BREAK_ZERO' })).toBe(running);
  });

  it('APPLY replaces the state and re-seeds the numeral', () => {
    const next = reduceClock(running, {
      type: 'APPLY',
      state: { kind: 'idle', remainingMs: 80_000 },
      at: 10_000,
    });
    expect(next).toEqual({ state: { kind: 'idle', remainingMs: 80_000 }, liveMs: 80_000 });
  });

  it('APPLY of the identical state+seed is a same-store no-op (mount re-apply)', () => {
    const store = initClockStore({ kind: 'idle', remainingMs: 120_000 }, 0);
    expect(reduceClock(store, { type: 'APPLY', state: store.state, at: 50 })).toBe(store);
  });

  it('an expired store never re-enters running without an APPLY', () => {
    const expired: ClockStore = { state: { kind: 'expired' }, liveMs: 0 };
    expect(reduceClock(expired, { type: 'TICK', at: 1 })).toBe(expired);
    expect(reduceClock(expired, { type: 'RUN_ZERO' })).toBe(expired);
    expect(reduceClock(expired, { type: 'BREAK_ZERO' })).toBe(expired);
  });
});
