import { renderHook } from '@testing-library/react';
import { ReadyState } from 'react-use-websocket';
import { describe, expect, it } from 'vitest';

import { useHasEverOpened } from 'app/hooks/useHasEverOpened';

describe('useHasEverOpened', () => {
  it('is false while the first handshake is still in flight', () => {
    const { result } = renderHook(() => useHasEverOpened(ReadyState.CONNECTING));
    expect(result.current).toBe(false);
  });

  it('latches on the first OPEN', () => {
    const { result, rerender } = renderHook(({ rs }) => useHasEverOpened(rs), {
      initialProps: { rs: ReadyState.CONNECTING },
    });
    rerender({ rs: ReadyState.OPEN });
    expect(result.current).toBe(true);
  });

  it('stays latched once the link drops', () => {
    // The whole point: after a drop the socket reads exactly like a first
    // handshake, and only this flag tells the two apart.
    const { result, rerender } = renderHook(({ rs }) => useHasEverOpened(rs), {
      initialProps: { rs: ReadyState.OPEN },
    });
    rerender({ rs: ReadyState.CLOSED });
    rerender({ rs: ReadyState.CONNECTING });
    expect(result.current).toBe(true);
  });
});
