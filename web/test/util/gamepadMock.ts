import { act } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

import type { GamepadPressHandler } from 'app/hooks/useGamepads';

/**
 * Stand-in for `app/hooks/useGamepads` (jsdom has no Gamepad API and no real
 * frame loop). Wire it with
 *
 *   vi.mock('app/hooks/useGamepads', () => import('<relative>/util/gamepadMock'));
 *
 * and drive presses with `pressPad` / `pressPads`. Delivery matches the real
 * poller (`createGamepadPoller`): each button of the frame in order, one
 * `flushSync` per press calling every mounted instance in mount order, one
 * `seq` per press.
 */

const handlers: { current: GamepadPressHandler }[] = [];
let seq = 0;

export const useGamepads = (onPress: GamepadPressHandler): void => {
  const ref = useRef(onPress);
  ref.current = onPress;
  useEffect(() => {
    handlers.push(ref);
    return () => {
      handlers.splice(handlers.indexOf(ref), 1);
    };
  }, []);
};

/** Buttons rising in ONE poll — e.g. both lanes' reds on a dead heat. */
export const pressPads = (buttons: number[], at: number = Date.now()): void => {
  act(() => {
    for (const button of buttons) {
      seq += 1;
      const press = { button, seq, at };
      // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- mirrors the real poller
      flushSync(() => [...handlers].forEach((handler) => handler.current(press)));
    }
  });
};

export const pressPad = (button: number, at?: number): void => pressPads([button], at);
