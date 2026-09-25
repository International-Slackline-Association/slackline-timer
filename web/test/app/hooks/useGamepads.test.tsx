import { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGamepads } from 'app/hooks/useGamepads';
import { GamepadSelectionProvider } from 'app/state/gamepadSelection';

const wrapper = ({ children }: { children: ReactNode }) => (
  <GamepadSelectionProvider>{children}</GamepadSelectionProvider>
);

// A Gamepad-like stub: the provider reads `index`/`id`; the hook reads `index`
// and the `buttons[i].pressed` flag.
const fakePad = (index: number, pressed: boolean[]) =>
  ({
    index,
    id: `Pad ${index}`,
    buttons: pressed.map((p) => ({ pressed: p })),
  }) as unknown as Gamepad;

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

describe('useGamepads — press token', () => {
  it('starts with no press', () => {
    const { result } = renderHook(() => useGamepads(), { wrapper });
    expect(result.current.lastPressedGamepadButton).toBeUndefined();
  });

  it('reports the pressed button of the sole connected pad', () => {
    // Sole pad present at mount → auto-selected by the provider.
    connected = [fakePad(0, [false])];
    const { result } = renderHook(() => useGamepads(), { wrapper });

    connected = [fakePad(0, [true, false])];
    pollOnce();

    expect(result.current.lastPressedGamepadButton?.button).toBe(0);
  });

  it('emits a fresh token on a deliberate same-button re-press (no 1s wait)', () => {
    connected = [fakePad(0, [false])];
    const { result } = renderHook(() => useGamepads(), { wrapper });

    // Press button 0 (false → true edge).
    connected = [fakePad(0, [true])];
    pollOnce();
    const first = result.current.lastPressedGamepadButton;
    expect(first?.button).toBe(0);

    // Release (true → false), then re-press well within the old 1000ms window.
    connected = [fakePad(0, [false])];
    pollOnce();
    vi.advanceTimersByTime(120);
    connected = [fakePad(0, [true])];
    pollOnce();

    const second = result.current.lastPressedGamepadButton;
    expect(second?.button).toBe(0);
    // Same button, but the token must differ so consumer effects re-fire.
    expect(second?.seq).not.toBe(first?.seq);
  });

  it('does NOT auto-repeat a held button (emits once on the edge only)', () => {
    connected = [fakePad(0, [false])];
    const { result } = renderHook(() => useGamepads(), { wrapper });

    // Press and hold.
    connected = [fakePad(0, [true])];
    pollOnce();
    const first = result.current.lastPressedGamepadButton;
    expect(first?.button).toBe(0);

    // Hold well past the old 1000ms auto-repeat window across several frames.
    for (let f = 0; f < 5; f++) {
      vi.advanceTimersByTime(500);
      pollOnce();
    }

    // Still the single edge press — no auto-repeat.
    expect(result.current.lastPressedGamepadButton?.seq).toBe(first?.seq);
  });

  it('swallows contact chatter within the short bounce guard', () => {
    connected = [fakePad(0, [false])];
    const { result } = renderHook(() => useGamepads(), { wrapper });

    connected = [fakePad(0, [true])];
    pollOnce();
    const first = result.current.lastPressedGamepadButton;

    // Release + re-press faster than a human could (mechanical bounce).
    connected = [fakePad(0, [false])];
    pollOnce();
    vi.advanceTimersByTime(10);
    connected = [fakePad(0, [true])];
    pollOnce();

    // Bounce guard rejects the chatter re-press.
    expect(result.current.lastPressedGamepadButton?.seq).toBe(first?.seq);
  });
});
