import { flushSync } from 'react-dom';

/**
 * One rising edge of one button. `seq` is monotonic across the poller, so two
 * presses of the same button stay distinguishable and every subscriber sees the
 * same `seq` for the same press; `at` is the epoch the press happened at (see
 * `reportEpoch`), the value a stop is timed off.
 */
export interface GamepadPress {
  button: number;
  seq: number;
  at: number;
}

export type GamepadPressHandler = (press: GamepadPress) => void;

export interface GamepadPoller {
  /** Registers a handler; the loop runs while at least one is registered.
   * Returns the unsubscribe. */
  subscribe(handler: GamepadPressHandler): () => void;
  /** The operator-selected pad (`GamepadSelectionProvider`); only its edges are
   * delivered. Edges on other pads are still tracked, so a re-selection never
   * replays a held button. */
  setSelectedIndex(index: number | undefined): void;
}

const BOUNCE_MS = 60;
/** How far back a HID report timestamp may move a press. A frame is ~16 ms; a
 * larger age is a stalled/backgrounded tab or a bogus clock, not a press age. */
const MAX_REPORT_AGE_MS = 250;

/**
 * The epoch of the HID report that carried the press. `gamepad.timestamp` is on
 * the `performance.now()` clock, so only its AGE is applied to `Date.now()`,
 * rounded to whole ms (`formatMs` throws on a fraction). A 0/absent timestamp
 * gets the poll time. Read once per report, before its first delivery: every
 * edge of the report shares it, so a dead heat's second stop does not absorb
 * the first one's commit.
 */
const reportEpoch = (gamepad: Gamepad): number => {
  const now = Date.now();
  if (!gamepad.timestamp) return now;
  const age = Math.min(Math.max(performance.now() - gamepad.timestamp, 0), MAX_REPORT_AGE_MS);
  return now - Math.round(age);
};

/**
 * The one Gamepad API poll for a board (ADR 0051 §6): a single
 * `requestAnimationFrame` loop over `navigator.getGamepads()`, fanned out to
 * every subscribed `useGamepads`.
 *
 * Every edge of a frame on the selected pad is delivered, in button order, each
 * inside ONE `flushSync` that calls every subscriber in registration order: one
 * Buzz! dongle carries both lanes' reds, a dead heat lands both in one poll, and
 * the second press's handlers must read the state the first committed. A
 * throwing subscriber is logged and contained, so the others still get the
 * press and the loop keeps running.
 *
 * Detection is **rising-edge** (a held button fires once; a same-button
 * re-press fires the moment it lands) behind a `BOUNCE_MS` contact-chatter
 * guard, keyed off the browser-stable `gamepad.index`, not the iteration index,
 * which shifts when a pad disconnects. The edge state outlives the loop, so a
 * button held across a page change does not fire on the next page.
 */
export const createGamepadPoller = (): GamepadPoller => {
  const handlers = new Set<GamepadPressHandler>();
  const prevPressed = new Map<string, boolean>();
  const lastEdgeTime = new Map<string, number>();
  let seq = 0;
  let selectedIndex: number | undefined;
  let frameHandle: number | undefined;

  const deliver = (press: GamepadPress) => {
    // One commit per press, at most a handful per frame and only on a press.
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync
    flushSync(() => {
      for (const handler of handlers) {
        try {
          handler(press);
        } catch (error) {
          console.error('useGamepads: press handler threw', error);
        }
      }
    });
  };

  const frame = () => {
    // Queued first: nothing below may end the poll.
    frameHandle = requestAnimationFrame(frame);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gamepad of pads) {
      if (!gamepad) continue;
      let at: number | undefined;
      for (let i = 0; i < gamepad.buttons.length; i++) {
        const key = `${gamepad.index}:${i}`;
        const pressed = gamepad.buttons[i].pressed;
        const wasPressed = prevPressed.get(key) ?? false;
        prevPressed.set(key, pressed);
        if (!pressed || wasPressed) continue;

        const now = Date.now();
        if (now - (lastEdgeTime.get(key) ?? -Infinity) < BOUNCE_MS) continue;
        lastEdgeTime.set(key, now);
        if (gamepad.index !== selectedIndex) continue;
        seq += 1;
        at ??= reportEpoch(gamepad);
        deliver({ button: i, seq, at });
      }
    }
  };

  return {
    subscribe(handler) {
      handlers.add(handler);
      if (frameHandle === undefined) frameHandle = requestAnimationFrame(frame);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0 && frameHandle !== undefined) {
          cancelAnimationFrame(frameHandle);
          frameHandle = undefined;
        }
      };
    },
    setSelectedIndex(index) {
      selectedIndex = index;
    },
  };
};
