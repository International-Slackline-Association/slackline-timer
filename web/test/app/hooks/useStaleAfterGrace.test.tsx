import { act, renderHook } from '@testing-library/react';
import { ReadyState } from 'react-use-websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GRACE_MS, useStaleAfterGrace } from 'app/hooks/useStaleAfterGrace';

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStaleAfterGrace', () => {
  it('is not stale while the socket is open', () => {
    const { result } = renderHook(() => useStaleAfterGrace(ReadyState.OPEN));
    advance(60_000);
    expect(result.current).toBe(false);
  });

  it('turns stale only after the socket has been down past the grace period', () => {
    const { result } = renderHook(() => useStaleAfterGrace(ReadyState.CLOSED));
    expect(result.current).toBe(false);

    advance(GRACE_MS - 1);
    expect(result.current).toBe(false);

    advance(1);
    expect(result.current).toBe(true);
  });

  it('does not reset the grace timer across reconnect-attempt state flaps', () => {
    const { result, rerender } = renderHook(({ rs }) => useStaleAfterGrace(rs), {
      initialProps: { rs: ReadyState.CLOSED },
    });
    advance(3_000);
    // CLOSED → CONNECTING (a retry) is still "not open" — the clock keeps running.
    rerender({ rs: ReadyState.CONNECTING });
    advance(2_000);
    expect(result.current).toBe(true);
  });

  it('clears immediately when the socket reopens', () => {
    const { result, rerender } = renderHook(({ rs }) => useStaleAfterGrace(rs), {
      initialProps: { rs: ReadyState.CLOSED },
    });
    advance(GRACE_MS);
    expect(result.current).toBe(true);

    rerender({ rs: ReadyState.OPEN });
    expect(result.current).toBe(false);
  });
});
