import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FLASH_MS, useReconnectedFlash } from 'app/hooks/useReconnectedFlash';

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useReconnectedFlash', () => {
  it('does not flash on first mount without a prior drop', () => {
    const { result } = renderHook(() => useReconnectedFlash(false));
    expect(result.current).toBe(false);
    advance(FLASH_MS);
    expect(result.current).toBe(false);
  });

  it('flashes when a stale link recovers, then auto-dismisses', () => {
    const { result, rerender } = renderHook(({ stale }) => useReconnectedFlash(stale), {
      initialProps: { stale: false },
    });

    // A real drop the badge already surfaced.
    rerender({ stale: true });
    expect(result.current).toBe(false);

    // Recovery edge: stale clears → the flash lights up.
    rerender({ stale: false });
    expect(result.current).toBe(true);

    advance(FLASH_MS - 1);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it('does not flash while the link is still stale', () => {
    const { result, rerender } = renderHook(({ stale }) => useReconnectedFlash(stale), {
      initialProps: { stale: false },
    });
    rerender({ stale: true });
    advance(FLASH_MS);
    expect(result.current).toBe(false);
  });

  it('re-arms for a second drop→recover cycle', () => {
    const { result, rerender } = renderHook(({ stale }) => useReconnectedFlash(stale), {
      initialProps: { stale: true },
    });
    rerender({ stale: false });
    expect(result.current).toBe(true);
    advance(FLASH_MS);
    expect(result.current).toBe(false);

    // A fresh drop and recovery flashes again.
    rerender({ stale: true });
    rerender({ stale: false });
    expect(result.current).toBe(true);
  });
});
