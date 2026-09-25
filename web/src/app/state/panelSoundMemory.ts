/**
 * Per-DEVICE memory of whether this control panel sounds the race tones.
 *
 * The horn has an owner, not a dedupe: two panels mirroring one competition
 * (ADR 0038) cannot agree between them who beeps — the relay carries no
 * presence — so an expiry sounds on the panel whose own clock crossed zero. At
 * a judges' desk where the PA hangs off the panel that is NOT the one pressing,
 * that is the wrong panel, and only the operator knows which one it is. This is
 * that answer, made a visible control (the header's `Sound on this panel` chip)
 * rather than a silent default.
 *
 * Device-local, deliberately NOT keyed by competition: it describes which box
 * is wired to the speakers, which survives the event on it. Venue surfaces
 * (preview / athlete display) are unaffected — they always sound every channel
 * (ADR 0015 §3).
 */

const STORAGE_KEY = 'speedline.panelSound';

/** Whether this panel sounds its tones. Defaults to on — a board that has never
 * been configured is a single board, and a silent one is the surprise. */
export const readPanelSound = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const storePanelSound = (on: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private-mode / disabled storage: the panel just sounds again next session.
  }
};
