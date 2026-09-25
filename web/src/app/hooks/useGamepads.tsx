import { useEffect, useRef, useState } from 'react';

import { useGamepadSelection } from 'app/state/gamepadSelection';

/**
 * A button press carrying a monotonic `seq` so that pressing the *same* button
 * twice in a row (Start → Reset → Start = button 0 each time) yields a *new*
 * value — consumer effects keyed on the token re-fire, where a bare button
 * index would be an unchanged state value React bails on.
 */
export interface GamepadPress {
  button: number;
  seq: number;
}

const BOUNCE_MS = 60;

/**
 * Polls the Gamepad API each animation frame and emits the last pressed button
 * — but only for the operator-selected pad (`selectedIndex` from the shared
 * `GamepadSelectionProvider`). Multiple instances of this hook may run (one
 * Speedline control plus the two Freestyle `CountdownControl`s); they all read
 * the same shared selection, so a single chosen controller drives every timer.
 *
 * Detection is **rising-edge**: a press emits once on the false→true transition,
 * so a held button no longer auto-repeats and a deliberate same-button re-press
 * fires the moment it lands (no 1s wait). A short bounce guard (`BOUNCE_MS`)
 * rejects mechanical contact chatter. Both the previous pressed state and the
 * guard timestamp are keyed off the browser-stable `gamepad.index` (NOT a
 * `forEach` iteration index, which shifts when a pad disconnects and mis-keys
 * the state). Connect/disconnect tracking lives in the provider, so this hook
 * only reads `selectedIndex` and never registers window listeners.
 *
 * The physical button-index → button map for the venue Buzz! buzzers (why the
 * per-page action constants are the numbers they are) is in
 * `doc/dev/buzzer-hardware.md`.
 */
export const useGamepads = () => {
  const { selectedIndex } = useGamepadSelection();

  const requestRef = useRef<number | undefined>(undefined);
  const prevPressed = useRef<Record<string, boolean>>({});
  const lastEdgeTime = useRef<Record<string, number>>({});

  // Keep the latest selected index in a ref so the rAF loop (set up once) always
  // reads the current value without re-subscribing the animation frame.
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const [lastPress, setLastPress] = useState<GamepadPress>();
  const seqRef = useRef(0);

  useEffect(() => {
    const animate = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gamepad of pads) {
        if (!gamepad) continue;
        for (let i = 0; i < gamepad.buttons.length; i++) {
          const buttonId = `pad-${gamepad.index}-button-${i}`;
          const pressed = gamepad.buttons[i].pressed;
          const wasPressed = prevPressed.current[buttonId] ?? false;
          prevPressed.current[buttonId] = pressed;

          const now = Date.now();
          if (
            pressed &&
            !wasPressed &&
            now - (lastEdgeTime.current[buttonId] ?? -Infinity) >= BOUNCE_MS
          ) {
            lastEdgeTime.current[buttonId] = now;
            if (gamepad.index === selectedIndexRef.current) {
              seqRef.current += 1;
              setLastPress({ button: i, seq: seqRef.current });
            }
          }
        }
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, []);

  return { lastPressedGamepadButton: lastPress };
};
