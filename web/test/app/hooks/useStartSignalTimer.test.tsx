import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BEEP_GRACE_MS,
  beepIsLive,
  PRE_BEEP_PHASE,
  signalPhaseAt,
  signalPhaseBeep,
  useStartSignalTimer,
} from 'app/hooks/useStartSignalTimer';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStartSignalTimer', () => {
  it('opens with a T-5s pre-beep phase, then runs the 3-2-1 lights 1s apart', () => {
    const onSignalComplete = vi.fn();
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete }));

    expect(result.current.currentSignalPhase).toBe(0);

    act(() => result.current.startSignal());
    // T-5s: the pre-beep cue (armed look, no lights yet).
    expect(result.current.currentSignalPhase).toBe(PRE_BEEP_PHASE);

    // The lights stay armed for the 3s gap between the pre-beep and the 2-1-GO run.
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.currentSignalPhase).toBe(PRE_BEEP_PHASE);

    // T-2s: first SET light.
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentSignalPhase).toBe(1);

    // T-1s: second SET light.
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.currentSignalPhase).toBe(2);
    expect(onSignalComplete).not.toHaveBeenCalled();

    // T-0: GO fires the race start at the 2 -> 3 transition.
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.currentSignalPhase).toBe(3);
    expect(onSignalComplete).toHaveBeenCalledTimes(1);

    // The sequence clears one tick after GO.
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.currentSignalPhase).toBe(-1);
    expect(onSignalComplete).toHaveBeenCalledTimes(1);
  });

  // The drift fix: a throttled/backgrounded tab fires the scheduled timer well
  // after its due time, so wall time has advanced past several steps by the time
  // the callback runs. Anchoring off the stored epoch must catch the sequence up
  // (past the SET lights, firing the race start) rather than stall a step behind
  // the way a tick-counting interval would.
  it('catches up and fires the race start once when the tab wakes late', () => {
    const onSignalComplete = vi.fn();
    vi.setSystemTime(0);
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete }));

    act(() => result.current.startSignal());
    expect(result.current.currentSignalPhase).toBe(PRE_BEEP_PHASE);

    // The clock jumps past GO before the first timer (armed -> set1 at T+3s) runs.
    act(() => {
      vi.setSystemTime(5_000);
      vi.advanceTimersToNextTimer();
    });
    // Caught up to GO (3) or the post-GO clear (-1) — never stuck on an early
    // SET light — and the race started exactly once regardless of how many
    // boundaries the jump crossed.
    expect([3, -1]).toContain(result.current.currentSignalPhase);
    expect(onSignalComplete).toHaveBeenCalledTimes(1);
    // The race anchors on the SCHEDULED GO epoch (anchor 0 + 5000), not the
    // late wake's Date.now() — a throttled tab must not smear the start off
    // the light schedule.
    expect(onSignalComplete).toHaveBeenCalledWith(5_000);
  });

  // A mirroring receiver seeds the sequence with the operator's RELAYED anchor
  // rather than its own clock, so every phase (and, via the consumer, every beep)
  // lands on the operator's wall-clock instants regardless of relay latency.
  it('seeds off a relayed anchor and catches up a late seed to the live phase', () => {
    const onSignalComplete = vi.fn();
    vi.setSystemTime(10_000);
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete }));

    // Anchor is 4200ms in the past (a seed that arrived late): elapsed 4200 is
    // past set2 (+4000) but before GO (+5000), so it snaps straight to set2.
    act(() => result.current.startSignal(10_000 - 4200));
    expect(result.current.currentSignalPhase).toBe(2);
    expect(result.current.signalAnchor).toBe(10_000 - 4200);

    // GO still fires on the anchor's schedule, 800ms later — and hands the
    // consumer the RELAYED schedule's GO epoch (anchor + 5000), so a mirroring
    // receiver ignites its race clock on the operator's wall-clock instant.
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.currentSignalPhase).toBe(3);
    expect(onSignalComplete).toHaveBeenCalledTimes(1);
    expect(onSignalComplete).toHaveBeenCalledWith(10_000 - 4200 + 5000);
  });

  it('exposes the wall-clock anchor set when the sequence arms', () => {
    vi.setSystemTime(10_000);
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete: vi.fn() }));

    // Idle before arming.
    expect(result.current.signalAnchor).toBe(0);

    act(() => result.current.startSignal());
    // The anchor is the epoch at which startSignal ran (the `armed` +0 offset).
    expect(result.current.signalAnchor).toBe(10_000);
  });

  // `speedline-lock-says-aborted-after-a-clean-run`: the wire keeps ONE terminal
  // value (-1) for both endings — changing it would be a protocol change — so
  // the hook carries the distinction locally, as a latch the abort sets.
  it('latches `aborted` only for an aborted sequence, never a spent one', () => {
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete: vi.fn() }));
    expect(result.current.signalAborted).toBe(false);

    // A sequence run to its end lands on the same -1 the abort latches...
    act(() => result.current.startSignal());
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentSignalPhase).toBe(-1);
    expect(result.current.signalAborted).toBe(false);

    // ...an abort (resetSignal(-1)) is the only thing that latches it.
    act(() => result.current.startSignal());
    act(() => result.current.resetSignal(-1));
    expect(result.current.currentSignalPhase).toBe(-1);
    expect(result.current.signalAborted).toBe(true);

    // A Reset re-arms the board and drops the latch with it.
    act(() => result.current.resetSignal());
    expect(result.current.signalAborted).toBe(false);
  });

  it('resetSignal during the pre-beep gap cancels the sequence', () => {
    const onSignalComplete = vi.fn();
    const { result } = renderHook(() => useStartSignalTimer({ onSignalComplete }));

    act(() => result.current.startSignal());
    expect(result.current.currentSignalPhase).toBe(PRE_BEEP_PHASE);

    act(() => result.current.resetSignal());
    expect(result.current.currentSignalPhase).toBe(0);

    // No lights or race start ever fire after a cancel.
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.currentSignalPhase).toBe(0);
    expect(onSignalComplete).not.toHaveBeenCalled();
  });
});

describe('signalPhaseAt', () => {
  it('maps elapsed-since-anchor to the named schedule phase', () => {
    expect(signalPhaseAt(-100)).toBe('idle');
    expect(signalPhaseAt(0)).toBe('armed');
    expect(signalPhaseAt(2999)).toBe('armed');
    expect(signalPhaseAt(3000)).toBe('set1');
    expect(signalPhaseAt(4000)).toBe('set2');
    expect(signalPhaseAt(5000)).toBe('go');
    expect(signalPhaseAt(6000)).toBe('cleared');
    expect(signalPhaseAt(60_000)).toBe('cleared');
  });
});

describe('signalPhaseBeep', () => {
  it('cues short beeps for the pre-beep and both SET lights, long for GO', () => {
    expect(signalPhaseBeep(PRE_BEEP_PHASE)).toBe('short');
    expect(signalPhaseBeep(1)).toBe('short');
    expect(signalPhaseBeep(2)).toBe('short');
    expect(signalPhaseBeep(3)).toBe('long');
  });

  it('is silent for the armed / cleared phases', () => {
    expect(signalPhaseBeep(0)).toBeNull();
    expect(signalPhaseBeep(-1)).toBeNull();
  });
});

describe('beepIsLive', () => {
  // Phase offsets from the anchor: pre-beep +0, set1 +3000, set2 +4000, GO +5000.
  const anchor = 0;

  it('is live at the phase instant and within the grace window past it', () => {
    // GO (offset +5000): due exactly, and still live a hair before the window closes.
    expect(beepIsLive(anchor, 3, 5000)).toBe(true);
    expect(beepIsLive(anchor, 3, 5000 + BEEP_GRACE_MS)).toBe(true);
    // set1 (offset +3000) arriving on time.
    expect(beepIsLive(anchor, 1, 3000)).toBe(true);
  });

  it('is live when the phase instant is still in the future (clock skew ahead)', () => {
    expect(beepIsLive(anchor, 3, 4000)).toBe(true);
  });

  it('mutes a beep once its instant is past the grace window (catch-up jump)', () => {
    // A late-join learns of GO a full second after it fired: silent.
    expect(beepIsLive(anchor, 3, 5000 + BEEP_GRACE_MS + 1)).toBe(false);
    expect(beepIsLive(anchor, 1, 3000 + 2000)).toBe(false);
  });

  it('never mutes an unknown/anchorless phase (falls back to sounding)', () => {
    expect(beepIsLive(anchor, 42, 10_000_000)).toBe(true);
  });
});
