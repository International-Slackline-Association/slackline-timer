import { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GamepadSelectionProvider, useGamepadSelection } from 'app/state/gamepadSelection';

const STORAGE_KEY = 'speedline.selectedGamepad';

const wrapper = ({ children }: { children: ReactNode }) => (
  <GamepadSelectionProvider>{children}</GamepadSelectionProvider>
);

// A minimal Gamepad-like stub; only `index` and `id` are read by the provider.
const fakePad = (index: number, id: string) => ({ index, id }) as unknown as Gamepad;

// Drives navigator.getGamepads() return value between events.
let connected: (Gamepad | null)[] = [];

beforeEach(() => {
  window.localStorage.clear();
  connected = [];
  vi.stubGlobal('navigator', {
    ...navigator,
    getGamepads: () => connected,
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

// jsdom lacks GamepadEvent; attach `gamepad` to a plain Event so the provider's
// `(e as GamepadEvent).gamepad` read works.
const fireConnect = (pad: Gamepad) => {
  connected = [...connected, pad];
  const e = new Event('gamepadconnected') as Event & { gamepad: Gamepad };
  e.gamepad = pad;
  window.dispatchEvent(e);
};

const fireDisconnect = (pad: Gamepad) => {
  connected = connected.filter((p) => p?.index !== pad.index);
  const e = new Event('gamepaddisconnected') as Event & { gamepad: Gamepad };
  e.gamepad = pad;
  window.dispatchEvent(e);
};

describe('useGamepadSelection — persistence', () => {
  it('starts with no stored selection when storage is empty', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    expect(result.current.selectedPadId).toBeNull();
    expect(result.current.connectedPads).toEqual([]);
    expect(result.current.selectedIndex).toBeUndefined();
  });

  it('persists the selected pad id to localStorage', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });

    act(() => result.current.setSelectedPadId('Buzz Controller A'));

    expect(result.current.selectedPadId).toBe('Buzz Controller A');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('Buzz Controller A');
  });

  it('restores the selected pad id from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'Buzz Controller B');
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    expect(result.current.selectedPadId).toBe('Buzz Controller B');
  });

  it('clears the selection', () => {
    window.localStorage.setItem(STORAGE_KEY, 'Buzz Controller B');
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });

    act(() => result.current.setSelectedPadId(null));

    expect(result.current.selectedPadId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useGamepadSelection())).toThrow(/GamepadSelectionProvider/);
  });
});

describe('useGamepadSelection — controller awareness', () => {
  it('tracks connected pads from gamepadconnected/disconnected events', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    const padA = fakePad(0, 'Pad A');
    const padB = fakePad(1, 'Pad B');

    act(() => fireConnect(padA));
    expect(result.current.connectedPads).toEqual([{ index: 0, id: 'Pad A' }]);

    act(() => fireConnect(padB));
    expect(result.current.connectedPads).toEqual([
      { index: 0, id: 'Pad A' },
      { index: 1, id: 'Pad B' },
    ]);

    act(() => fireDisconnect(padA));
    expect(result.current.connectedPads).toEqual([{ index: 1, id: 'Pad B' }]);
  });

  it('auto-selects the sole connected pad when nothing is stored', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    const padA = fakePad(3, 'Lone Pad');

    act(() => fireConnect(padA));

    // selectedIndex resolves to the lone pad without persisting a choice.
    expect(result.current.selectedIndex).toBe(3);
    expect(result.current.selectedPadId).toBeNull();
  });

  it('does not auto-select when more than one pad is connected and nothing is stored', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });

    act(() => fireConnect(fakePad(0, 'Pad A')));
    act(() => fireConnect(fakePad(1, 'Pad B')));

    expect(result.current.selectedIndex).toBeUndefined();
  });

  it('resolves a stored pad id to its current connected index', () => {
    window.localStorage.setItem(STORAGE_KEY, 'Pad B');
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });

    act(() => fireConnect(fakePad(0, 'Pad A')));
    act(() => fireConnect(fakePad(7, 'Pad B')));

    expect(result.current.selectedIndex).toBe(7);
  });

  it('yields undefined selectedIndex when the active pad disconnects but retains the stored id', () => {
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    const padB = fakePad(2, 'Pad B');

    act(() => fireConnect(fakePad(0, 'Pad A')));
    act(() => fireConnect(padB));
    act(() => result.current.setSelectedPadId('Pad B'));
    expect(result.current.selectedIndex).toBe(2);

    act(() => fireDisconnect(padB));

    // Active pad gone: no index to fire on, but the operator's choice survives.
    expect(result.current.selectedIndex).toBeUndefined();
    expect(result.current.selectedPadId).toBe('Pad B');
  });

  it('does an initial navigator.getGamepads scan on mount', () => {
    connected = [fakePad(0, 'Already Plugged')];
    const { result } = renderHook(() => useGamepadSelection(), { wrapper });
    expect(result.current.connectedPads).toEqual([{ index: 0, id: 'Already Plugged' }]);
  });
});
