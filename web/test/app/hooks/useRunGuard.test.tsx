import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRunGuard } from 'app/hooks/useRunGuard';

const fireBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  return !window.dispatchEvent(event); // dispatchEvent returns false if preventDefault was called
};

describe('useRunGuard', () => {
  it('arms the beforeunload prompt only while a run is live', () => {
    const { rerender, unmount } = renderHook(({ active }) => useRunGuard(active), {
      initialProps: { active: false },
    });

    expect(fireBeforeUnload()).toBe(false);

    rerender({ active: true });
    expect(fireBeforeUnload()).toBe(true);

    rerender({ active: false });
    expect(fireBeforeUnload()).toBe(false);

    unmount();
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useRunGuard(true));
    expect(fireBeforeUnload()).toBe(true);
    unmount();
    expect(fireBeforeUnload()).toBe(false);
  });
});
