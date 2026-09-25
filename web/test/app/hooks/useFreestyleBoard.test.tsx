import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ReadyState } from 'react-use-websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock, socket } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  // The relay link the board reads, mutable so a test can drop it mid-mount.
  socket: { readyState: 1 },
}));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  return {
    ...actual,
    useWS: () => ({
      sendWSMessage: vi.fn(),
      readyState: socket.readyState,
      lastJsonMessage: null,
      senderId: 'own-sender-id',
    }),
  };
});

import { useFreestyleBoard } from 'app/hooks/useFreestyleBoard';
import { GRACE_MS } from 'app/hooks/useStaleAfterGrace';
import { GamepadSelectionProvider } from 'app/state/gamepadSelection';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <GamepadSelectionProvider>{children}</GamepadSelectionProvider>
  </QueryClientProvider>
);

const mountBoard = () => renderHook(() => useFreestyleBoard('c1'), { wrapper });

beforeEach(() => {
  socket.readyState = ReadyState.OPEN;
});

/**
 * The board's surface is the page's whole API, so it is the one thing a later
 * round can silently widen: every plate, chip or health flag it adds arrives as
 * another key. These lock the SHAPE — named slices, nothing loose beside them —
 * so a new key has an obvious home and the return never flattens back out.
 */
describe('useFreestyleBoard — the shape it hands the page', () => {
  it('groups the board into named slices', () => {
    const { result } = mountBoard();

    expect(Object.keys(result.current).sort()).toEqual([
      'advance',
      'bestTrick',
      'chrome',
      'format',
      'lanes',
      'selection',
      'warmup',
    ]);
  });

  it('keeps nothing loose beside the slices', () => {
    const { result } = mountBoard();

    for (const [name, slice] of Object.entries(result.current)) {
      expect(typeof slice, `board.${name} is a slice`).toBe('object');
      expect(slice, `board.${name} is a slice`).not.toBeNull();
    }
  });

  it('files each machine under the slice that owns it', () => {
    const { result } = mountBoard();
    const board = result.current;

    expect(board.format.mode).toBe('quali');
    expect(board.lanes.battle[1].phase).toBe('idle');
    expect(board.bestTrick.series).toBeNull();
    expect(board.selection.recorder.round).toBe('qualification');
    expect(board.chrome.link).toBe('open');
    expect(typeof board.advance.press).toBe('function');
    expect(board.warmup.running).toBe(false);
  });

  it('files the peer cue under the surface that wears it, already routed', () => {
    // The page used to read `chrome.lastPeerEvent` and work out which lane (or
    // the selection row) the newest mirrored action addressed — board routing
    // done in the layout. Only one surface can hold the cue, so the routing has
    // one home: here, split across the two slices that render it.
    const board = mountBoard().result.current;

    expect(board.lanes.peerToken).toEqual({ 1: null, 2: null });
    expect(board.selection.peerToken).toBeNull();
    expect(board.chrome).not.toHaveProperty('lastPeerEvent');
  });
});

/**
 * The one health reading the plate and the header chip both take. The link is
 * graded, never raw OPEN (a retry flap is a blip, past the grace it is an
 * outage), and graded ONCE — the board hands the page a phase, so the two
 * surfaces that report the link cannot disagree about what it is doing.
 */
describe('useFreestyleBoard — the link reading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('holds the fault claim back through the opening handshake', () => {
    socket.readyState = ReadyState.CONNECTING;
    const { result } = mountBoard();

    expect(result.current.chrome.link).toBe('connecting');

    advance(GRACE_MS - 1);
    expect(result.current.chrome.link).toBe('connecting');
  });

  it('reports the link once it has been down past the grace, and clears on reopen', () => {
    socket.readyState = ReadyState.CLOSED;
    const { result, rerender } = mountBoard();

    advance(GRACE_MS);
    // Never reached the relay: a fault, but not a loss — nothing was receiving.
    expect(result.current.chrome.link).toBe('unreachable');

    socket.readyState = ReadyState.OPEN;
    rerender();
    expect(result.current.chrome.link).toBe('open');

    socket.readyState = ReadyState.CLOSED;
    rerender();
    advance(GRACE_MS);
    expect(result.current.chrome.link).toBe('lost');
  });
});
