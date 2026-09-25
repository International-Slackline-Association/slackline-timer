import { describe, expect, it } from 'vitest';

import type { CountdownSnapshot } from 'app/hooks/useWebSocket';
import { nextWarmupSurface, type WarmupSurface } from 'app/util/warmupSurface';

type LiveType =
  'start_countdown' | 'stop_countdown' | 'reset_countdown' | 'start_break' | 'end_break';

const live = (current: WarmupSurface, type: LiveType, timerId: number) =>
  nextWarmupSurface({ kind: 'live', current, action: { type, timerId } });

const snapshot = (timers: CountdownSnapshot['timers']) =>
  nextWarmupSurface({ kind: 'snapshot', timers });

describe('nextWarmupSurface — live message stream', () => {
  it('a warm-up start (re)claims the surface', () => {
    expect(live('lanes', 'start_countdown', 0)).toBe('warmup');
    expect(live('warmup', 'start_countdown', 0)).toBe('warmup');
    expect(live('unseeded', 'start_countdown', 0)).toBe('warmup');
  });

  it('a warm-up stop hands the surface off to the armed lanes (post-warmup-handoff)', () => {
    expect(live('warmup', 'stop_countdown', 0)).toBe('lanes');
  });

  it('a warm-up reset only re-arms the clock — the current surface stands', () => {
    expect(live('warmup', 'reset_countdown', 0)).toBe('warmup');
    expect(live('lanes', 'reset_countdown', 0)).toBe('lanes');
  });

  it('a competition action — a lane run, a best-trick try, a break — takes the surface over', () => {
    expect(live('warmup', 'start_countdown', 1)).toBe('lanes');
    expect(live('warmup', 'start_countdown', 2)).toBe('lanes');
    expect(live('warmup', 'start_countdown', 3)).toBe('lanes');
    expect(live('warmup', 'start_break', 1)).toBe('lanes');
  });

  it('a lane stop / break end / lane reset leaves the surface as-is', () => {
    expect(live('warmup', 'stop_countdown', 1)).toBe('warmup');
    expect(live('lanes', 'stop_countdown', 1)).toBe('lanes');
    expect(live('warmup', 'end_break', 1)).toBe('warmup');
    expect(live('warmup', 'reset_countdown', 2)).toBe('warmup');
  });

  // The unseeded surface has no presumption to stand on, so the channel that
  // spoke decides: a warm-up re-arm means the warm-up is what is next, while a
  // lane/try message — a `Set both lanes` reset included — is a competition
  // channel, and the fail-safe there is the athletes, never a fabricated hero.
  it('seeds an unseeded surface off the channel that spoke', () => {
    expect(live('unseeded', 'reset_countdown', 0)).toBe('warmup');
    expect(live('unseeded', 'stop_countdown', 0)).toBe('lanes');
    expect(live('unseeded', 'reset_countdown', 1)).toBe('lanes');
    expect(live('unseeded', 'reset_countdown', 2)).toBe('lanes');
    expect(live('unseeded', 'stop_countdown', 1)).toBe('lanes');
    expect(live('unseeded', 'end_break', 1)).toBe('lanes');
  });
});

describe('nextWarmupSurface — snapshot re-derivation (late joiner)', () => {
  const warmupRow = (remainingMs: number, isRunning: boolean, armedMs?: number) => ({
    timerId: 0,
    remainingMs,
    isRunning,
    ...(armedMs != null ? { armedMs } : {}),
  });
  const idleLanes = [
    { timerId: 1, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
    { timerId: 2, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
  ];

  it('a RUNNING warm-up with time-to-go always shows, even over a busy lane', () => {
    expect(snapshot([warmupRow(100_000, true), ...idleLanes])).toBe('warmup');
    expect(
      snapshot([warmupRow(100_000, true), { timerId: 1, remainingMs: 60_000, isRunning: true }]),
    ).toBe('warmup');
  });

  it('a pending warm-up shows while the competition has not started', () => {
    expect(snapshot([warmupRow(300_000, false), ...idleLanes])).toBe('warmup');
  });

  it('a pending warm-up yields once the competition is under way (running / on-break / spent lane)', () => {
    expect(
      snapshot([warmupRow(300_000, false), { timerId: 1, remainingMs: 60_000, isRunning: true }]),
    ).toBe('lanes');
    expect(
      snapshot([
        warmupRow(300_000, false),
        {
          timerId: 1,
          remainingMs: 60_000,
          isRunning: false,
          onBreak: true,
          breakRemainingMs: 10_000,
          breaksLeft: 0,
        },
      ]),
    ).toBe('lanes');
    // Lanes always snapshot with their armed budget, so 0 means it ran out.
    expect(
      snapshot([warmupRow(300_000, false), { timerId: 1, remainingMs: 0, isRunning: false }]),
    ).toBe('lanes');
  });

  // `armedMs` rides the countdown row (ADR 0046 §2), so a lane holding less than
  // it was armed to is a half-spent budget — the match is under way and the
  // warm-up hero must not paint over the athletes on a mid-match join.
  it('a lane holding less than its armed budget is competition-under-way', () => {
    expect(
      snapshot([
        warmupRow(300_000, false),
        { timerId: 1, remainingMs: 45_000, isRunning: false, armedMs: 120_000 },
        { timerId: 2, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
      ]),
    ).toBe('lanes');
  });

  // The try clock's row rides the snapshot only while the best-trick series is
  // armed (useFreestyleBoard's buildSnapshot), so its mere presence — even a
  // full window between tries — is the battle's final phase in progress.
  it('a present try clock is competition-under-way', () => {
    expect(
      snapshot([
        warmupRow(300_000, false),
        ...idleLanes,
        { timerId: 3, remainingMs: 30_000, isRunning: false },
      ]),
    ).toBe('lanes');
  });

  it('remainingMs is the authority: a spent warm-up still flagged running is expired-and-cleared (warmup-hold-late-joiner-post-expiry-divergence)', () => {
    expect(snapshot([warmupRow(0, true), ...idleLanes])).toBe('lanes');
  });

  // fsux-preview-surface-peer-snapshot commit 2: the warm-up row now carries its
  // `armedMs` too (ADR 0046 §2), so "pending" narrows to a PRISTINE window. A
  // window the operator stopped part-way is spent — the normal way a warm-up
  // ends — and the lanes own the surface; a pre-feature sender omits the field
  // and keeps the old reading.
  it('a resting warm-up below its armed budget is spent — the lanes own the surface', () => {
    expect(snapshot([warmupRow(240_000, false, 300_000), ...idleLanes])).toBe('lanes');
  });

  it('a resting warm-up AT its armed budget is pending', () => {
    expect(snapshot([warmupRow(300_000, false, 300_000), ...idleLanes])).toBe('warmup');
  });

  it('no armedMs (pre-feature sender) keeps the pending reading', () => {
    expect(snapshot([warmupRow(240_000, false), ...idleLanes])).toBe('warmup');
  });

  // A RUNNING warm-up is self-evidently mid-window, so it is below its armed
  // budget by definition — `armedMs` must not unseat it.
  it('a running warm-up below its armed budget still shows', () => {
    expect(snapshot([warmupRow(100_000, true, 300_000), ...idleLanes])).toBe('warmup');
  });

  it('a spent or absent warm-up never claims the surface', () => {
    expect(snapshot([warmupRow(0, false), ...idleLanes])).toBe('lanes');
    expect(snapshot(idleLanes)).toBe('lanes');
  });
});
