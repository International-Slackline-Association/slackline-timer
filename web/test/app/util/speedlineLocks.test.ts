import { describe, expect, it } from 'vitest';

import {
  RESUME_GRACE_MS,
  resumeWindowDeadline,
  speedlineLocks,
  type SpeedlineLockInput,
} from 'app/util/speedlineLocks';

const idle: SpeedlineLockInput = {
  connected: true,
  signalPhase: 0,
  aborted: false,
  now: 0,
  laneState: { 1: { kind: 'idle' }, 2: { kind: 'idle' } },
};

const running = { kind: 'running', startTime: 1_000 } as const;
const finished = (stopTime: number) =>
  ({ kind: 'finished', startTime: 1_000, stopTime, elapsedMs: stopTime - 1_000 }) as const;

describe('speedlineLocks', () => {
  it('leaves Start and Reset live on an armed, connected board', () => {
    const locks = speedlineLocks(idle);

    expect(locks.start).toBeNull();
    expect(locks.reset).toBeNull();
    // Nothing to abort until a sequence is armed — the one lock a resting board
    // carries, and the reason the operator would otherwise guess at.
    expect(locks.abort).toBe('no start sequence to abort');
  });

  it('names the light sequence while it runs, and Abort is the live one', () => {
    const locks = speedlineLocks({ ...idle, signalPhase: 2 });

    expect(locks.start).toBe('locked while the start sequence runs');
    expect(locks.reset).toBe('locked while the start sequence runs');
    expect(locks.abort).toBeNull();
  });

  it('names the running lane once the clocks are away', () => {
    const locks = speedlineLocks({
      ...idle,
      laneState: { 1: running, 2: { kind: 'idle' } },
    });

    expect(locks.start).toBe('locked while a lane runs');
    expect(locks.reset).toBe('locked while a lane runs');
  });

  it('explains the dead Start after an abort — the board waits for a Reset', () => {
    const locks = speedlineLocks({ ...idle, signalPhase: -1, aborted: true });

    expect(locks.start).toBe('start aborted — Reset to re-arm');
    expect(locks.reset).toBeNull();
    expect(locks.abort).toBe('no start sequence to abort');
  });

  // `speedline-lock-says-aborted-after-a-clean-run`: the schedule's terminal
  // phase IS -1, so the SAME wire value ends a clean sequence and latches an
  // abort. The abort latch — not the phase — is what tells them apart, and the
  // board must never blame a false start that never happened.
  it.each([
    [false, 'sequence finished — Reset to re-arm'],
    [true, 'start aborted — Reset to re-arm'],
  ])('words a spent (-1, aborted=%s) sequence as its own state', (aborted, reason) => {
    expect(speedlineLocks({ ...idle, signalPhase: -1, aborted }).start).toBe(reason);
  });

  it('blames the link first, so a dead relay never reads as a live race', () => {
    const locks = speedlineLocks({ ...idle, connected: false, signalPhase: 2 });

    for (const lock of [locks.start, locks.abort, locks.reset]) {
      expect(lock).toBe('locked while the console is not connected');
    }
  });

  it('arms each lane Stop on its own clock, link down or not', () => {
    // A running lane must always be stoppable: the clocks are browser-local
    // (FREESTYLE_BOARD_UX §4.13), so a reconnecting relay may not strand a
    // finishing athlete.
    const locks = speedlineLocks({
      ...idle,
      connected: false,
      laneState: { 1: running, 2: { kind: 'idle' } },
    });

    expect(locks.stop[1]).toBeNull();
    expect(locks.stop[2]).toBe('Lane 2 is not running');
  });

  it('leaves the lane swap live between runs and names the run that takes it', () => {
    expect(speedlineLocks(idle).swap).toBeNull();
    expect(speedlineLocks({ ...idle, signalPhase: 2 }).swap).toBe(
      'locked while the start sequence runs',
    );
    expect(speedlineLocks({ ...idle, laneState: { 1: running, 2: { kind: 'idle' } } }).swap).toBe(
      'locked while a lane runs',
    );
  });

  it('keeps the swap out of the link lock — it is athlete bookkeeping, not a send', () => {
    expect(speedlineLocks({ ...idle, connected: false }).swap).toBeNull();
  });

  it('re-arms the swap after an abort, alongside the Reset that re-arms the board', () => {
    // -1 latches Start dead, but no clock is away: this is exactly the moment an
    // operator fixes the sides before pressing Reset.
    expect(speedlineLocks({ ...idle, signalPhase: -1, aborted: true }).swap).toBeNull();
  });

  it('locks a finished lane out of a second stop', () => {
    const locks = speedlineLocks({
      ...idle,
      laneState: { 1: finished(2_000), 2: { kind: 'idle' } },
    });

    expect(locks.stop[1]).toBe('Lane 1 is not running');
  });
});

/**
 * `speedline-resume-stopped-lane`: a mis-pressed Stop is undoable while the run
 * is still the board's live run — the other lane is away, or the last stop is
 * inside the grace (a solo quali run has no second clock to hold the window).
 */
describe('speedlineLocks resume', () => {
  it('offers no resume for a lane that never stopped', () => {
    const locks = speedlineLocks({ ...idle, laneState: { 1: running, 2: { kind: 'idle' } } });

    expect(locks.resume[1]).toBe('Lane 1 is not stopped');
    expect(locks.resume[2]).toBe('Lane 2 is not stopped');
  });

  it('arms a stopped lane while the other one is still away', () => {
    const locks = speedlineLocks({
      ...idle,
      // Far past the grace: the running lane alone keeps the run live.
      now: 10_000_000,
      laneState: { 1: finished(4_000), 2: running },
    });

    expect(locks.resume[1]).toBeNull();
    expect(locks.resume[2]).toBe('Lane 2 is not stopped');
  });

  it('holds the window open for the grace after the last stop of a solo run', () => {
    const lanes = { 1: finished(4_000), 2: { kind: 'idle' } } as const;

    expect(speedlineLocks({ ...idle, now: 4_000, laneState: lanes }).resume[1]).toBeNull();
    expect(
      speedlineLocks({ ...idle, now: 4_000 + RESUME_GRACE_MS - 1, laneState: lanes }).resume[1],
    ).toBeNull();
  });

  it('sends the operator to Void once the run has resolved', () => {
    const locks = speedlineLocks({
      ...idle,
      now: 4_000 + RESUME_GRACE_MS,
      laneState: { 1: finished(4_000), 2: finished(3_000) },
    });

    expect(locks.resume[1]).toBe('run has resolved — Void or re-run instead');
    expect(locks.resume[2]).toBe('run has resolved — Void or re-run instead');
  });

  // Resume is the undo of Stop, and Stop is the one control the link may not
  // take away (§4.13) — the athlete is still on the line either way.
  it('keeps resume out of the link lock, like the Stop it undoes', () => {
    const locks = speedlineLocks({
      ...idle,
      connected: false,
      laneState: { 1: finished(4_000), 2: running },
    });

    expect(locks.resume[1]).toBeNull();
  });
});

describe('resumeWindowDeadline', () => {
  it('is open-ended (null) while a lane still runs', () => {
    expect(resumeWindowDeadline({ 1: finished(4_000), 2: running })).toBeNull();
  });

  it('is null with nothing stopped to resume', () => {
    expect(resumeWindowDeadline({ 1: { kind: 'idle' }, 2: { kind: 'idle' } })).toBeNull();
  });

  it('closes one grace after the LAST stop', () => {
    expect(resumeWindowDeadline({ 1: finished(4_000), 2: finished(6_000) })).toBe(
      6_000 + RESUME_GRACE_MS,
    );
  });
});
