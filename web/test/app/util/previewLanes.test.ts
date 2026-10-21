import { describe, expect, it } from 'vitest';

import type { SpeedlineSnapshot, StopwatchWSMessage } from 'app/hooks/useWebSocket';
import {
  INITIAL_PREVIEW_LANES,
  type PreviewLaneEvent,
  type PreviewLanes,
  previewLanesReducer,
} from 'app/util/previewLanes';

const S = 'worlds-2026';
const start = (startTime: number, lanes = [1, 2]): StopwatchWSMessage => ({
  type: 'start',
  sessionId: S,
  data: { startTime, lanes },
});
const stop = (timerId: number, stopTime: number): StopwatchWSMessage => ({
  type: 'stop',
  sessionId: S,
  data: { timerId, stopTime },
});
const resume = (timerId: number): StopwatchWSMessage => ({
  type: 'resume',
  sessionId: S,
  data: { timerId },
});
const reset: StopwatchWSMessage = { type: 'reset', sessionId: S, data: {} };
const snapshot = (timers: SpeedlineSnapshot['timers'], at?: number): StopwatchWSMessage => ({
  type: 'state_snapshot',
  sessionId: S,
  data: { isPreviewEnabled: true, signalPhase: 0, text: '', timers, ...(at != null ? { at } : {}) },
});
const row = (timerId: number, startTime: number | null, stopTime: number | null = null) => ({
  timerId,
  startTime,
  stopTime,
});

const run = (...events: PreviewLaneEvent[]): PreviewLanes =>
  events.reduce(previewLanesReducer, INITIAL_PREVIEW_LANES);

const idle = (clearedStart: number | null = null) => ({ kind: 'idle', clearedStart }) as const;
const running = (startTime: number) => ({ kind: 'running', startTime }) as const;
const finished = (startTime: number, stopTime: number) =>
  ({ kind: 'finished', startTime, stopTime, elapsedMs: stopTime - startTime }) as const;

describe('previewLanesReducer — live frames', () => {
  it.each<[string, PreviewLaneEvent[], PreviewLanes]>([
    ['starts both listed lanes', [start(1_000)], { 1: running(1_000), 2: running(1_000) }],
    [
      'keeps a lane a solo start leaves out dormant',
      [start(1_000, [1])],
      { 1: running(1_000), 2: idle() },
    ],
    [
      'clears a prior frozen time off the dormant lane of a solo start',
      [start(1_000), stop(2, 5_000), start(9_000, [1])],
      { 1: running(9_000), 2: idle(1_000) },
    ],
    [
      'freezes the stopped lane on the control-minted stop epoch',
      [start(1_000), stop(1, 1_030)],
      { 1: finished(1_000, 1_030), 2: running(1_000) },
    ],
    [
      'stops every running lane on a session stop (timerId -1)',
      [start(1_000), stop(-1, 2_000)],
      { 1: finished(1_000, 2_000), 2: finished(1_000, 2_000) },
    ],
    ['ignores a stop on an idle lane', [stop(1, 1_030)], INITIAL_PREVIEW_LANES],
    [
      'ignores a second stop on a frozen lane',
      [start(1_000), stop(1, 1_030), stop(1, 9_000)],
      { 1: finished(1_000, 1_030), 2: running(1_000) },
    ],
    [
      'resumes a frozen lane off its original start epoch',
      [start(1_000), stop(1, 1_030), resume(1)],
      { 1: running(1_000), 2: running(1_000) },
    ],
    [
      'ignores a resume of a lane a reset cleared',
      [start(1_000), stop(1, 1_030), reset, resume(1)],
      { 1: idle(1_000), 2: idle(1_000) },
    ],
    [
      'resets every lane, keeping the cleared run as the watermark',
      [start(1_000), stop(1, 1_030), reset],
      { 1: idle(1_000), 2: idle(1_000) },
    ],
  ])('%s', (_name, events, expected) => {
    expect(run(...events)).toEqual(expected);
  });

  it('returns the same state for a same-epoch start confirmation (the ignition already ran)', () => {
    const ignited = run({ type: 'ignite', lanes: [1, 2], goEpoch: 1_000 });
    expect(previewLanesReducer(ignited, start(1_000))).toBe(ignited);
  });

  it.each<StopwatchWSMessage>([
    { type: 'updatePreview', sessionId: S, data: { enabled: false } },
    { type: 'updateText', sessionId: S, data: { text: 'FALSE START' } },
    { type: 'updateSignalPhase', sessionId: S, data: { currentPhase: -1 } },
    { type: 'request_state', sessionId: S, data: {} },
  ])('leaves the lanes untouched on a non-lane frame ($type)', (frame) => {
    const state = run(start(1_000));
    expect(previewLanesReducer(state, frame)).toBe(state);
  });

  it('drops a Freestyle snapshot sharing the room', () => {
    const state = run(start(1_000));
    const countdown = {
      type: 'state_snapshot',
      sessionId: S,
      data: { isPreviewEnabled: true, timers: [{ timerId: 1, remainingMs: 1, isRunning: false }] },
    } as unknown as StopwatchWSMessage;
    expect(previewLanesReducer(state, countdown)).toBe(state);
  });
});

describe('previewLanesReducer — snapshot merge (newer wins per lane)', () => {
  it('takes the snapshot on a fresh display (the late-join case)', () => {
    expect(run(snapshot([row(1, 1_000), row(2, 1_000, 4_000)], 5_000))).toEqual({
      1: running(1_000),
      2: finished(1_000, 4_000),
    });
  });

  it('takes a later run over the one the display holds', () => {
    expect(run(start(1_000), snapshot([row(1, 9_000), row(2, 9_000)], 9_500))).toEqual({
      1: running(9_000),
      2: running(9_000),
    });
  });

  it('keeps live state over a stale snapshot of an older run', () => {
    const live = run(start(9_000));
    expect(previewLanesReducer(live, snapshot([row(1, 1_000, 2_000), row(2, 1_000)]))).toBe(live);
  });

  it('keeps a lane over an idle snapshot row (ambiguous, not newer)', () => {
    const live = run(start(1_000));
    expect(previewLanesReducer(live, snapshot([row(1, null), row(2, null)], 2_000))).toBe(live);
  });

  it('freezes a running lane whose stop the display missed', () => {
    expect(run(start(1_000), snapshot([row(1, 1_000, 4_000), row(2, 1_000)], 5_000))).toEqual({
      1: finished(1_000, 4_000),
      2: running(1_000),
    });
  });

  it('un-freezes a lane on a snapshot asserted after the stop it applied', () => {
    expect(
      run(start(1_000), stop(1, 4_000), snapshot([row(1, 1_000), row(2, 1_000)], 5_000)),
    ).toEqual({ 1: running(1_000), 2: running(1_000) });
  });

  it.each([
    ['asserted before that stop', 3_000],
    ['unstamped (pre-feature sender)', undefined],
  ])('leaves a frozen lane frozen on a snapshot %s', (_name, at) => {
    expect(
      run(start(1_000), stop(1, 4_000), snapshot([row(1, 1_000), row(2, 1_000)], at))[1],
    ).toEqual(finished(1_000, 4_000));
  });

  it('does not revive a run a reset cleared from a snapshot built before the reset', () => {
    expect(run(start(1_000), reset, snapshot([row(1, 1_000), row(2, 1_000)], 900))).toEqual({
      1: idle(1_000),
      2: idle(1_000),
    });
  });

  it('treats a missing lane row as idle', () => {
    expect(run(snapshot([row(1, 1_000)], 2_000))).toEqual({ 1: running(1_000), 2: idle() });
  });
});

describe('previewLanesReducer — GO ignition', () => {
  it('ignites the seeded lanes on the schedule epoch, leaving the others', () => {
    expect(run({ type: 'ignite', lanes: [1], goEpoch: 6_000 })).toEqual({
      1: running(6_000),
      2: idle(),
    });
  });

  it('ignites past a reset (the new run is newer than the cleared one)', () => {
    expect(run(start(1_000), reset, { type: 'ignite', lanes: [1, 2], goEpoch: 9_000 })).toEqual({
      1: running(9_000),
      2: running(9_000),
    });
  });

  it('does not restart a lane the authoritative start already runs', () => {
    const live = run(start(6_000));
    expect(previewLanesReducer(live, { type: 'ignite', lanes: [1, 2], goEpoch: 6_000 })).toBe(live);
  });
});
