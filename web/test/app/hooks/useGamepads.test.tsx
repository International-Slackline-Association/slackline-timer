import { ReactNode, useRef, useState } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type GamepadPress, useGamepads } from 'app/hooks/useGamepads';
import { GamepadSelectionProvider } from 'app/state/gamepadSelection';

const wrapper = ({ children }: { children: ReactNode }) => (
  <GamepadSelectionProvider>{children}</GamepadSelectionProvider>
);

// A Gamepad-like stub: the provider reads `index`/`id`; the hook reads `index`,
// `timestamp` and the `buttons[i].pressed` flag.
const fakePad = (index: number, pressed: boolean[], timestamp?: number) =>
  ({
    index,
    id: `Pad ${index}`,
    timestamp,
    buttons: pressed.map((p) => ({ pressed: p })),
  }) as unknown as Gamepad;

/** The given buttons held on an otherwise idle 20-button pad (one Buzz! dongle). */
const buzz = (...down: number[]) => Array.from({ length: 20 }, (_, i) => down.includes(i));

let connected: (Gamepad | null)[] = [];
let rafCallbacks: FrameRequestCallback[] = [];

// Run every queued rAF callback once. The hook re-queues itself, so we capture
// the current batch and drain it.
const pollOnce = () => {
  const due = rafCallbacks;
  rafCallbacks = [];
  act(() => {
    due.forEach((cb) => cb(performance.now()));
  });
};

const mountWithSpy = () => {
  const onPress = vi.fn<(press: GamepadPress) => void>();
  renderHook(() => useGamepads(onPress), { wrapper });
  return onPress;
};

beforeEach(() => {
  window.localStorage.clear();
  connected = [];
  rafCallbacks = [];
  vi.useFakeTimers();
  vi.stubGlobal('navigator', {
    ...navigator,
    getGamepads: () => connected,
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useGamepads — press callback', () => {
  it('reports nothing until a button edges', () => {
    connected = [fakePad(0, [false])];
    const onPress = mountWithSpy();
    pollOnce();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports the pressed button of the sole connected pad', () => {
    // Sole pad present at mount → auto-selected by the provider.
    connected = [fakePad(0, [false])];
    const onPress = mountWithSpy();

    connected = [fakePad(0, [true, false])];
    pollOnce();

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0].button).toBe(0);
  });

  it('delivers every button that rises in one frame, in button order', () => {
    // Both lanes' reds share one Buzz! dongle: a dead heat lands 10 and 15 in
    // the same poll, and neither stop may be lost.
    connected = [fakePad(0, buzz())];
    const onPress = mountWithSpy();

    connected = [fakePad(0, buzz(10, 15))];
    pollOnce();

    expect(onPress.mock.calls.map(([p]) => p.button)).toEqual([10, 15]);
    const [first, second] = onPress.mock.calls.map(([p]) => p);
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(typeof first.at).toBe('number');
    expect(typeof second.at).toBe('number');
  });

  it('commits each press before the next is delivered', () => {
    // The second press of a frame must read the state the first one wrote:
    // a lane-2 stop decided off a board that has not seen lane 1 stop is the
    // stale read this guards.
    connected = [fakePad(0, buzz())];
    const seenCounts: number[] = [];
    renderHook(
      () => {
        const [count, setCount] = useState(0);
        const committed = useRef(count);
        committed.current = count;
        useGamepads(() => {
          seenCounts.push(committed.current);
          setCount((c) => c + 1);
        });
      },
      { wrapper },
    );

    connected = [fakePad(0, buzz(10, 15))];
    pollOnce();
    expect(seenCounts).toEqual([0, 1]);
  });

  it('stamps the press at the HID report time, capped at 250 ms back', () => {
    vi.setSystemTime(1_000_000);
    connected = [fakePad(0, buzz())];
    const onPress = mountWithSpy();

    // Report 40 ms old on the performance clock.
    connected = [fakePad(0, buzz(10), performance.now() - 40)];
    pollOnce();
    expect(onPress.mock.calls[0][0].at).toBeCloseTo(Date.now() - 40, -1);

    // A report older than the cap is pinned to the cap, never further back.
    connected = [fakePad(0, buzz())];
    pollOnce();
    vi.advanceTimersByTime(120);
    connected = [fakePad(0, buzz(10), performance.now() - 5_000)];
    pollOnce();
    expect(onPress.mock.calls[1][0].at).toBe(Date.now() - 250);
  });

  it('falls back to the wall clock when the pad carries no timestamp', () => {
    vi.setSystemTime(2_000_000);
    connected = [fakePad(0, buzz())];
    const onPress = mountWithSpy();

    connected = [fakePad(0, buzz(10), 0)];
    pollOnce();
    expect(onPress.mock.calls[0][0].at).toBe(Date.now());

    connected = [fakePad(0, buzz())];
    pollOnce();
    vi.advanceTimersByTime(120);
    connected = [fakePad(0, buzz(10))];
    pollOnce();
    expect(onPress.mock.calls[1][0].at).toBe(Date.now());
  });

  it('calls the latest callback without re-subscribing the frame loop', () => {
    connected = [fakePad(0, buzz())];
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useGamepads(cb), {
      wrapper,
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    connected = [fakePad(0, buzz(0))];
    pollOnce();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('emits a fresh seq on a deliberate same-button re-press (no 1s wait)', () => {
    connected = [fakePad(0, [false])];
    const onPress = mountWithSpy();

    connected = [fakePad(0, [true])];
    pollOnce();

    // Release (true → false), then re-press well within the old 1000ms window.
    connected = [fakePad(0, [false])];
    pollOnce();
    vi.advanceTimersByTime(120);
    connected = [fakePad(0, [true])];
    pollOnce();

    expect(onPress).toHaveBeenCalledTimes(2);
    const [first, second] = onPress.mock.calls.map(([p]) => p);
    expect(second.button).toBe(0);
    expect(second.seq).not.toBe(first.seq);
  });

  it('does NOT auto-repeat a held button (emits once on the edge only)', () => {
    connected = [fakePad(0, [false])];
    const onPress = mountWithSpy();

    connected = [fakePad(0, [true])];
    pollOnce();
    for (let f = 0; f < 5; f++) {
      vi.advanceTimersByTime(500);
      pollOnce();
    }

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows contact chatter within the short bounce guard', () => {
    connected = [fakePad(0, [false])];
    const onPress = mountWithSpy();

    connected = [fakePad(0, [true])];
    pollOnce();

    // Release + re-press faster than a human could (mechanical bounce).
    connected = [fakePad(0, [false])];
    pollOnce();
    vi.advanceTimersByTime(10);
    connected = [fakePad(0, [true])];
    pollOnce();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
