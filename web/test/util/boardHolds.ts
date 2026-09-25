/**
 * Every `BoardHold`, at the widest shape each one has (lane 2). Keyed by kind,
 * so a hold added to the union fails to typecheck until it is listed here and
 * every suite that walks the table covers it.
 *
 * Shared because a hold's words are asserted from two sides: that a locked
 * control renders them (`lockReason` defers to `holdReason`) and that the
 * why-line reserves room for the longest of them.
 */

import type { BoardHold } from 'app/util/boardState';

export const EVERY_HOLD: Record<BoardHold['kind'], BoardHold> = {
  running: { kind: 'running', lane: 2 },
  onBreak: { kind: 'onBreak', lane: 2 },
  tryOpen: { kind: 'tryOpen' },
  changeover: { kind: 'changeover' },
  warmup: { kind: 'warmup' },
  bestTrick: { kind: 'bestTrick' },
  held: { kind: 'held', lane: 2 },
  spent: { kind: 'spent', lane: 2 },
};
