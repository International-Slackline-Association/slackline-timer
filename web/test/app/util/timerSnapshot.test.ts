import { describe, expect, it } from 'vitest';

import {
  buildCountdownSnapshot,
  buildSpeedlineSnapshot,
  countdownLaneState,
  isCountdownSnapshot,
  isSpeedlineSnapshot,
  snapshotHasRun,
  speedlineLaneState,
} from 'app/util/timerSnapshot';
import type { CountdownSnapshot, SpeedlineSnapshot } from 'app/hooks/useWebSocket';

describe('buildSpeedlineSnapshot', () => {
  it('carries preview-enabled, signal phase and text verbatim', () => {
    const snap = buildSpeedlineSnapshot({
      isPreviewEnabled: false,
      now: 9_000,
      signalPhase: 2,
      text: 'FALSE START',
      timers: [
        { timerId: 1, startTime: null, stopTime: null },
        { timerId: 2, startTime: null, stopTime: null },
      ],
    });
    expect(snap.isPreviewEnabled).toBe(false);
    expect(snap.signalPhase).toBe(2);
    expect(snap.text).toBe('FALSE START');
    expect(snap.timers).toHaveLength(2);
  });

  it('carries falseStarts when present and omits the field when absent', () => {
    const withFs = buildSpeedlineSnapshot({
      isPreviewEnabled: true,
      now: 9_000,
      signalPhase: 0,
      text: '',
      timers: [{ timerId: 1, startTime: null, stopTime: null }],
      falseStarts: { 1: 2, 2: 0 },
    });
    expect(withFs.falseStarts).toEqual({ 1: 2, 2: 0 });

    const withoutFs = buildSpeedlineSnapshot({
      isPreviewEnabled: true,
      now: 9_000,
      signalPhase: 0,
      text: '',
      timers: [{ timerId: 1, startTime: null, stopTime: null }],
    });
    expect(withoutFs).not.toHaveProperty('falseStarts');
  });

  it('round-trips idle / running / finished lanes', () => {
    const snap = buildSpeedlineSnapshot({
      isPreviewEnabled: true,
      now: 9_000,
      signalPhase: 0,
      text: '',
      timers: [
        { timerId: 1, startTime: 1_000, stopTime: 5_500 },
        { timerId: 2, startTime: 1_000, stopTime: null },
      ],
    });
    expect(snap.timers[0]).toEqual({ timerId: 1, startTime: 1_000, stopTime: 5_500 });
    expect(snap.timers[1]).toEqual({ timerId: 2, startTime: 1_000, stopTime: null });
  });

  it("stamps the builder's wall clock as `at` (the snapshot's own age)", () => {
    const snap = buildSpeedlineSnapshot({
      isPreviewEnabled: true,
      now: 9_000,
      signalPhase: 0,
      text: '',
      timers: [{ timerId: 1, startTime: 1_000, stopTime: 5_500 }],
    });
    expect(snap.at).toBe(9_000);
  });
});

describe('snapshotHasRun', () => {
  const speedline = (timers: SpeedlineSnapshot['timers']): SpeedlineSnapshot => ({
    isPreviewEnabled: true,
    at: 9_000,
    signalPhase: 0,
    text: '',
    timers,
  });
  const countdown = (timers: CountdownSnapshot['timers']): CountdownSnapshot => ({
    isPreviewEnabled: true,
    timers,
  });

  it('reads a Speedline snapshot with no started lane as nothing to recover', () => {
    expect(snapshotHasRun(speedline([{ timerId: 1, startTime: null, stopTime: null }]))).toBe(
      false,
    );
  });

  it('reads a started Speedline lane — running or stopped — as a run', () => {
    expect(snapshotHasRun(speedline([{ timerId: 1, startTime: 1_000, stopTime: null }]))).toBe(
      true,
    );
    expect(snapshotHasRun(speedline([{ timerId: 1, startTime: 1_000, stopTime: 5_500 }]))).toBe(
      true,
    );
  });

  it('reads a running, part-spent or on-break countdown lane as a run', () => {
    expect(snapshotHasRun(countdown([{ timerId: 1, remainingMs: 60_000, isRunning: true }]))).toBe(
      true,
    );
    expect(
      snapshotHasRun(
        countdown([{ timerId: 1, remainingMs: 40_000, isRunning: false, armedMs: 60_000 }]),
      ),
    ).toBe(true);
    expect(
      snapshotHasRun(
        countdown([
          {
            timerId: 1,
            remainingMs: 60_000,
            isRunning: false,
            onBreak: true,
            breakRemainingMs: 30_000,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('reads a freshly armed countdown board as nothing to recover', () => {
    expect(
      snapshotHasRun(
        countdown([
          { timerId: 1, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
          { timerId: 2, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
        ]),
      ),
    ).toBe(false);
  });
});

describe('speedlineLaneState', () => {
  it('classifies a lane with no start as idle', () => {
    expect(speedlineLaneState({ timerId: 1, startTime: null, stopTime: null })).toEqual({
      kind: 'idle',
    });
  });

  it('classifies a started, unstopped lane as running', () => {
    expect(speedlineLaneState({ timerId: 1, startTime: 1_000, stopTime: null })).toEqual({
      kind: 'running',
      startTime: 1_000,
    });
  });

  it('classifies a started and stopped lane as finished with the frozen elapsed', () => {
    expect(speedlineLaneState({ timerId: 1, startTime: 1_000, stopTime: 5_500 })).toEqual({
      kind: 'finished',
      startTime: 1_000,
      stopTime: 5_500,
      elapsedMs: 4_500,
    });
  });

  it('clamps a negative elapsed (clock skew) to zero', () => {
    expect(speedlineLaneState({ timerId: 1, startTime: 5_000, stopTime: 4_000 })).toMatchObject({
      kind: 'finished',
      elapsedMs: 0,
    });
  });

  it("carries the snapshot's `at` onto the lane state when one is given", () => {
    expect(speedlineLaneState({ timerId: 1, startTime: 1_000, stopTime: null }, 9_000)).toEqual({
      kind: 'running',
      startTime: 1_000,
      assertedAt: 9_000,
    });
  });

  it('treats a stop with no start as idle (defensive)', () => {
    expect(speedlineLaneState({ timerId: 1, startTime: null, stopTime: 5_000 })).toEqual({
      kind: 'idle',
    });
  });
});

describe('buildCountdownSnapshot', () => {
  it('reports a stopped lane verbatim', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 10_000,
      timers: [
        { timerId: 1, lastRemainingMs: 90_000, isRunning: false, startedAt: null },
        { timerId: 2, lastRemainingMs: 120_000, isRunning: false, startedAt: null },
      ],
    });
    expect(snap.isPreviewEnabled).toBe(true);
    expect(snap.timers[0]).toEqual({ timerId: 1, remainingMs: 90_000, isRunning: false });
    expect(snap.timers[1]).toEqual({ timerId: 2, remainingMs: 120_000, isRunning: false });
  });

  it('epoch-adjusts a running lane for wall-clock elapsed since it started', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 13_000,
      timers: [{ timerId: 1, lastRemainingMs: 90_000, isRunning: true, startedAt: 10_000 }],
    });
    // 3s elapsed since startedAt ⇒ 90_000 - 3_000. `startedAt` becomes the
    // send-time epoch (state.now) the adjusted remaining applies to, so a
    // recovered lane anchors to it and every joiner converges.
    expect(snap.timers[0]).toEqual({
      timerId: 1,
      remainingMs: 87_000,
      isRunning: true,
      startedAt: 13_000,
    });
  });

  it('clamps a running lane that has elapsed past zero', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 200_000,
      timers: [{ timerId: 1, lastRemainingMs: 90_000, isRunning: true, startedAt: 10_000 }],
    });
    expect(snap.timers[0].remainingMs).toBe(0);
  });

  it('does not adjust a running lane missing a startedAt', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 13_000,
      timers: [{ timerId: 1, lastRemainingMs: 90_000, isRunning: true, startedAt: null }],
    });
    expect(snap.timers[0].remainingMs).toBe(90_000);
  });

  it('carries breaksLeft on a lane not on break, so a mid-run join gets the true allowance', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 13_000,
      timers: [
        { timerId: 1, lastRemainingMs: 90_000, isRunning: true, startedAt: 10_000, breaksLeft: 1 },
        // A spent allowance (0) must ride too — falsy, but not absent.
        { timerId: 2, lastRemainingMs: 120_000, isRunning: false, startedAt: null, breaksLeft: 0 },
      ],
    });
    expect(snap.timers[0]).toEqual({
      timerId: 1,
      remainingMs: 87_000,
      isRunning: true,
      startedAt: 13_000,
      breaksLeft: 1,
    });
    expect(snap.timers[1]).toEqual({
      timerId: 2,
      remainingMs: 120_000,
      isRunning: false,
      breaksLeft: 0,
    });
  });

  it('omits breaksLeft on a channel that has none (warm-up / best trick)', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 10_000,
      timers: [{ timerId: 0, lastRemainingMs: 300_000, isRunning: false, startedAt: null }],
    });
    expect(snap.timers[0]).not.toHaveProperty('breaksLeft');
  });

  it('round-trips a 3-timer [0,1,2] array (warm-up channel + both lanes)', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 20_000,
      timers: [
        { timerId: 0, lastRemainingMs: 300_000, isRunning: true, startedAt: 15_000 },
        { timerId: 1, lastRemainingMs: 90_000, isRunning: false, startedAt: null },
        { timerId: 2, lastRemainingMs: 120_000, isRunning: false, startedAt: null },
      ],
    });
    expect(snap.timers).toHaveLength(3);
    // Warm-up (timerId 0) is epoch-adjusted: 5s elapsed since startedAt, with
    // the send epoch carried as the shared recovery anchor.
    expect(snap.timers[0]).toEqual({
      timerId: 0,
      remainingMs: 295_000,
      isRunning: true,
      startedAt: 20_000,
    });
    expect(snap.timers.map((t) => countdownLaneState(t).timerId)).toEqual([0, 1, 2]);
  });
});

describe('buildCountdownSnapshot — on-break lane', () => {
  it('holds the run remaining (paused) and derives the live break clock', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 108_000,
      timers: [
        {
          timerId: 1,
          lastRemainingMs: 45_000,
          isRunning: false,
          startedAt: null,
          onBreak: true,
          breakMs: 30_000,
          breakStartedAt: 100_000,
          breaksLeft: 1,
        },
      ],
    });
    // Budget frozen at 45s (NOT adjusted — it is paused), break clock 30s - 8s =
    // 22s, with the send epoch as the shared break-clock recovery anchor.
    expect(snap.timers[0]).toEqual({
      timerId: 1,
      remainingMs: 45_000,
      isRunning: false,
      onBreak: true,
      breakRemainingMs: 22_000,
      breakStartedAt: 108_000,
      breaksLeft: 1,
    });
  });

  it('omits the break fields for a normal lane', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 10_000,
      timers: [{ timerId: 1, lastRemainingMs: 90_000, isRunning: false, startedAt: null }],
    });
    expect(snap.timers[0]).toEqual({ timerId: 1, remainingMs: 90_000, isRunning: false });
  });
});

describe('buildCountdownSnapshot — armedMs (the room’s armed budget)', () => {
  it('rides every phase, so a joiner adopts the room budget instead of its own preset', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 108_000,
      timers: [
        // Idle at its armed budget (pristine) — the case that used to make a
        // joiner misread the lane as held and re-arm the room wrong (ADR 0046).
        { timerId: 1, lastRemainingMs: 90_000, isRunning: false, startedAt: null, armedMs: 90_000 },
        // Running: `remainingMs` is spent-down, `armedMs` is what a Reset restores.
        {
          timerId: 2,
          lastRemainingMs: 60_000,
          isRunning: true,
          startedAt: 100_000,
          armedMs: 90_000,
        },
        // On break: paused budget, armed budget still along for the ride.
        {
          timerId: 3,
          lastRemainingMs: 45_000,
          isRunning: false,
          startedAt: null,
          armedMs: 90_000,
          onBreak: true,
          breakMs: 30_000,
          breakStartedAt: 100_000,
          breaksLeft: 1,
        },
      ],
    });
    expect(snap.timers.map((t) => t.armedMs)).toEqual([90_000, 90_000, 90_000]);
  });

  it('omits it on the channels that carry no armed budget (warm-up, best trick)', () => {
    const snap = buildCountdownSnapshot({
      isPreviewEnabled: true,
      now: 10_000,
      timers: [{ timerId: 0, lastRemainingMs: 300_000, isRunning: false, startedAt: null }],
    });
    expect(snap.timers[0]).not.toHaveProperty('armedMs');
  });
});

describe('countdownLaneState — armedMs', () => {
  it('passes it through, and omits it for a pre-feature sender', () => {
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 90_000, isRunning: false, armedMs: 90_000 }),
    ).toMatchObject({ armedMs: 90_000 });
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 90_000, isRunning: false }),
    ).not.toHaveProperty('armedMs');
  });
});

describe('countdownLaneState — on-break lane', () => {
  it('passes through the break fields, clamping negatives', () => {
    expect(
      countdownLaneState({
        timerId: 1,
        remainingMs: 45_000,
        isRunning: false,
        onBreak: true,
        breakRemainingMs: 22_000,
        breaksLeft: 1,
      }),
    ).toEqual({
      timerId: 1,
      remainingMs: 45_000,
      isRunning: false,
      onBreak: true,
      breakRemainingMs: 22_000,
      breaksLeft: 1,
    });
  });
});

describe('countdownLaneState — shared recovery anchors', () => {
  it('passes the run startedAt through on a running lane (and omits it when absent)', () => {
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 80_000, isRunning: true, startedAt: 5_000 }),
    ).toEqual({ timerId: 1, remainingMs: 80_000, isRunning: true, startedAt: 5_000 });
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 80_000, isRunning: true }),
    ).not.toHaveProperty('startedAt');
  });

  it('passes the break startedAt through on an on-break lane', () => {
    expect(
      countdownLaneState({
        timerId: 1,
        remainingMs: 45_000,
        isRunning: false,
        onBreak: true,
        breakRemainingMs: 22_000,
        breakStartedAt: 100_000,
        breaksLeft: 1,
      }),
    ).toMatchObject({ breakStartedAt: 100_000 });
  });
});

describe('countdownLaneState', () => {
  it('passes through remaining and running, clamping negatives to zero', () => {
    expect(countdownLaneState({ timerId: 1, remainingMs: 5_000, isRunning: true })).toEqual({
      timerId: 1,
      remainingMs: 5_000,
      isRunning: true,
    });
    expect(countdownLaneState({ timerId: 2, remainingMs: -10, isRunning: false })).toEqual({
      timerId: 2,
      remainingMs: 0,
      isRunning: false,
    });
  });

  it('passes breaksLeft through on a lane not on break (and omits it when absent)', () => {
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 5_000, isRunning: true, breaksLeft: 0 }),
    ).toEqual({
      timerId: 1,
      remainingMs: 5_000,
      isRunning: true,
      breaksLeft: 0,
    });
    expect(
      countdownLaneState({ timerId: 1, remainingMs: 5_000, isRunning: true }),
    ).not.toHaveProperty('breaksLeft');
  });
});

// cross-mode-snapshot-crosstalk: two control pages (Speedline + Freestyle) in one
// relay session both answer a preview's request_state, so a display can receive
// the OTHER mode's snapshot. The guards let each display drop the foreign one —
// without them a SpeedlineSnapshot drives countdownLaneState to NaN.
describe('snapshot mode guards', () => {
  const speedline: SpeedlineSnapshot = {
    isPreviewEnabled: true,
    signalPhase: 0,
    text: '',
    timers: [
      { timerId: 1, startTime: 1_000, stopTime: null },
      { timerId: 2, startTime: null, stopTime: null },
    ],
  };
  const countdown: CountdownSnapshot = {
    isPreviewEnabled: true,
    timers: [
      { timerId: 0, remainingMs: 300_000, isRunning: false },
      { timerId: 1, remainingMs: 90_000, isRunning: true },
    ],
  };

  it('recognises a Speedline snapshot by its numeric signalPhase', () => {
    expect(isSpeedlineSnapshot(speedline)).toBe(true);
    expect(isCountdownSnapshot(speedline)).toBe(false);
  });

  it('recognises a Countdown snapshot (no signalPhase)', () => {
    expect(isCountdownSnapshot(countdown)).toBe(true);
    expect(isSpeedlineSnapshot(countdown)).toBe(false);
  });

  it('a Speedline snapshot would NaN a countdown lane if not dropped', () => {
    // The concrete mis-render the Freestyle guard prevents: a Speedline lane has
    // no remainingMs, so countdownLaneState yields NaN.
    const foreign = countdownLaneState(
      speedline.timers[0] as unknown as CountdownSnapshot['timers'][number],
    );
    expect(Number.isNaN(foreign.remainingMs)).toBe(true);
  });
});
