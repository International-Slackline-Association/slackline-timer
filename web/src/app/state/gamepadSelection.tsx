import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Which physical game controller drives the timer. The controller is a property
 * of the operator station, not of a competition, so the selection is stored
 * under one global key and shared via context across every `useGamepads`
 * consumer (the single Speedline control plus the two Freestyle
 * `CountdownControl` instances) — so the operator picks one pad and it drives
 * both Freestyle players.
 *
 * Owns the live connected-pad list (the window `gamepadconnected` /
 * `gamepaddisconnected` events, registered ONCE here rather than per-hook) and
 * derives the current `selectedIndex` of the chosen pad. We persist the pad
 * `id` (not the numeric `index`, which the browser can reuse across re-plugs)
 * so a re-plug re-selects the same controller.
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

  // Register the window listeners ONCE for all consumers. Re-scan on every
  // event so the list reflects the browser's truth (and so a disconnect of the
  // selected pad clears its index without losing the stored id).
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

  const value = useMemo<GamepadSelectionValue>(
    () => ({ connectedPads, selectedPadId, setSelectedPadId, selectedIndex }),
    [connectedPads, selectedPadId, setSelectedPadId, selectedIndex],
  );

  return (
    <GamepadSelectionContext.Provider value={value}>{children}</GamepadSelectionContext.Provider>
  );
};

export const useGamepadSelection = (): GamepadSelectionValue => {
  const ctx = useContext(GamepadSelectionContext);
  if (!ctx) {
    throw new Error('useGamepadSelection must be used within a GamepadSelectionProvider');
  }
  return ctx;
};
