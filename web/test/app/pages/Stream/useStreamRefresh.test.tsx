import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ReadyState } from 'react-use-websocket';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rankingKeys } from 'app/api/rankings';
import { timeKeys } from 'app/api/times';
import { allDbUpdateQueryKeys } from 'app/pages/Stream/dbUpdateInvalidation';

const { wsState, sendWSMessageMock } = vi.hoisted(() => ({
  wsState: { lastJsonMessage: null as unknown, readyState: 0 },
  sendWSMessageMock: vi.fn(),
}));
vi.mock('app/hooks/useWebSocket', () => ({
  useWS: () => ({
    lastJsonMessage: wsState.lastJsonMessage,
    readyState: wsState.readyState,
    sendWSMessage: sendWSMessageMock,
  }),
}));

import { useStreamRefresh } from 'app/pages/Stream/useStreamRefresh';

const COMP = 'laax-2026';

const renderStreamRefresh = (discipline?: 'speed' | 'freestyle') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useStreamRefresh(COMP, undefined, discipline), { wrapper });
  return { ...view, invalidate };
};

const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

afterEach(() => {
  wsState.lastJsonMessage = null;
  wsState.readyState = ReadyState.CONNECTING;
  sendWSMessageMock.mockClear();
});

describe('useStreamRefresh', () => {
  it('invalidates every db_update-reachable branch when the socket opens', () => {
    wsState.readyState = ReadyState.CONNECTING;
    const { rerender, invalidate } = renderStreamRefresh();
    expect(invalidate).not.toHaveBeenCalled();

    wsState.readyState = ReadyState.OPEN;
    rerender();

    expect(invalidatedKeys(invalidate)).toEqual(allDbUpdateQueryKeys(COMP));
  });

  it('requests the board selection on open so a late-joining overlay catches up', () => {
    wsState.readyState = ReadyState.CONNECTING;
    const { rerender } = renderStreamRefresh();
    expect(sendWSMessageMock).not.toHaveBeenCalled();

    wsState.readyState = ReadyState.OPEN;
    rerender();

    expect(sendWSMessageMock).toHaveBeenCalledWith({ type: 'request_state', data: {} });
  });

  it('does not re-request while the socket stays open', () => {
    wsState.readyState = ReadyState.OPEN;
    const { rerender } = renderStreamRefresh();
    sendWSMessageMock.mockClear();

    rerender();
    rerender();

    expect(sendWSMessageMock).not.toHaveBeenCalled();
  });

  it('does not re-invalidate while the socket stays open', () => {
    wsState.readyState = ReadyState.OPEN;
    const { rerender, invalidate } = renderStreamRefresh();
    const callsAfterOpen = invalidate.mock.calls.length;

    rerender();
    rerender();

    expect(invalidate.mock.calls.length).toBe(callsAfterOpen);
  });

  it('invalidates again on a reconnect (a db_update may have been missed)', () => {
    wsState.readyState = ReadyState.OPEN;
    const { rerender, invalidate } = renderStreamRefresh();
    invalidate.mockClear();

    wsState.readyState = ReadyState.CLOSED;
    rerender();
    expect(invalidate).not.toHaveBeenCalled();

    wsState.readyState = ReadyState.OPEN;
    rerender();
    expect(invalidatedKeys(invalidate)).toEqual(allDbUpdateQueryKeys(COMP));
  });

  it('invalidates the entity branches of an incoming db_update', () => {
    wsState.readyState = ReadyState.OPEN;
    const { rerender, invalidate } = renderStreamRefresh();
    invalidate.mockClear();

    wsState.lastJsonMessage = {
      type: 'db_update',
      sessionId: COMP,
      data: { entity: 'time', action: 'create', id: 't1' },
    };
    rerender();

    expect(invalidatedKeys(invalidate)).toEqual([timeKeys.all(COMP), rankingKeys.all(COMP)]);
  });

  it('tracks the control board selection without touching the cache', () => {
    wsState.readyState = ReadyState.OPEN;
    const { result, rerender, invalidate } = renderStreamRefresh();
    invalidate.mockClear();
    expect(result.current.selection).toBeNull();

    const selection = {
      discipline: 'speed',
      round: 'final',
      gender: 'male',
      matchId: null,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    wsState.lastJsonMessage = { type: 'updateSelection', data: selection };
    rerender();

    expect(result.current.selection).toEqual(selection);
    expect(invalidate).not.toHaveBeenCalled();
  });

  // LWW seq (ADR 0038 §4), one hop further out: crossed panel edits reach the
  // overlay in arbitrary arrival order, so it must drop the losing (stale)
  // stamp exactly like the control panels do — no flicker to the loser's value.
  it('drops a stale-stamped selection (last-writer-wins by seq)', () => {
    wsState.readyState = ReadyState.OPEN;
    const { result, rerender } = renderStreamRefresh();

    const winner = { discipline: 'speed', round: 'half', gender: 'male' };
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      senderId: 'panel-b',
      seq: 100,
      data: winner,
    };
    rerender();
    expect(result.current.selection).toEqual(winner);

    wsState.lastJsonMessage = {
      type: 'updateSelection',
      senderId: 'panel-c',
      seq: 99,
      data: { discipline: 'speed', round: 'quarter', gender: 'male' },
    };
    rerender();
    expect(result.current.selection).toEqual(winner);
  });

  // Both disciplines share one relay room. A discipline-pinned overlay must
  // ignore the other board's selection so its own pick isn't disturbed (and an
  // SVO-live card never shows the foreign athlete).
  it('ignores a foreign-discipline selection when pinned to a discipline', () => {
    wsState.readyState = ReadyState.OPEN;
    const { result, rerender } = renderStreamRefresh('freestyle');

    const own = { discipline: 'freestyle', round: 'final', gender: 'male' };
    wsState.lastJsonMessage = { type: 'updateSelection', data: own };
    rerender();
    expect(result.current.selection).toEqual(own);

    // The speed board pushes — with a HIGHER seq that would otherwise win — but
    // the freestyle overlay holds its own pick.
    wsState.lastJsonMessage = {
      type: 'updateSelection',
      senderId: 'speed-panel',
      seq: 999,
      data: { discipline: 'speed', round: 'quarter', gender: 'female' },
    };
    rerender();
    expect(result.current.selection).toEqual(own);
  });

  it('tracks both disciplines when unpinned (the H2R bridge)', () => {
    wsState.readyState = ReadyState.OPEN;
    const { result, rerender } = renderStreamRefresh(); // no discipline

    const speed = { discipline: 'speed', round: 'final', gender: 'male' };
    wsState.lastJsonMessage = { type: 'updateSelection', data: speed };
    rerender();
    expect(result.current.selection).toEqual(speed);

    const freestyle = { discipline: 'freestyle', round: 'final', gender: 'male' };
    wsState.lastJsonMessage = { type: 'updateSelection', data: freestyle };
    rerender();
    expect(result.current.selection).toEqual(freestyle);
  });

  it('still applies an unstamped (pre-feature) selection after a stamped one', () => {
    wsState.readyState = ReadyState.OPEN;
    const { result, rerender } = renderStreamRefresh();

    wsState.lastJsonMessage = {
      type: 'updateSelection',
      senderId: 'panel-b',
      seq: 100,
      data: { discipline: 'speed', round: 'half', gender: 'male' },
    };
    rerender();

    const unstamped = { discipline: 'speed', round: 'final', gender: 'female' };
    wsState.lastJsonMessage = { type: 'updateSelection', data: unstamped };
    rerender();
    expect(result.current.selection).toEqual(unstamped);
  });
});
