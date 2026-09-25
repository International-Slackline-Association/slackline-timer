import { act, renderHook } from '@testing-library/react';
import { ReadyState } from 'react-use-websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { GRACE_MS } from 'app/hooks/useStaleAfterGrace';

/**
 * The board's one link grader. Two facts cross here — how long the link has
 * been down and whether it was ever up — and every surface that reports the
 * link (the header's chip, the plate's sub-line) reads the result rather than
 * grading `readyState` again on its own.
 */
describe('useLinkPhase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('reads a live socket as open', () => {
    const { result } = renderHook(() => useLinkPhase(ReadyState.OPEN));
    expect(result.current).toBe('open');
  });

  it('grades a first handshake connecting, then unreachable', () => {
    // A fresh board (every Hosted-UI redirect lands on one) has lost nothing —
    // and has no run to promise "clocks keep running" over.
    const { result } = renderHook(() => useLinkPhase(ReadyState.CONNECTING));
    expect(result.current).toBe('connecting');

    advance(GRACE_MS + 1);
    expect(result.current).toBe('unreachable');
  });

  it('grades a drop reconnecting, then lost', () => {
    const { result, rerender } = renderHook(({ rs }) => useLinkPhase(rs), {
      initialProps: { rs: ReadyState.OPEN },
    });

    rerender({ rs: ReadyState.CLOSED });
    expect(result.current).toBe('reconnecting');

    advance(GRACE_MS + 1);
    expect(result.current).toBe('lost');
  });

  it('tells the same not-OPEN socket apart by its history, and clears on reopen', () => {
    const { result, rerender } = renderHook(({ rs }) => useLinkPhase(rs), {
      initialProps: { rs: ReadyState.CONNECTING },
    });
    advance(GRACE_MS + 1);
    expect(result.current).toBe('unreachable');

    rerender({ rs: ReadyState.OPEN });
    expect(result.current).toBe('open');

    // Same readyState as the first leg, different history: now something WAS lost.
    rerender({ rs: ReadyState.CONNECTING });
    expect(result.current).toBe('reconnecting');
    advance(GRACE_MS + 1);
    expect(result.current).toBe('lost');
  });
});
