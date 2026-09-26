/**
 * The Speedline desk's handset mapping and what a press just did — the second
 * board's half of FREESTYLE_BOARD_UX §4.14, over the shared readout.
 *
 * Both halves live here together on purpose: the rows are what the operator is
 * shown, the verdicts are what the pad effect in `Speedline/ControlPage` does,
 * and a mapping listed apart from the guard it describes is how the two drift
 * (audit S18). The verdicts read the page's own `speedlineLocks` map rather
 * than re-deciding anything — so a dead key and the why-line under its
 * on-screen twin are the same sentence.
 */

import type { ConfirmGuard } from 'app/hooks/useAdvanceInput';
import type { BuzzerMappingRow } from 'app/util/buzzer';
import { overlayLockReason, type HandsetOutcome } from 'app/util/handsetReadout';
import type { SpeedlineLocks } from 'app/util/speedlineLocks';

/**
 * Two handsets for the starter, one per lane judge — the indices the pad effect
 * dispatches on (`doc/dev/buzzer-hardware.md`).
 */
export const SPEEDLINE_BUZZER_ROWS: BuzzerMappingRow[] = [
  { button: 0, action: 'Start (with lights)' },
  { button: 1, action: 'Reset' },
  { button: 5, action: 'Abort start' },
  { button: 10, action: 'Stop lane 1' },
  { button: 11, action: 'False start — lane 1' },
  { button: 15, action: 'Stop lane 2' },
  { button: 16, action: 'False start — lane 2' },
];

export interface SpeedlineHandsetContext {
  /** The board's interlock table, exactly as the buttons read it. */
  locks: SpeedlineLocks;
  /** The overlay `advanceOverlay()` reports at the instant of the press. */
  overlay: { confirm: ConfirmGuard | null } | null;
}

const verdict = (reason: string | null, action: string): HandsetOutcome =>
  reason === null ? { kind: 'fired', action } : { kind: 'locked', reason };

/**
 * What pressing `button` would do on this board, right now.
 *
 * Two keys answer to no lock because the handler gives them none: **Reset**
 * raises the confirm instead of being held by the run (it is the way out of a
 * run gone wrong, so the question guards it, not a lock), and the **false-start
 * flags** are always armed — a jump may be reviewed on video after the run
 * (rule S4).
 */
export const speedlineHandsetOutcome = (
  button: number,
  { locks, overlay }: SpeedlineHandsetContext,
): HandsetOutcome => {
  const row = SPEEDLINE_BUZZER_ROWS.find((r) => r.button === button);
  if (row === undefined) return { kind: 'unbound' };
  // Before the board is consulted at all: the pad effect bails on
  // `overlayOwnsBoard()` ahead of every interlock, and this desk binds no
  // answer to the pad — so every key is held by the question, not by the board.
  if (overlay !== null) return { kind: 'locked', reason: overlayLockReason(overlay.confirm) };

  switch (button) {
    case 0:
      return verdict(locks.start, row.action);
    case 5:
      return verdict(locks.abort, row.action);
    case 10:
      return verdict(locks.stop[1], row.action);
    case 15:
      return verdict(locks.stop[2], row.action);
    default:
      return { kind: 'fired', action: row.action };
  }
};
