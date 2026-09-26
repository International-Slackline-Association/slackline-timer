import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PEER_FLASH_MS, usePeerFlash } from 'app/hooks/usePeerFlash';

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePeerFlash', () => {
  it('stays dark while no peer event has addressed this surface', () => {
    const { result } = renderHook(() => usePeerFlash(null));
    expect(result.current).toBe(false);
    advance(PEER_FLASH_MS);
    expect(result.current).toBe(false);
  });

  it('lights up on a peer event token and auto-dismisses', () => {
    const { result, rerender } = renderHook(({ token }) => usePeerFlash(token), {
      initialProps: { token: null as number | null },
    });

    rerender({ token: 1 });
    expect(result.current).toBe(true);

    advance(PEER_FLASH_MS - 1);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it('re-fires on a repeat of the same peer action (the token is monotonic)', () => {
    const { result, rerender } = renderHook(({ token }) => usePeerFlash(token), {
      initialProps: { token: 1 as number | null },
    });
    advance(PEER_FLASH_MS);
    expect(result.current).toBe(false);

    rerender({ token: 2 });
    expect(result.current).toBe(true);
  });

  it('clears when the newest peer event belongs to another surface', () => {
    const { result, rerender } = renderHook(({ token }) => usePeerFlash(token), {
      initialProps: { token: 1 as number | null },
    });
    expect(result.current).toBe(true);

    rerender({ token: null });
    expect(result.current).toBe(false);
  });
});
