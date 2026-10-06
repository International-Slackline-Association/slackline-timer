import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchKeys } from 'app/api/matches';
import { rankingKeys } from 'app/api/rankings';

import { deliver as deliverFrames } from '../../../util/wsMock';

const { wsState, useWSMock } = vi.hoisted(() => {
  const wsState = { readyState: 0 };
  // One STABLE sendWSMessage (it sits in useStreamRefresh's effect deps; a
  // per-render identity would re-fire the on-OPEN invalidation every render).
  const sendWSMessage = vi.fn();
  return {
    wsState,
    useWSMock: vi.fn((_params: { sessionId: string }) => ({
      readyState: wsState.readyState,
      sendWSMessage,
    })),
  };
});
vi.mock('app/hooks/useWebSocket', async () => {
  const { useCapturedSocket } = await import('../../../util/wsMock');
  return {
    useWS: (params: { sessionId: string; onMessage?: (frame: never) => void }) => {
      useCapturedSocket(params);
      return useWSMock(params);
    },
  };
});

import { AdminLiveRefresh } from 'app/pages/Admin/AdminLiveRefresh';
import { SelectedCompetitionProvider } from 'app/state/selectedCompetition';

const COMP = 'worlds-2026';

const renderShell = (compId: string | null) => {
  if (compId) window.localStorage.setItem('speedline.selectedCompId', compId);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <SelectedCompetitionProvider>
        <MemoryRouter initialEntries={['/admin/rankings']}>
          <Routes>
            <Route element={<AdminLiveRefresh />}>
              <Route path="/admin/rankings" element={<div>rankings page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </SelectedCompetitionProvider>
    </QueryClientProvider>
  );
  render(tree());
  return { invalidate };
};

const invalidatedKeys = (invalidate: { mock: { calls: unknown[][] } }) =>
  invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

afterEach(() => {
  window.localStorage.clear();
  wsState.readyState = ReadyState.CONNECTING;
  useWSMock.mockClear();
});

describe('AdminLiveRefresh', () => {
  it('renders the routed admin page through its outlet', () => {
    renderShell(COMP);
    expect(screen.getByText('rankings page')).toBeInTheDocument();
  });

  it('subscribes to the selected competition relay room', () => {
    renderShell(COMP);
    expect(useWSMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: COMP }));
  });

  it('invalidates the entity branches of an incoming db_update', () => {
    wsState.readyState = ReadyState.OPEN;
    const { invalidate } = renderShell(COMP);
    invalidate.mockClear();

    deliverFrames({
      type: 'db_update',
      sessionId: COMP,
      data: { entity: 'match', action: 'updated', id: 'm1' },
    });

    expect(invalidatedKeys(invalidate)).toEqual([matchKeys.all(COMP), rankingKeys.all(COMP)]);
  });

  it('opens no relay connection when no competition is selected', () => {
    const { invalidate } = renderShell(null);
    expect(screen.getByText('rankings page')).toBeInTheDocument();
    expect(useWSMock).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
