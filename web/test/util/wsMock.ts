import { act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ReadyState } from 'react-use-websocket';
import { vi } from 'vitest';

import { isRelayFrame } from 'app/hooks/wsFrameGuard';

/**
 * Stand-in for `app/hooks/useWebSocket` (jsdom has no relay). Wire it with
 *
 *   vi.mock('app/hooks/useWebSocket', () => import('<relative>/util/wsMock'));
 *
 * (a test that needs the real module's other exports spreads `importOriginal`
 * under it), and drive inbound frames with `deliver`. Delivery matches the real
 * `useWS` receive path (ADR 0051): every frame must pass `isRelayFrame` — a
 * fixture that would be dropped in production fails the test instead — and
 * each one is handed to every mounted socket inside `flushSync`, so it commits
 * before the next.
 *
 * A test with its own `useWS` mock calls `useCapturedSocket(params)` from it to
 * get the same delivery.
 */

type Handler = (frame: never) => void;

interface Socket {
  tag: unknown;
  handler: { current: Handler | undefined };
}

const sockets: Socket[] = [];

/** Register this mount's `onMessage` for `deliver`. `tag` (read once, at mount)
 * names the socket for `deliverTo`. */
export const useCapturedSocket = (params: { onMessage?: Handler }, tag?: unknown): void => {
  const handler = useRef<Handler | undefined>(params.onMessage);
  handler.current = params.onMessage;
  const [socket] = useState<Socket>(() => ({ tag, handler }));
  useEffect(() => {
    sockets.push(socket);
    return () => {
      sockets.splice(sockets.indexOf(socket), 1);
    };
  }, []);
};

const assertFrame = (frame: unknown): void => {
  if (!isRelayFrame(frame)) {
    throw new Error(`wsMock: isRelayFrame drops this frame: ${JSON.stringify(frame)}`);
  }
};

/** Deliver frames, in order, to the sockets `match` selects — all in one act. */
export const deliverTo = (match: (tag: unknown) => boolean, ...frames: unknown[]): void => {
  frames.forEach(assertFrame);
  act(() => {
    for (const frame of frames) {
      for (const socket of sockets.filter((s) => match(s.tag))) {
        // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- mirrors the real receive path
        flushSync(() => socket.handler.current?.(frame as never));
      }
    }
  });
};

/** Deliver frames, in order, to every mounted socket — all in one act, as if
 * they landed in one task. */
export const deliver = (...frames: unknown[]): void => deliverTo(() => true, ...frames);

/** What the default `useWS` below returns; reassign fields per test. */
export const wsState = {
  readyState: ReadyState.OPEN as ReadyState,
  senderId: 'ws-mock-sender',
  sendWSMessage: vi.fn(),
  sendAck: vi.fn(),
};

/** Restore `wsState` defaults (fresh spies). The socket registry is mount-scoped
 * and empties itself on unmount. */
export const resetWsMock = (): void => {
  wsState.readyState = ReadyState.OPEN;
  wsState.senderId = 'ws-mock-sender';
  wsState.sendWSMessage = vi.fn();
  wsState.sendAck = vi.fn();
};

export const useWS = (params: { sessionId: string; readToken?: string; onMessage?: Handler }) => {
  useCapturedSocket(params);
  return {
    readyState: wsState.readyState,
    senderId: wsState.senderId,
    sendWSMessage: wsState.sendWSMessage,
    sendAck: wsState.sendAck,
  };
};
