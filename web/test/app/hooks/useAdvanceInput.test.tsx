import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ConfirmSafeAnswer,
  advanceBlocked,
  advanceOverlay,
  useAdvanceInput,
  useConfirmGuard,
} from 'app/hooks/useAdvanceInput';
import type { GamepadPress } from 'app/hooks/useGamepads';
import { ADVANCE_BUTTON } from 'app/util/buzzer';

// The gamepad leg is unit-tested through a controllable mock — the real
// useGamepads polls the Gamepad API off requestAnimationFrame, which jsdom
// cannot drive deterministically. The rising-edge/bounce behavior has its own
// suite (useGamepads.test.tsx); here we pin only the button-index routing.
const gamepadState: { lastPressedGamepadButton?: GamepadPress } = {};
vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => gamepadState,
}));

/** A confirm's readout name, irrelevant to the routing pinned here. */
const CONFIRM = { dialog: 'Reset', safeAction: 'Keep timing' } as const;

const pressSpace = (init: KeyboardEventInit = {}): boolean => {
  const event = new KeyboardEvent('keydown', { code: 'Space', cancelable: true, ...init });
  return window.dispatchEvent(event); // false once preventDefault was called
};

/** An overlay of `role` in the document — what `advanceBlocked` looks for. */
const openOverlay = (role: 'dialog' | 'listbox' | 'menu'): HTMLElement => {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', role);
  document.body.appendChild(overlay);
  return overlay;
};

afterEach(() => {
  delete gamepadState.lastPressedGamepadButton;
  document.body.innerHTML = '';
});

describe('useAdvanceInput — keyboard Space', () => {
  it('fires on Space and consumes the key (no scroll / focused-button click)', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    expect(pressSpace()).toBe(false); // defaultPrevented
    expect(onAdvance).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('ignores other keys', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', cancelable: true }));
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores a held key auto-repeat (one press, one step)', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    pressSpace({ repeat: true });
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });

  it('never fires while a text input has focus (typing a space stays a space)', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(pressSpace()).toBe(true); // NOT preventDefaulted — the field keeps the key
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });

  it('never fires while a textarea or contentEditable has focus', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    pressSpace();
    // jsdom does not implement isContentEditable, so assert the rule through the
    // documented seam: an element whose contentEditable reports editable.
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);
    editable.tabIndex = 0;
    editable.focus();
    pressSpace();
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });

  it('never fires while a dialog is open, and leaves the key to the safe button', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    const dialog = openOverlay('dialog');
    // NOT preventDefaulted: the press is the native click of the confirm's
    // autoFocused safe button (§4.8), so the browser must keep the key.
    expect(pressSpace()).toBe(true);
    expect(onAdvance).not.toHaveBeenCalled();
    dialog.remove();
    pressSpace();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('never fires while a picker popup owns the keys (an open listbox / menu)', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    for (const role of ['listbox', 'menu'] as const) {
      const overlay = openOverlay(role);
      expect(pressSpace()).toBe(true);
      overlay.remove();
    }
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });

  it.each(['combobox', 'listbox', 'option'])(
    'never fires while a focused %s owns the keys (Space picks, never advances)',
    (role) => {
      const onAdvance = vi.fn();
      const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
      const el = document.createElement('div');
      el.setAttribute('role', role);
      el.tabIndex = 0;
      document.body.appendChild(el);
      el.focus();
      expect(pressSpace()).toBe(true);
      expect(onAdvance).not.toHaveBeenCalled();
      unmount();
    },
  );

  // The activation tier (§4.3), safe only because `RaceButton` drops the focus a
  // mouse press would otherwise leave on a live control (§4.4).
  it.each([
    ['button', () => document.createElement('button')],
    [
      'role=button',
      () => {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        return el;
      },
    ],
    [
      'a[href]',
      () => {
        const el = document.createElement('a');
        el.href = '#';
        return el;
      },
    ],
  ])(
    'never fires while a focused %s owns the keys (Space activates it, never the board)',
    (_name, create) => {
      const onAdvance = vi.fn();
      const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
      const el = create();
      document.body.appendChild(el);
      el.focus();
      expect(pressSpace()).toBe(true);
      expect(onAdvance).not.toHaveBeenCalled();
      unmount();
    },
  );

  it('removes the listener on unmount', () => {
    const onAdvance = vi.fn();
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    unmount();
    pressSpace();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('reads the latest callback (no stale closure across re-renders)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ cb }) => useAdvanceInput(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    pressSpace();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('useAdvanceInput — gamepad button', () => {
  it(`fires on pad button ${ADVANCE_BUTTON} and re-fires on a new press token`, () => {
    const onAdvance = vi.fn();
    gamepadState.lastPressedGamepadButton = { button: ADVANCE_BUTTON, seq: 1 };
    const { rerender, unmount } = renderHook(() => useAdvanceInput(onAdvance));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    // The same token does not re-fire; a new seq (same button) does.
    rerender();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    gamepadState.lastPressedGamepadButton = { button: ADVANCE_BUTTON, seq: 2 };
    rerender();
    expect(onAdvance).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('ignores the lane-claimed buttons (0-9 stay with the per-lane controls)', () => {
    const onAdvance = vi.fn();
    gamepadState.lastPressedGamepadButton = { button: 0, seq: 1 };
    const { unmount } = renderHook(() => useAdvanceInput(onAdvance));
    expect(onAdvance).not.toHaveBeenCalled();
    unmount();
  });
});

// The third trigger (§4.3): the TALLY plate's click takes the guarded press
// BACK from the seam instead of copying the guard into the component, so it and
// pad 10 answer an open confirm through one function.
describe('useAdvanceInput — the press it hands back', () => {
  it('advances with nothing open', () => {
    const onAdvance = vi.fn();
    const { result, unmount } = renderHook(() => useAdvanceInput(onAdvance));

    result.current();

    expect(onAdvance).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('answers an open confirm with its safe close, never ADVANCE', () => {
    const onAdvance = vi.fn();
    const onSafeClose = vi.fn();
    const dialog = openOverlay('dialog');
    const confirm = renderHook(() => useConfirmGuard(true, onSafeClose, CONFIRM));
    const { result, unmount } = renderHook(() => useAdvanceInput(onAdvance));

    result.current();

    expect(onSafeClose).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    dialog.remove();
    unmount();
    confirm.unmount();
  });

  // The plate passes it straight to `onClick`, so a new identity every render
  // would re-render the loudest object on the board for nothing.
  it('is stable across renders', () => {
    const { result, rerender, unmount } = renderHook(() => useAdvanceInput(vi.fn()));
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    unmount();
  });
});

// FREESTYLE_BOARD_UX §4.3/§4.8: one predicate for all three ADVANCE triggers,
// and a press behind a confirm IS that confirm's safe action.
describe('advanceBlocked / useConfirmGuard', () => {
  it('is null with nothing open', () => {
    expect(advanceBlocked()).toBeNull();
  });

  it("returns the open confirm's registered safe close", () => {
    const onSafeClose = vi.fn();
    const dialog = openOverlay('dialog');
    const { unmount } = renderHook(() => useConfirmGuard(true, onSafeClose, CONFIRM));

    advanceBlocked()?.();

    expect(onSafeClose).toHaveBeenCalledTimes(1);
    dialog.remove();
    unmount();
  });

  it('blocks with a do-nothing action for an overlay no confirm registered', () => {
    const listbox = openOverlay('listbox');
    const blocked = advanceBlocked();
    expect(blocked).not.toBeNull();
    expect(() => blocked?.()).not.toThrow();
    listbox.remove();
  });

  it('stops blocking once the confirm closes or unmounts', () => {
    const onSafeClose = vi.fn();
    const dialog = openOverlay('dialog');
    const { rerender, unmount } = renderHook(
      ({ open }) => useConfirmGuard(open, onSafeClose, CONFIRM),
      {
        initialProps: { open: true },
      },
    );

    rerender({ open: false });
    dialog.remove();
    expect(advanceBlocked()).toBeNull();

    // A closed confirm's safe close is deregistered, so a later overlay cannot
    // inherit it as its safe action.
    const menu = openOverlay('menu');
    advanceBlocked()?.();
    expect(onSafeClose).not.toHaveBeenCalled();
    menu.remove();
    unmount();
  });

  // The handset readout says WHICH question a press answered (§4.14), so the
  // guard hands back the confirm's name alongside its safe close.
  it('names the innermost open confirm, and nothing for a bare picker popup', () => {
    const dialog = openOverlay('dialog');
    const { unmount } = renderHook(() => useConfirmGuard(true, vi.fn(), CONFIRM));

    expect(advanceOverlay()?.confirm).toEqual(CONFIRM);

    unmount();
    expect(advanceOverlay()?.confirm).toBeNull();
    dialog.remove();
    expect(advanceOverlay()).toBeNull();
  });

  // The readout announces the answer by name (`(Keep timing)`, §4.14), so the
  // seam issues the button that gives it: one registration, one label, one
  // focused target for the Space leg to land on.
  it("hands back the safe answer's button props", () => {
    const onSafeClose = vi.fn();
    const { result, unmount } = renderHook(() => useConfirmGuard(true, onSafeClose, CONFIRM));

    expect(result.current).toEqual({
      onClick: onSafeClose,
      autoFocus: true,
      children: CONFIRM.safeAction,
      'data-confirm-guard': '',
    });
    unmount();
  });

  /** The dialog MUI keeps mounted through a confirm's exit transition: `open`
   * is already false, but the answered question is still on screen — with the
   * seam's safe button, marker and all, inside it. */
  const openAnsweredDialog = (answer: ConfirmSafeAnswer): HTMLElement => {
    const dialog = openOverlay('dialog');
    const safeButton = document.createElement('button');
    safeButton.setAttribute('data-confirm-guard', answer['data-confirm-guard']);
    dialog.appendChild(safeButton);
    safeButton.focus(); // MUI autoFocuses it, and it keeps focus while closing
    return dialog;
  };

  // §4.8's "press again to advance": the answer ran on the first press, so the
  // second belongs to the board — it must not wait out an exit animation, and
  // the handset readout must not blame a picker that was never open.
  it('clears while the answered confirm is still animating out', () => {
    const { result, rerender, unmount } = renderHook(
      ({ open }) => useConfirmGuard(open, vi.fn(), CONFIRM),
      { initialProps: { open: true } },
    );
    const dialog = openAnsweredDialog(result.current);

    rerender({ open: false });

    expect(advanceOverlay()).toBeNull();
    dialog.remove();
    unmount();
  });

  // §4.8's other half, and the blur rule's third control (§4.4): the answer is
  // autoFocused, so once it has run it would own every Space until MUI finally
  // unmounts it — "press again to advance" dead for the length of the exit
  // animation, on the one trigger that cannot route around a focused button.
  it('hands the keyboard back when the question it answered closes', () => {
    const onAdvance = vi.fn();
    const advance = renderHook(() => useAdvanceInput(onAdvance));
    const { result, rerender, unmount } = renderHook(
      ({ open }) => useConfirmGuard(open, vi.fn(), CONFIRM),
      { initialProps: { open: true } },
    );
    const dialog = openAnsweredDialog(result.current);

    rerender({ open: false });

    expect(pressSpace()).toBe(false); // consumed: the answer no longer owns it
    expect(onAdvance).toHaveBeenCalledTimes(1);
    dialog.remove();
    unmount();
    advance.unmount();
  });

  // Only its own answer: a confirm closing must not yank focus off whatever the
  // operator moved to (a score field), which still owns its keystrokes (§4.3).
  it('leaves any other focus where it is', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const { result, rerender, unmount } = renderHook(
      ({ open }) => useConfirmGuard(open, vi.fn(), CONFIRM),
      { initialProps: { open: true } },
    );
    const dialog = openAnsweredDialog(result.current);
    field.focus();

    rerender({ open: false });

    expect(document.activeElement).toBe(field);
    dialog.remove();
    unmount();
  });

  // A dialog nobody registered (the buzzer-mapping reference sheet) is a real
  // overlay either way: ADVANCE stays inert behind it, with nothing to answer.
  it('still blocks behind a dialog no confirm registered', () => {
    const dialog = openOverlay('dialog');

    expect(advanceOverlay()).toEqual({ close: expect.any(Function), confirm: null });

    dialog.remove();
  });

  it('answers a pad-10 press behind a confirm with the safe close, never ADVANCE', () => {
    const onAdvance = vi.fn();
    const onSafeClose = vi.fn();
    const dialog = openOverlay('dialog');
    const confirm = renderHook(() => useConfirmGuard(true, onSafeClose, CONFIRM));
    gamepadState.lastPressedGamepadButton = { button: ADVANCE_BUTTON, seq: 1 };
    const advance = renderHook(() => useAdvanceInput(onAdvance));

    expect(onSafeClose).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
    dialog.remove();
    advance.unmount();
    confirm.unmount();
  });
});
