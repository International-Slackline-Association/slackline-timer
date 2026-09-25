import { useCallback, useEffect, useRef } from 'react';

import { useGamepads } from 'app/hooks/useGamepads';
import { ADVANCE_BUTTON } from 'app/util/buzzer';

/** Overlays that own the board while they are up: the MUI confirms and any
 * open picker popup (a non-native `Select` renders `ul[role=listbox]`). */
const OVERLAY_SELECTOR = '[role="dialog"], [role="listbox"], [role="menu"]';

/** The safe answer's marker, riding into the DOM on its button: an overlay
 * holding one is a confirm this seam registers, so one the seam is NOT holding
 * open is a dialog MUI is merely animating out (~195 ms after the answer ran).
 * The DOM alone cannot tell that from a question still standing — reading it
 * alone kept ADVANCE inert across the transition, against §4.8's "press again
 * to advance", with the handset readout blaming a picker that was never open. */
const CONFIRM_MARKER = '[data-confirm-guard]';

/** Focused elements a Space belongs to — typing it, picking with it, or (the
 * `button` / `[role=button]` / `a[href]` tier) activating it: on a focused
 * button Space IS the browser's click of that button, one action never two, and
 * on a focused link it is nothing at all (FREESTYLE_BOARD_UX §4.3). That tier is
 * safe only because every control the operator touches mid-match drops the focus
 * again (§4.4): the live column and the board chrome on the mouse press
 * (`RaceButton` / `blurOnClickProps`), an answered confirm as its question
 * closes (`useConfirmGuard` below) — without that a clicked Stop would swallow
 * the next buzzer press, and a clicked projector link would silently eat every
 * one after it. */
const KEYSTROKE_OWNER_SELECTOR =
  'input, textarea, select, [contenteditable], [role="combobox"], [role="listbox"], [role="option"], button, [role="button"], a[href]';

const isKeystrokeOwner = (el: Element | null): boolean =>
  el !== null && (el.matches(KEYSTROKE_OWNER_SELECTOR) || (el as HTMLElement).isContentEditable);

/** An open confirm, named: what the handset readout calls it, and the safe
 * answer an ADVANCE press behind it gives (brief §4.8/§4.14). */
export interface ConfirmGuard {
  /**
   * The question, as the readout names it — e.g. `Reset Athlete 1`. Both lines
   * it feeds send the operator to a control (`→ closed the … dialog`,
   * `→ locked: answer the … question first`), so it is the name of the one that
   * RAISED the question, off that control's own owner rather than spelled a
   * second time here — and per instance wherever a board stands more than one
   * of a question (per lane, per picker), since a fixed name then points at
   * something the operator cannot find.
   */
  dialog: string;
  /** Its autoFocused safe button — e.g. `Keep timing`. */
  safeAction: string;
}

interface RegisteredConfirm extends ConfirmGuard {
  close: () => void;
}

/**
 * The safe answer's button, issued by the seam that registers it: the MUI props
 * for the confirm's autoFocused safe action. Every ADVANCE leg relies on those
 * three facts agreeing with the registration — Space lands on the focused
 * button, pad 10 and the plate call `onClick`, and the handset readout
 * announces `children` by name (§4.8/§4.14) — so a dialog spreads this rather
 * than re-typing the word next to a hand-set `autoFocus`.
 */
export interface ConfirmSafeAnswer {
  onClick: () => void;
  autoFocus: true;
  children: string;
  /** `CONFIRM_MARKER`: spread with the rest, so no call site maintains it. */
  'data-confirm-guard': '';
}

/**
 * The open confirms, innermost last — pushed by `useConfirmGuard` for as long
 * as each is open. The input seam never decides anything from this; it only
 * hands back the answer a press should give, plus the name the readout logs.
 */
const confirms: RegisteredConfirm[] = [];

/** The blocked-but-nothing-to-answer action (an open picker popup: closing it
 * is the browser's business, so the press is simply inert). */
const doNothing = () => {};

/**
 * The ONE ADVANCE guard (the brief's §4.3), consulted by all three
 * triggers — Space, pad 10 and the plate — so they cannot diverge behind a
 * modal: the overlay standing in the way, with the safe close to call and the
 * confirm to name (null when the overlay is a bare picker popup), or `null`
 * when nothing is up and the press advances normally. A press behind a confirm
 * **is** that confirm's safe action and nothing else (§4.8): the pad and the
 * plate call `close`, while Space simply bails so the browser lands it on the
 * confirm's autoFocused safe button — press again to advance.
 */
export const advanceOverlay = (): { close: () => void; confirm: ConfirmGuard | null } | null => {
  const overlays = Array.from(document.querySelectorAll(OVERLAY_SELECTOR));
  if (overlays.length === 0) return null;
  const innermost = confirms.at(-1);
  if (innermost !== undefined) {
    return {
      close: innermost.close,
      confirm: { dialog: innermost.dialog, safeAction: innermost.safeAction },
    };
  }
  // Nothing is open to answer, so a marked overlay is an answered confirm on its
  // way out: only an unmarked one still owns the board.
  return overlays.some((overlay) => overlay.querySelector(CONFIRM_MARKER) === null)
    ? { close: doNothing, confirm: null }
    : null;
};

/** `advanceOverlay`'s answer alone, for the triggers that only need to act. */
export const advanceBlocked = (): (() => void) | null => advanceOverlay()?.close ?? null;

/**
 * An overlay owns the board. ADVANCE is the one key with an answer for that
 * state (§4.8); every **other** handset key is simply inert until the question
 * is answered — the on-screen twins already sit behind the modal backdrop, so
 * the pad path is the only one that reaches a lane's transport from behind an
 * open confirm. `handsetOutcome` reads the same guard to word the readout.
 */
export const overlayOwnsBoard = (): boolean => advanceOverlay() !== null;

/**
 * Register a confirm's safe close (Keep timing / Keep match / Keep series) for
 * as long as it is `open`, so an ADVANCE press behind it answers it safely and
 * the handset readout can say which question the press answered; hands back the
 * safe button to render, so the label the readout claims is the one the
 * operator reads on screen.
 * The callback rides in a ref — a fresh closure per render re-registers nothing.
 *
 * Registration is keyed on `open`, not on the dialog's mount: MUI keeps a
 * closing dialog mounted across its exit transition, and a press in that window
 * must advance the board, not re-answer a question that is already gone — which
 * holds only because the answer carries `CONFIRM_MARKER` into that leftover
 * dialog.
 */
export const useConfirmGuard = (
  open: boolean,
  onSafeClose: () => void,
  guard: ConfirmGuard,
): ConfirmSafeAnswer => {
  const onSafeCloseRef = useRef(onSafeClose);
  onSafeCloseRef.current = onSafeClose;
  const { dialog, safeAction } = guard;

  useEffect(() => {
    if (!open) return;
    const entry: RegisteredConfirm = { dialog, safeAction, close: () => onSafeCloseRef.current() };
    confirms.push(entry);
    return () => {
      confirms.splice(confirms.indexOf(entry), 1);
      // The blur rule for the one control that cannot carry it on the press
      // (§4.4): the answer is autoFocused, and MUI keeps it mounted — focused —
      // through the exit transition, so it would own Space for that whole
      // window and §4.8's "press again to advance" would be dead on the trigger
      // that has no way around a focused button. Only the marked answer is
      // blurred; any focus the operator has moved on to is left alone, as is
      // whatever MUI restores afterwards.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches(CONFIRM_MARKER)) focused.blur();
    };
  }, [open, dialog, safeAction]);

  return { onClick: onSafeClose, autoFocus: true, children: safeAction, 'data-confirm-guard': '' };
};

/**
 * The one-button Freestyle advance input (ADR 0037): a physical buzzer
 * presenting as keyboard Space and/or one gamepad button steps the whole
 * board sequence. This hook is only the input seam — what a press *means*
 * (the mode cycle tables) lives in the battle machine's ADVANCE transition
 * and the page's try-series routing.
 *
 * Space is guarded off `advanceBlocked` and off whatever owns the keystroke
 * (text entry, an open picker), ignores key auto-repeat (one press = one step),
 * and is consumed (`preventDefault`) only once it advances — so it neither
 * scrolls the board nor "clicks" a still-focused lane button, while a guarded
 * press stays the browser's to deliver.
 *
 * The callback rides in a ref, so callers pass a plain closure (fresh state
 * every render) without re-subscribing the window listener.
 *
 * It hands the guarded press back for the third trigger — the TALLY plate's
 * click (§4.1) — so the plate presses this seam instead of holding a copy of
 * the guard, and the two mouse/pad legs cannot answer a confirm differently.
 */
export const useAdvanceInput = (onAdvance: () => void): (() => void) => {
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  // Stable: the plate passes it straight to `onClick`, and a new identity every
  // render would re-render the loudest object on the board for nothing.
  const press = useCallback(() => {
    const safeClose = advanceBlocked();
    if (safeClose !== null) {
      safeClose();
      return;
    }
    onAdvanceRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      // Deliberately NOT the safe close: the browser lands the press on the
      // confirm's autoFocused safe button itself (one action, never two).
      if (advanceBlocked() !== null) return;
      if (isKeystrokeOwner(document.activeElement)) return;
      event.preventDefault();
      onAdvanceRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The pad leg: keyed on the press token (monotonic seq), so a deliberate
  // same-button re-press fires while a mere re-render does not.
  const { lastPressedGamepadButton } = useGamepads();
  useEffect(() => {
    if (lastPressedGamepadButton?.button !== ADVANCE_BUTTON) return;
    press();
  }, [lastPressedGamepadButton, press]);

  return press;
};
