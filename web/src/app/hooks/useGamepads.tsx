import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

import { useGamepadSelection } from 'app/state/gamepadSelection';

/**
 * One rising edge of one button. `seq` is monotonic across the hook instance,
 * so two presses of the same button stay distinguishable; `at` is the epoch the
 * press happened at (see `pressEpoch`), the value a stop is timed off.
 */
export interface GamepadPress {
  button: number;
  seq: number;
  at: number;
}

export type GamepadPressHandler = (press: GamepadPress) => void;

const BOUNCE_MS = 60;
/** How far back a HID report timestamp may move a press. A frame is ~16 ms; a
 * larger age is a stalled/backgrounded tab or a bogus clock, not a press age. */
const MAX_REPORT_AGE_MS = 250;

/**
 * The epoch of the HID report that carried the press. `gamepad.timestamp` is on
 * the `performance.now()` clock, so only its AGE is taken from it and applied to
 * `Date.now()` — no cross-clock arithmetic. Browsers that leave it 0/absent get
 * the poll time.
 */
const pressEpoch = (gamepad: Gamepad, now: number): number => {
  if (!gamepad.timestamp) return now;
  const age = Math.min(Math.max(performance.now() - gamepad.timestamp, 0), MAX_REPORT_AGE_MS);
  return now - age;
};

/**
 * Polls the Gamepad API each animation frame and calls `onPress` for every
 * rising edge on the operator-selected pad (`selectedIndex` from the shared
 * `GamepadSelectionProvider`), so a single chosen controller drives every timer
 * across the hook's several instances.
 *
 * Every edge of a frame is delivered, in button order, each inside `flushSync`:
 * one Buzz! dongle carries both lanes' reds, a dead heat lands both in one poll,
 * and the second handler must read the state the first committed. `onPress` is
 * held in a ref, so it may close over the latest render without re-subscribing
 * the frame loop.
 *
 * Detection is **rising-edge** (a held button fires once; a same-button
 * re-press fires the moment it lands) behind a `BOUNCE_MS` contact-chatter
 * guard. Both are keyed off the browser-stable `gamepad.index`, not the
 * iteration index, which shifts when a pad disconnects.
 *
 * The physical button-index → button map for the venue Buzz! buzzers is in
 * `doc/dev/buzzer-hardware.md`.
 */
export const useGamepads = (onPress: GamepadPressHandler): void => {
  const { selectedIndex } = useGamepadSelection();

  const requestRef = useRef<number | undefined>(undefined);
  const prevPressed = useRef<Record<string, boolean>>({});
  const lastEdgeTime = useRef<Record<string, number>>({});
  const seqRef = useRef(0);

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const animate = () => {
      // Queued first: a throwing handler must not end the poll for every pad.
      requestRef.current = requestAnimationFrame(animate);
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
              const press = { button: i, seq: seqRef.current, at: pressEpoch(gamepad, now) };
              // One commit per press (see the JSDoc); at most a handful per
              // frame, only on a press.
              // eslint-disable-next-line @eslint-react/dom-no-flush-sync
              flushSync(() => onPressRef.current(press));
            }
          }
        }
      }
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, []);
};
