/**
 * Per-competition memory of the Freestyle board's last-chosen Quali/Battle mode
 * (the optional ADR 0036 follow-up): reopening the same comp's board restores
 * the operator's last mode instead of defaulting. Keyed off `compId` (= the
 * relay sessionId), alongside the localStorage-backed `selectedCompetition` —
 * device-local operator convenience, never data-plane state.
 */

export type FreestyleMode = 'quali' | 'battle';

const storageKey = (compId: string) => `speedline.freestyleMode.${compId}`;

/** The last mode stored for this competition, or null (unset / corrupted / no storage). */
export const readStoredFreestyleMode = (compId: string): FreestyleMode | null => {
  try {
    const stored = window.localStorage.getItem(storageKey(compId));
    return stored === 'quali' || stored === 'battle' ? stored : null;
  } catch {
    return null;
  }
};

export const storeFreestyleMode = (compId: string, mode: FreestyleMode): void => {
  try {
    window.localStorage.setItem(storageKey(compId), mode);
  } catch {
    // Private-mode / disabled storage: the board just defaults next session.
  }
};
