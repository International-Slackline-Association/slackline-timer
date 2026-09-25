import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWarmupChannel } from 'app/hooks/useWarmupChannel';
import { useWarmupExpiry } from 'app/hooks/useWarmupExpiry';

const WARMUP_S = 300;
const WARMUP_MS = WARMUP_S * 1000;

/**
 * The channel exactly as the board mounts it: the machine plus its expiry
 * coordinator, and NO card. The warm-up running out is a fact about the clock,
 * so nothing about it may depend on a `WarmupCard` (or its `Countdown`) being
 * on screen — the rail's card is presentational, like the lane cards.
 */
const mountChannel = () =>
  renderHook(() => {
    const warmup = useWarmupChannel(WARMUP_S);
    useWarmupExpiry(warmup.display, warmup.dispatch);
    return warmup;
  });

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWarmupExpiry', () => {
  it('flips the channel to expired at the crossing, with no card mounted', () => {
    const { result } = mountChannel();

    act(() => result.current.start());
    advance(WARMUP_MS - 1000);
    expect(result.current.display.kind).toBe('running');

    advance(1000);
    expect(result.current.display.kind).toBe('expired');
    expect(result.current.card.word).toBe('WARM-UP OVER');
    // The horn is queued as data for the page's drain, the way every other
    // transition's is (rule 4) — it is not played from inside the reducer.
    expect(result.current.effects).toContainEqual({ kind: 'audio', sound: 'alert' });
  });

  it('drops the armed crossing when the window is stopped first', () => {
    const { result } = mountChannel();

    act(() => result.current.start());
    advance(60_000);
    act(() => result.current.stop());

    advance(WARMUP_MS);
    expect(result.current.display.kind).toBe('idle');
    expect(result.current.card.word).toBe('STOPPED · 04:00 LEFT');
    expect(result.current.effects).not.toContainEqual({ kind: 'audio', sound: 'alert' });
  });

  it('re-arms when a peer corrects the remaining at the anchor it already holds', () => {
    // The `useLaneExpiry` rule, one channel over: the timeout is identified by
    // its deadline, so a mirrored start that re-states the window with the true
    // remaining moves the crossing even though `startedAt` never moved.
    const { result } = mountChannel();

    act(() => result.current.start());
    const startedAt = Date.now();
    advance(1000);
    act(() => result.current.dispatch({ type: 'PEER_START', startedAt, remainingMs: 30_000 }));

    advance(29_000 - 1);
    expect(result.current.display.kind).toBe('running');

    advance(1);
    expect(result.current.display.kind).toBe('expired');
  });

  it('re-arms the crossing on a restart, anchored to the new start', () => {
    const { result } = mountChannel();

    act(() => result.current.start());
    advance(60_000);
    act(() => result.current.stop());
    act(() => result.current.start());

    // The restart carries the 04:00 that was left, not the armed 05:00.
    advance(WARMUP_MS - 60_000);
    expect(result.current.display.kind).toBe('expired');
  });
});
