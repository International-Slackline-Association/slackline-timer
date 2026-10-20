import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { createGamepadPoller, type GamepadPoller } from './gamepadPoller';

/**
 * Which physical game controller drives the timer. The controller is a property
 * of the operator station, not of a competition, so the selection is stored
 * under one global key and shared via context across every `useGamepads`
 * consumer — the operator picks one pad and it drives the whole board.
 *
 * Owns the live connected-pad list (the window `gamepadconnected` /
 * `gamepaddisconnected` events, registered once here, not per hook) and
 * derives the chosen pad's `selectedIndex`. Persists the pad `id`, not the
 * numeric `index` (the browser can reuse it across re-plugs), so a re-plug
 * re-selects the same controller.
 *
 * Also owns the board's one Gamepad API poll (`gamepadPoller`), in its own
 * context so a subscriber does not re-render on a pad connect/disconnect.
 */

const STORAGE_KEY = 'speedline.selectedGamepad';

export interface ConnectedPad {
  /** Browser-stable (within a session) gamepad index — the polling/debounce key. */
  index: number;
  /** Browser-provided controller id — persisted, and shown in the picker. */
  id: string;
}

interface GamepadSelectionValue {
  /** Pads currently reported connected by the browser. */
  connectedPads: ConnectedPad[];
  /** The operator's persisted pad-id choice, or null when none is stored. */
  selectedPadId: string | null;
  setSelectedPadId: (id: string | null) => void;
  /**
   * The index of the connected pad to drive the timer, or undefined when none
   * resolves (no pads, the stored pad is unplugged, or >1 pad and no choice).
   * Auto-defaults to the sole pad when exactly one is connected and nothing is
   * stored.
   */
  selectedIndex: number | undefined;
}

const GamepadSelectionContext = createContext<GamepadSelectionValue | undefined>(undefined);
const GamepadPollerContext = createContext<GamepadPoller | undefined>(undefined);

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const scanConnectedPads = (): ConnectedPad[] => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const result: ConnectedPad[] = [];
  for (const pad of pads) {
    if (pad) result.push({ index: pad.index, id: pad.id });
  }
  return result;
};

export const GamepadSelectionProvider = ({ children }: { children: ReactNode }) => {
  const [selectedPadId, setSelectedPadIdState] = useState<string | null>(readStored);
  const [connectedPads, setConnectedPads] = useState<ConnectedPad[]>(() => scanConnectedPads());

  const setSelectedPadId = useCallback((next: string | null) => {
    setSelectedPadIdState(next);
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Private-mode / disabled storage: keep the in-memory selection only.
    }
  }, []);

  // Re-scan on every event: a disconnect of the selected pad clears its index
  // without losing the stored id.
  useEffect(() => {
    const refresh = () => setConnectedPads(scanConnectedPads());
    refresh();
    window.addEventListener('gamepadconnected', refresh);
    window.addEventListener('gamepaddisconnected', refresh);
    return () => {
      window.removeEventListener('gamepadconnected', refresh);
      window.removeEventListener('gamepaddisconnected', refresh);
    };
  }, []);

  const selectedIndex = useMemo<number | undefined>(() => {
    if (selectedPadId) {
      const match = connectedPads.find((p) => p.id === selectedPadId);
      return match?.index;
    }
    // No stored choice: silently drive the sole connected pad if there is one.
    if (connectedPads.length === 1) return connectedPads[0].index;
    return undefined;
  }, [selectedPadId, connectedPads]);

  const [poller] = useState(createGamepadPoller);
  // Layout, so the poll never runs a frame on the previous pad after a commit.
  useLayoutEffect(() => poller.setSelectedIndex(selectedIndex), [poller, selectedIndex]);

  const value = useMemo<GamepadSelectionValue>(
    () => ({ connectedPads, selectedPadId, setSelectedPadId, selectedIndex }),
    [connectedPads, selectedPadId, setSelectedPadId, selectedIndex],
  );

  return (
    <GamepadSelectionContext.Provider value={value}>
      <GamepadPollerContext.Provider value={poller}>{children}</GamepadPollerContext.Provider>
    </GamepadSelectionContext.Provider>
  );
};

export const useGamepadSelection = (): GamepadSelectionValue => {
  const ctx = useContext(GamepadSelectionContext);
  if (!ctx) {
    throw new Error('useGamepadSelection must be used within a GamepadSelectionProvider');
  }
  return ctx;
};

/** The provider's pad poll; `useGamepads` subscribes to it. */
export const useGamepadPoller = (): GamepadPoller => {
  const poller = useContext(GamepadPollerContext);
  if (!poller) {
    throw new Error('useGamepads must be used within a GamepadSelectionProvider');
  }
  return poller;
};
