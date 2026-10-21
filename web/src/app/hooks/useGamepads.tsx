import { useEffect, useRef } from 'react';

import type { GamepadPressHandler } from 'app/state/gamepadPoller';
import { useGamepadPoller } from 'app/state/gamepadSelection';

export type { GamepadPress, GamepadPressHandler } from 'app/state/gamepadPoller';

/**
 * Calls `onPress` for every rising edge on the operator-selected pad, from the
 * one poll `GamepadSelectionProvider` runs for the whole board (delivery rules:
 * `createGamepadPoller`). `onPress` is held in a ref, so it may close over the
 * latest render without re-subscribing.
 *
 * The physical button-index → button map for the venue Buzz! buzzers is in
 * `doc/dev/buzzer-hardware.md`.
 */
export const useGamepads = (onPress: GamepadPressHandler): void => {
  const poller = useGamepadPoller();
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => poller.subscribe((press) => onPressRef.current(press)), [poller]);
};
