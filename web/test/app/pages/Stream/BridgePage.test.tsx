import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Athlete, Time } from 'app/types';

const { wsState, sendWSMessageMock } = vi.hoisted(() => ({
  // readyState 1 = ReadyState.OPEN (literal — this runs before imports resolve).
  wsState: { lastJsonMessage: null as unknown, readyState: 1 as ReadyState },
  // Stable fn: it sits in useStreamRefresh's effect deps; a per-render identity
  // would re-fire the on-OPEN invalidation every render.
  sendWSMessageMock: vi.fn(),
}));
vi.mock('app/hooks/useWebSocket', () => ({
  useWS: () => ({
    lastJsonMessage: wsState.lastJsonMessage,
    readyState: wsState.readyState,
    sendWSMessage: sendWSMessageMock,
  }),
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('app/util/h2rClient', () => ({ pushToH2r: pushMock }));

import { BridgePage } from 'app/pages/Stream/BridgePage';

const COMP = 'worlds-2026';

const athlete = (athleteId: string, name: string, over: Partial<Athlete> = {}): Athlete => ({
  athleteId,
  compId: COMP,
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
  ...over,
});

const selectionMessage = (data: {
  discipline: 'speed' | 'freestyle';
  round: string;
  athlete1Id: string | null;
  athlete2Id: string | null;
}) => ({ type: 'updateSelection', data: { gender: 'male', matchId: null, ...data } });

const renderBridge = (path: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/stream/bridge" element={<BridgePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(() => {
  apiFetchMock.mockReset();
  pushMock.mockClear();
  wsState.lastJsonMessage = null;
  wsState.readyState = ReadyState.OPEN;
  vi.useRealTimers();
});

describe('BridgePage', () => {
  it('pushes resolved name/result for the live selection to the H2R target', async () => {
    wsState.lastJsonMessage = selectionMessage({
      discipline: 'speed',
      round: 'final',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    });
    const times: Time[] = [
      { timeId: 't1', compId: COMP, athleteId: 'a1', round: 'final', timeMs: 83_450, startTime: 1 },
    ];
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/athletes'))
        return Promise.resolve([athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')]);
      if (path.includes('/times')) return Promise.resolve(times);
      throw new Error(`unexpected ${path}`);
    });

    renderBridge(`/stream/bridge?compId=${COMP}&token=tok-1&h2r=http://127.0.0.1:4001`);

    // Wait until the resolved push lands (the first push fires before the queries
    // settle, so assert on the latest once the name is populated).
    await vi.waitFor(() => {
      const last = pushMock.mock.calls.at(-1);
      const name = last?.[1].find((p: { path: string }) => p.path === '/updateVariableText/name_1');
      expect(name?.body.text).toBe('Jane Doe');
    });
    const [target, posts] = pushMock.mock.calls.at(-1) ?? [];
    expect(target).toBe('http://127.0.0.1:4001');
    expect(posts).toContainEqual({
      kind: 'text',
      path: '/updateVariableText/result_1',
      body: { text: '1:23.45' },
    });
  });

  it('defaults the target to localhost:4001 when no ?h2r is given', async () => {
    wsState.lastJsonMessage = selectionMessage({
      discipline: 'speed',
      round: 'final',
      athlete1Id: 'a1',
      athlete2Id: null,
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (path.includes('/athletes')) return Promise.resolve([athlete('a1', 'Jane Doe')]);
      if (path.includes('/times')) return Promise.resolve([]);
      throw new Error(`unexpected ${path}`);
    });

    renderBridge(`/stream/bridge?compId=${COMP}&token=tok-1`);

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:4001');
  });

  it('shows the operator a status panel (it is a control tab, not an OBS source)', () => {
    apiFetchMock.mockResolvedValue([]);
    renderBridge(`/stream/bridge?compId=${COMP}&token=tok-1`);
    expect(screen.getByText('H2R Graphics bridge')).toBeInTheDocument();
  });

  it('shows a CONNECTED chip while the relay socket is open', () => {
    apiFetchMock.mockResolvedValue([]);
    renderBridge(`/stream/bridge?compId=${COMP}&token=tok-1`);
    expect(screen.getByText('CONNECTED')).toBeInTheDocument();
  });

  it('flips to RECONNECTING once the relay socket has been down past the grace period', () => {
    vi.useFakeTimers();
    wsState.readyState = ReadyState.CLOSED;
    apiFetchMock.mockResolvedValue([]);
    renderBridge(`/stream/bridge?compId=${COMP}&token=tok-1`);

    // Grace window: still reads as connected so a keepalive blip doesn't flap it.
    expect(screen.getByText('CONNECTED')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('RECONNECTING')).toBeInTheDocument();
  });
});
