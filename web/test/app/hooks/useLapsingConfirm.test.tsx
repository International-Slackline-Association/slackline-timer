import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLapsingConfirm } from 'app/hooks/useLapsingConfirm';

describe('useLapsingConfirm', () => {
  it('holds nothing until something is asked', () => {
    const { result } = renderHook(() => useLapsingConfirm<number>(true));
    expect(result.current[0]).toBeNull();
  });

  it('holds what was asked while the risk stands', () => {
    const { result } = renderHook(({ atRisk }) => useLapsingConfirm<number>(atRisk), {
      initialProps: { atRisk: true },
    });
    act(() => result.current[1](7));
    expect(result.current[0]).toBe(7);
  });

  it('drops the question when the risk lapses', () => {
    const { result, rerender } = renderHook(({ atRisk }) => useLapsingConfirm<number>(atRisk), {
      initialProps: { atRisk: true },
    });
    act(() => result.current[1](7));

    rerender({ atRisk: false });
    expect(result.current[0]).toBeNull();
  });

  // A question closed by a peer event must not leave its stamp behind: the next
  // time the risk returns — the next Start, the next try — the dialog would pop
  // open with nobody having pressed anything, and take the whole handset with it
  // (`overlayOwnsBoard`, §4.8).
  it('stays closed when the risk returns, since nobody asked again', () => {
    const { result, rerender } = renderHook(({ atRisk }) => useLapsingConfirm<number>(atRisk), {
      initialProps: { atRisk: true },
    });
    act(() => result.current[1](7));

    rerender({ atRisk: false });
    rerender({ atRisk: true });
    expect(result.current[0]).toBeNull();
  });

  it('asks again on a fresh press after the risk returned', () => {
    const { result, rerender } = renderHook(({ atRisk }) => useLapsingConfirm<number>(atRisk), {
      initialProps: { atRisk: true },
    });
    act(() => result.current[1](7));
    rerender({ atRisk: false });
    rerender({ atRisk: true });

    act(() => result.current[1](9));
    expect(result.current[0]).toBe(9);
  });
});
