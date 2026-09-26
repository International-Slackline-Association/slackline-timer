import { describe, expect, it } from 'vitest';

import {
  ADVANCE_BUTTON,
  LANE_2_OFFSET,
  LANE_BUTTONS,
  buzzButton,
  buzzerRows,
  isBuzzController,
} from 'app/util/buzzer';

describe('isBuzzController', () => {
  it('matches the Buzz id strings browsers report', () => {
    expect(isBuzzController('Sony Buzz')).toBe(true);
    expect(isBuzzController('Logitech Buzz(tm) Controller V1')).toBe(true);
    // Chrome-style generic id carries the USB vendor/product pair.
    expect(isBuzzController('Unknown Gamepad (Vendor: 054c Product: 0002)')).toBe(true);
  });

  it('rejects other controllers', () => {
    expect(isBuzzController('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe(false);
    expect(isBuzzController('054c Product: 05c4')).toBe(false); // DualShock 4, not a Buzz
  });
});

describe('buzzButton', () => {
  it('derives handset + colour from the button index', () => {
    expect(buzzButton(0)).toEqual({ handset: 1, color: 'Red' });
    expect(buzzButton(4)).toEqual({ handset: 1, color: 'Blue' });
    expect(buzzButton(5)).toEqual({ handset: 2, color: 'Red' });
    expect(buzzButton(11)).toEqual({ handset: 3, color: 'Yellow' });
    expect(buzzButton(16)).toEqual({ handset: 4, color: 'Yellow' });
  });
});

// FREESTYLE_BOARD_UX §4.14 / audit S18: the mapping the operator reads is
// GENERATED from the constants the pad handlers dispatch on, and it knows the
// mode — a row for a key this board binds to nothing is worse than no row.
describe('buzzerRows', () => {
  it('maps all eleven battle bindings, in button order', () => {
    expect(buzzerRows('battle')).toEqual([
      { button: 0, action: 'Start Athlete 1' },
      { button: 1, action: 'Reset Athlete 1' },
      { button: 2, action: 'End turn Athlete 1' },
      { button: 3, action: 'Start try Athlete 1' },
      { button: 4, action: 'Stop Athlete 1' },
      { button: 5, action: 'Start Athlete 2' },
      { button: 6, action: 'Reset Athlete 2' },
      { button: 7, action: 'End turn Athlete 2' },
      { button: 8, action: 'Start try Athlete 2' },
      { button: 9, action: 'Stop Athlete 2' },
      { button: ADVANCE_BUTTON, action: 'ADVANCE (also Space)' },
    ]);
  });

  it('drops the second athlete slot and best trick in quali, and says Take break', () => {
    expect(buzzerRows('quali')).toEqual([
      { button: 0, action: 'Start Athlete 1' },
      { button: 1, action: 'Reset Athlete 1' },
      { button: 2, action: 'Take break Athlete 1' },
      { button: 4, action: 'Stop Athlete 1' },
      { button: ADVANCE_BUTTON, action: 'ADVANCE (also Space)' },
    ]);
  });

  it('places every athlete-2 row one handset along from its athlete-1 twin', () => {
    const rows = buzzerRows('battle');
    for (const role of ['start', 'reset', 'aux', 'try', 'stop'] as const) {
      const first = rows.find((r) => r.button === LANE_BUTTONS[role]);
      const second = rows.find((r) => r.button === LANE_BUTTONS[role] + LANE_2_OFFSET);
      expect(second?.action).toBe(first?.action.replace('Athlete 1', 'Athlete 2'));
    }
  });
});
