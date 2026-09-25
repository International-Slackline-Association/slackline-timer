import { act, renderHook } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLaneExpiry } from 'app/hooks/useLaneExpiry';
import { battleReducer, initialBattleStore, type BattleAction } from 'app/util/battleMachine';

const BUDGET = 120_000;
const BREAK = 60_000;

/**
 * Lane 1 exactly as the board mounts it: the machine plus its expiry
 * coordinator, and NO card — a lane running out is a fact about the clock, not
 * about a `Countdown` being on screen (`useWarmupExpiry.test.tsx`'s shape).
 *
 * The events are dispatched DIRECTLY rather than through a board action,
 * because the re-arm this pins has no board action: `SET_BUDGETS` re-arms
 * pristine lanes only, so a live lane's remaining is only ever corrected by the
 * wire — a `PEER_SNAPSHOT` or a duplicate `PEER_START` landing on the anchor the
 * lane already holds.
 */
const mountLane = () =>
  renderHook(() => {
    const [store, dispatch] = useReducer(battleReducer, initialBattleStore(BUDGET, 2));
    useLaneExpiry(1, store.battle[1], dispatch);
    return { store, dispatch };
  });

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLaneExpiry', () => {
  it('fires the lane TIMEOUT at its own budget end', () => {
    const { result } = mountLane();
    const at = Date.now();
    act(() => result.current.dispatch({ type: 'START', lane: 1, at }));

    advance(BUDGET - 1000);
    expect(result.current.store.battle[1].phase).toBe('running');

    advance(1000);
    expect(result.current.store.battle[1].phase).toBe('finished');
  });

  it('re-arms on a corrected remaining at the anchor it already holds', () => {
    // The timeout is identified by its DEADLINE, not by its anchor: a peer that
    // re-states this lane's start with the true remaining (the joiner case, and
    // the duplicate-start case) moves the crossing without moving `startedAt`,
    // and an effect keyed on the anchor alone would sit on the stale one.
    const { result } = mountLane();
    const at = Date.now();
    act(() => result.current.dispatch({ type: 'START', lane: 1, at }));
    advance(1000);

    const corrected: BattleAction = {
      type: 'PEER_START',
      lane: 1,
      startedAt: at,
      remainingMs: 30_000,
    };
    act(() => result.current.dispatch(corrected));

    advance(29_000 - 1);
    expect(result.current.store.battle[1].phase).toBe('running');

    advance(1);
    expect(result.current.store.battle[1].phase).toBe('finished');
  });

  it('re-arms a break the same way when its window is corrected in place', () => {
    const { result } = mountLane();
    const at = Date.now();
    act(() => result.current.dispatch({ type: 'START', lane: 1, at }));
    act(() => result.current.dispatch({ type: 'TAKE_BREAK', lane: 1, at, breakMs: BREAK }));

    // The peer's break is the same window, opened at the same epoch, but half
    // spent by the time this panel mirrors it.
    act(() =>
      result.current.dispatch({
        type: 'PEER_BREAK_START',
        lane: 1,
        startedAt: at,
        runRemainingMs: BUDGET,
        breakMs: BREAK / 2,
        breaksLeft: 1,
      }),
    );

    advance(BREAK / 2);
    expect(result.current.store.battle[1].phase).toBe('idle');
    expect(result.current.store.effects).toContainEqual({ kind: 'audio', sound: 'alert2' });
  });

  it('drops an armed crossing when the lane is stopped first', () => {
    const { result } = mountLane();
    const at = Date.now();
    act(() => result.current.dispatch({ type: 'START', lane: 1, at }));
    advance(30_000);
    act(() => result.current.dispatch({ type: 'STOP', lane: 1, at: Date.now() }));

    advance(BUDGET);
    expect(result.current.store.battle[1]).toMatchObject({ phase: 'idle', budgetMs: 90_000 });
  });
});
