import { describe, expect, it } from 'vitest';

import type { CountdownWSMessage, DbUpdateWSMessage } from 'app/hooks/useWebSocket';
import {
  clockFeedMessage,
  nextRecovery,
  type RecoveredLanes,
} from 'app/pages/Freestyle/useFreestyleTimerFeed';
import type { CountdownLaneMessage } from 'app/util/countdownClock';

// The refresh-vs-drop rule behind the display surfaces' recovery rows, tested
// off the untestable realtime hook (the raceTime/scoreInput precedent). The
// rendered consequence — a lane clock mounting on its armed budget rather than
// an invented 00:00 — is pinned in FreestyleTimerDisplay.test.tsx.
describe('nextRecovery', () => {
  const RECEIPT = 10_000;
  const armed: RecoveredLanes = { 1: { remainingMs: 120_000, isRunning: false } };

  const message = (m: CountdownLaneMessage): CountdownLaneMessage => m;

  it('refreshes a lane row from its start, anchored to the wire epoch', () => {
    const next = nextRecovery(
      armed,
      message({
        type: 'start_countdown',
        timerId: 1,
        data: { remainingMs: 120_000, startedAt: 9_000 },
      }),
      RECEIPT,
    );

    expect(next[1]).toEqual({ remainingMs: 120_000, isRunning: true, startedAt: 9_000 });
  });

  // A pre-feature sender omits the shared epoch. Resolving the receipt fallback
  // into the ROW (not at apply time) keeps a later remount from re-anchoring the
  // window to its own mount and replaying it from full.
  it('anchors an epoch-less start to the receipt clock', () => {
    const next = nextRecovery(
      {},
      message({ type: 'start_countdown', timerId: 2, data: { remainingMs: 60_000 } }),
      RECEIPT,
    );

    expect(next[2]).toEqual({ remainingMs: 60_000, isRunning: true, startedAt: RECEIPT });
  });

  it('refreshes a lane row from a stop and from a re-arm', () => {
    const stopped = nextRecovery(
      armed,
      message({ type: 'stop_countdown', timerId: 1, data: { remainingMs: 42_000 } }),
      RECEIPT,
    );
    expect(stopped[1]).toEqual({ remainingMs: 42_000, isRunning: false });

    const rearmed = nextRecovery(
      stopped,
      message({ type: 'reset_countdown', timerId: 1, data: { remainingMs: 120_000 } }),
      RECEIPT,
    );
    expect(rearmed[1]).toEqual({ remainingMs: 120_000, isRunning: false });
  });

  it('carries a quali break through the row so a remount resumes it', () => {
    const next = nextRecovery(
      armed,
      message({
        type: 'start_break',
        timerId: 1,
        data: { runRemainingMs: 42_000, breakMs: 30_000, breaksLeft: 1, startedAt: 9_000 },
      }),
      RECEIPT,
    );

    expect(next[1]).toEqual({
      remainingMs: 42_000,
      isRunning: false,
      onBreak: true,
      breakRemainingMs: 30_000,
      breakStartedAt: 9_000,
      breaksLeft: 1,
    });
  });

  it('holds the run paused when the break ends', () => {
    const next = nextRecovery(
      armed,
      message({ type: 'end_break', timerId: 1, data: { runRemainingMs: 42_000 } }),
      RECEIPT,
    );

    expect(next[1]).toEqual({ remainingMs: 42_000, isRunning: false });
  });

  // A best-trick DISARM rides a reset-to-0: there is no face to hold for a clock
  // that unmounts with the phase.
  it('drops the try row on a disarm reset', () => {
    const next = nextRecovery(
      { 3: { remainingMs: 30_000, isRunning: false } },
      message({ type: 'reset_countdown', timerId: 3, data: { remainingMs: 0 } }),
      RECEIPT,
    );

    expect(next[3]).toBeUndefined();
  });

  // Warm-up's hero is only ever mounted BY a warm-up start, so it has nothing to
  // replay — its live message just supersedes the join-time snapshot row.
  it('drops the warm-up row rather than refreshing it', () => {
    const next = nextRecovery(
      { 0: { remainingMs: 300_000, isRunning: false }, ...armed },
      message({ type: 'start_countdown', timerId: 0, data: { remainingMs: 300_000 } }),
      RECEIPT,
    );

    expect(next[0]).toBeUndefined();
    expect(next[1]).toEqual(armed[1]);
  });

  it('returns the same rows when a dropped channel holds none', () => {
    const next = nextRecovery(
      armed,
      message({ type: 'start_countdown', timerId: 0, data: { remainingMs: 300_000 } }),
      RECEIPT,
    );

    expect(next).toBe(armed);
  });
});

// xmode-freestyle-preview-foreign-snapshot: `compId` doubles as BOTH modes'
// relay session, so a Speedline control sharing the room answers this display's
// `request_state` too — with a payload that is structurally none of the
// countdown shapes. The discipline guard belongs to the feed, once, rather than
// to each clock; the rendered consequence (both lane clocks holding their armed
// budget) is pinned in FreestyleTimerDisplay.test.tsx.
describe('clockFeedMessage', () => {
  const SESSION = 'worlds-2026';

  const countdownSnapshot = {
    sessionId: SESSION,
    type: 'state_snapshot',
    data: {
      isPreviewEnabled: true,
      timers: [{ timerId: 1, remainingMs: 120_000, isRunning: false }],
    },
  } as CountdownWSMessage;

  // No per-lane `remainingMs` anywhere — applied, it would drive a lane to NaN.
  const speedlineSnapshot = {
    sessionId: SESSION,
    type: 'state_snapshot',
    data: {
      isPreviewEnabled: true,
      signalPhase: 0,
      text: '',
      timers: [{ timerId: 1, startTime: 1_000, stopTime: null }],
    },
  } as unknown as CountdownWSMessage;

  const laneStart = {
    sessionId: SESSION,
    type: 'start_countdown',
    timerId: 1,
    data: { remainingMs: 120_000 },
  } as CountdownWSMessage;

  const dbUpdate = {
    sessionId: SESSION,
    type: 'db_update',
    data: { entity: 'score', action: 'created', id: 's1' },
  } as DbUpdateWSMessage;

  it('forwards a lane message and a countdown snapshot', () => {
    expect(clockFeedMessage(laneStart)).toBe(laneStart);
    expect(clockFeedMessage(countdownSnapshot)).toBe(countdownSnapshot);
  });

  it('drops a foreign Speedline snapshot', () => {
    expect(clockFeedMessage(speedlineSnapshot)).toBeUndefined();
  });

  it('drops db_update and nothing-yet', () => {
    expect(clockFeedMessage(dbUpdate)).toBeUndefined();
    expect(clockFeedMessage(null)).toBeUndefined();
  });
});
