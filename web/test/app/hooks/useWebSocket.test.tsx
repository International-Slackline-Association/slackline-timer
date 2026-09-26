import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Options } from 'react-use-websocket';

import type {
  CountdownWSMessage,
  DistributiveOmit,
  SessionWSMessage,
  StopwatchWSMessage,
} from 'app/hooks/useWebSocket';

// Capture the args react-use-websocket is called with so we can exercise the
// lazy url getter and the open/close callbacks without a real socket.
const { useWebSocketMock } = vi.hoisted(() => ({ useWebSocketMock: vi.fn() }));
vi.mock('react-use-websocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-use-websocket')>();
  return { ...actual, default: useWebSocketMock };
});

// The credential seam: in prod this is the (refreshing) Cognito IdToken getter.
const { getBaseTokenMock } = vi.hoisted(() => ({ getBaseTokenMock: vi.fn() }));
vi.mock('app/auth', () => ({ getBaseToken: getBaseTokenMock }));

const { setWsAuthDeniedMock } = vi.hoisted(() => ({ setWsAuthDeniedMock: vi.fn() }));
vi.mock('app/auth/wsAuthSignal', () => ({ setWsAuthDenied: setWsAuthDeniedMock }));

import { WS_KEEPALIVE_INTERVAL_MS, useWS, wsReconnectDelay } from 'app/hooks/useWebSocket';

type Captured = {
  url: string | (() => string | Promise<string>);
  options: Options;
};

const lastCall = (): Captured => {
  const [url, options] = useWebSocketMock.mock.calls.at(-1)!;
  return { url, options };
};

beforeEach(() => {
  useWebSocketMock.mockReturnValue({
    sendJsonMessage: vi.fn(),
    lastJsonMessage: null,
    readyState: 0,
  });
});

afterEach(() => {
  useWebSocketMock.mockReset();
  getBaseTokenMock.mockReset();
  setWsAuthDeniedMock.mockReset();
});

describe('useWS', () => {
  it('resolves a fresh token from the auth seam on every (re)connect', async () => {
    getBaseTokenMock.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
    renderHook(() => useWS({ sessionId: 's1' }));

    const { url } = lastCall();
    expect(typeof url).toBe('function');

    const first = await (url as () => Promise<string>)();
    expect(first).toContain('Authorization=token-1');
    expect(first).toContain('sessionId=s1');

    // A reconnect re-invokes the same getter, picking up a refreshed token
    // rather than replaying the stale one read on mount.
    const second = await (url as () => Promise<string>)();
    expect(second).toContain('Authorization=token-2');
    expect(getBaseTokenMock).toHaveBeenCalledTimes(2);
  });

  it('prefers an explicit read token (overlays) and never calls the seam', async () => {
    renderHook(() => useWS({ sessionId: 's1', readToken: 'event-read-token' }));

    const { url } = lastCall();
    const resolved = await (url as () => Promise<string>)();
    expect(resolved).toContain('Authorization=event-read-token');
    expect(getBaseTokenMock).not.toHaveBeenCalled();
  });

  it('reconnects forever with capped exponential backoff', () => {
    renderHook(() => useWS({ sessionId: 's1' }));
    const { options } = lastCall();
    expect(options.shouldReconnect?.({} as CloseEvent)).toBe(true);
    // A venue outage must never permanently strand an open page (previews /
    // on-air overlays) — reconnect attempts are unbounded.
    expect(options.reconnectAttempts).toBe(Infinity);

    const interval = options.reconnectInterval as (attempt: number) => number;
    // Early attempts retry fast; later ones settle at the 30s cap. Jitter keeps
    // each delay within (cap/2, cap].
    expect(interval(0)).toBeGreaterThan(500 - 1);
    expect(interval(0)).toBeLessThanOrEqual(1000);
    expect(interval(20)).toBeGreaterThan(15_000 - 1);
    expect(interval(20)).toBeLessThanOrEqual(30_000);
  });

  it('computes a jittered, capped delay deterministically', () => {
    expect(wsReconnectDelay(0, () => 0)).toBe(500);
    expect(wsReconnectDelay(0, () => 1)).toBe(1000);
    expect(wsReconnectDelay(3, () => 0.5)).toBe(6000);
    // Past the cap the exponent no longer matters — even at overflow sizes.
    expect(wsReconnectDelay(5, () => 1)).toBe(30_000);
    expect(wsReconnectDelay(1024, () => 1)).toBe(30_000);
  });

  it('sends an app-level keepalive ping every 8 minutes while open', () => {
    vi.useFakeTimers();
    try {
      const sendJsonMessage = vi.fn();
      useWebSocketMock.mockReturnValue({ sendJsonMessage, lastJsonMessage: null, readyState: 1 });
      renderHook(() => useWS({ sessionId: 's1' }));

      vi.advanceTimersByTime(WS_KEEPALIVE_INTERVAL_MS - 1);
      expect(sendJsonMessage).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(sendJsonMessage).toHaveBeenCalledWith({ type: 'ping', sessionId: 's1' });

      vi.advanceTimersByTime(WS_KEEPALIVE_INTERVAL_MS);
      expect(sendJsonMessage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not ping while the socket is not open', () => {
    vi.useFakeTimers();
    try {
      const sendJsonMessage = vi.fn();
      useWebSocketMock.mockReturnValue({ sendJsonMessage, lastJsonMessage: null, readyState: 0 });
      renderHook(() => useWS({ sessionId: 's1' }));

      vi.advanceTimersByTime(WS_KEEPALIVE_INTERVAL_MS * 2);
      expect(sendJsonMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags an auth denial when an operator socket closes before opening', () => {
    renderHook(() => useWS({ sessionId: 's1' }));
    const { options } = lastCall();

    options.onClose?.({} as CloseEvent);
    expect(setWsAuthDeniedMock).toHaveBeenCalledWith(true);
  });

  it('clears the denial and does not re-flag once the socket has opened', () => {
    renderHook(() => useWS({ sessionId: 's1' }));
    const { options } = lastCall();

    options.onOpen?.({} as Event);
    expect(setWsAuthDeniedMock).toHaveBeenCalledWith(false);

    setWsAuthDeniedMock.mockClear();
    // A later drop after a successful open is a normal disconnect, not a denial.
    options.onClose?.({} as CloseEvent);
    expect(setWsAuthDeniedMock).not.toHaveBeenCalledWith(true);
  });

  it('does not flag a denial for read-token overlays', () => {
    renderHook(() => useWS({ sessionId: 's1', readToken: 'event-read-token' }));
    const { options } = lastCall();

    options.onClose?.({} as CloseEvent);
    expect(setWsAuthDeniedMock).not.toHaveBeenCalledWith(true);
  });

  it('does not console.log relay messages outside a dev build', () => {
    vi.stubEnv('DEV', false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const sendJsonMessage = vi.fn();
      useWebSocketMock.mockReturnValue({
        sendJsonMessage,
        lastJsonMessage: { type: 'reset', sessionId: 's1', data: {} },
        readyState: 1,
      });

      const { result } = renderHook(() =>
        useWS<import('app/hooks/useWebSocket').StopwatchWSMessage>({ sessionId: 's1' }),
      );
      result.current.sendWSMessage({ type: 'reset', data: {} });

      // Both the received-message effect and the send path stay silent in prod:
      // the payloads would otherwise leak into on-air screen captures.
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('traces relay messages both ways in a dev build', () => {
    vi.stubEnv('DEV', true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const sendJsonMessage = vi.fn();
      useWebSocketMock.mockReturnValue({
        sendJsonMessage,
        lastJsonMessage: { type: 'reset', sessionId: 's1', data: {} },
        readyState: 1,
      });

      const { result } = renderHook(() =>
        useWS<import('app/hooks/useWebSocket').StopwatchWSMessage>({ sessionId: 's1' }),
      );
      result.current.sendWSMessage({ type: 'reset', data: {} });

      expect(logSpy).toHaveBeenCalledWith('Received:', expect.objectContaining({ type: 'reset' }));
      expect(logSpy).toHaveBeenCalledWith('Sent:', expect.objectContaining({ type: 'reset' }));
    } finally {
      logSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('stamps the sessionId onto the new state-recovery message variants', () => {
    const sendJsonMessage = vi.fn();
    useWebSocketMock.mockReturnValue({ sendJsonMessage, lastJsonMessage: null, readyState: 1 });

    const { result } = renderHook(() =>
      useWS<import('app/hooks/useWebSocket').StopwatchWSMessage>({ sessionId: 's1' }),
    );

    result.current.sendWSMessage({ type: 'request_state', data: {} });
    expect(sendJsonMessage).toHaveBeenLastCalledWith({
      type: 'request_state',
      data: {},
      sessionId: 's1',
      senderId: expect.any(String),
    });

    result.current.sendWSMessage({
      type: 'state_snapshot',
      data: {
        isPreviewEnabled: true,
        signalPhase: 0,
        text: '',
        timers: [{ timerId: 1, startTime: 1_000, stopTime: null }],
      },
    });
    expect(sendJsonMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'state_snapshot', sessionId: 's1' }),
    );
  });

  it('stamps a stable per-mount senderId and exposes it', () => {
    // ADR 0038 §4: every outgoing message carries the mount's senderId — the
    // equal-seq tiebreak of the selection last-writer-wins stamp — and the hook
    // exposes it so `useControlSession` can mint stamps under the same id.
    const sendJsonMessage = vi.fn();
    useWebSocketMock.mockReturnValue({ sendJsonMessage, lastJsonMessage: null, readyState: 1 });

    const { result, rerender } = renderHook(() =>
      useWS<import('app/hooks/useWebSocket').StopwatchWSMessage>({ sessionId: 's1' }),
    );
    const { senderId } = result.current;
    expect(senderId).toBeTruthy();

    result.current.sendWSMessage({ type: 'reset', data: {} });
    expect(sendJsonMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'reset', senderId }),
    );

    // Stable across re-renders (per mount, not per render)…
    rerender();
    expect(result.current.senderId).toBe(senderId);

    // …but unique per mount, so two panels never collide.
    const second = renderHook(() =>
      useWS<import('app/hooks/useWebSocket').StopwatchWSMessage>({ sessionId: 's1' }),
    );
    expect(second.result.current.senderId).not.toBe(senderId);
  });
});

describe('SessionWSMessage (shared session-scoped union)', () => {
  // The five session-scoped variants are factored into one union carried by
  // both mode unions, WITHOUT the Countdown envelope's `timerId`. Dropping the
  // former `timerId: -1` sentinel is wire-compatible: lane consumers filter on
  // `timerId !== <lane id>`, so a missing `timerId` is filtered out exactly as
  // `-1` was. These type-level assertions pin the shape so it can't drift back.
  it('carries no timerId on any variant', () => {
    expectTypeOf<SessionWSMessage<unknown>>().not.toHaveProperty('timerId');
  });

  it('is a member of both the Stopwatch and Countdown unions', () => {
    // A session variant with only the shared envelope (no timerId) must be
    // assignable to both mode unions — the whole point of factoring it out.
    const preview = { sessionId: 's', type: 'updatePreview', data: { enabled: true } } as const;
    expectTypeOf(preview).toMatchTypeOf<StopwatchWSMessage>();
    expectTypeOf(preview).toMatchTypeOf<CountdownWSMessage>();
  });

  it('lets start_countdown / start_break carry an optional shared startedAt anchor', () => {
    // The smear fix: the countdown clocks now carry the control's start epoch on
    // the wire (mirroring the stopwatch's absolute startTime), so receivers
    // derive off one shared anchor instead of each re-anchoring to its receipt.
    const startCountdown: DistributiveOmit<CountdownWSMessage, 'sessionId'> = {
      type: 'start_countdown',
      timerId: 1,
      data: { remainingMs: 90_000, startedAt: 12_345 },
    };
    const startBreak: DistributiveOmit<CountdownWSMessage, 'sessionId'> = {
      type: 'start_break',
      timerId: 1,
      data: { runRemainingMs: 45_000, breakMs: 30_000, breaksLeft: 1, startedAt: 12_345 },
    };
    // Optional + additive: both still build without it (a pre-feature sender),
    // and the frozen-value messages take no anchor.
    const legacy: DistributiveOmit<CountdownWSMessage, 'sessionId'> = {
      type: 'start_countdown',
      timerId: 1,
      data: { remainingMs: 90_000 },
    };
    expect(startCountdown.data).toMatchObject({ startedAt: 12_345 });
    expect(startBreak.data).toMatchObject({ startedAt: 12_345 });
    expect(legacy.data).not.toHaveProperty('startedAt');
  });

  it('lets a Countdown session message build without a timerId', () => {
    // The Freestyle control page builds these; before the refactor it stamped a
    // sentinel timerId:-1. It must now build (and type-check) without one — note
    // the DistributiveOmit, which is required so the lane variants keep theirs.
    const msg: DistributiveOmit<CountdownWSMessage, 'sessionId'> = {
      type: 'updateSelection',
      data: {
        discipline: 'freestyle',
        round: 'final',
        gender: 'male',
        matchId: null,
        athlete1Id: null,
        athlete2Id: null,
      },
    };
    expect(msg.type).toBe('updateSelection');
    expect('timerId' in msg).toBe(false);
  });
});
