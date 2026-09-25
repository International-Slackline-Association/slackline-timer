/**
 * One lane card's state word and visual tier (FREESTYLE_BOARD_UX §3/§6).
 *
 * The reducer already knows everything the operator needs; the board said none
 * of it (audit S02 — lane state was hue-only, and a lane that had taken a turn
 * was pixel-identical to one that had not). This is the missing derivation, in
 * one pure place so the card word, the card frame and the state hue cannot
 * disagree.
 *
 * The one non-obvious row is **held**: a fall leaves the lane `idle` again, so
 * `phase` alone cannot tell "armed and waiting" from "ran, and holds what is
 * left". `armedMs` (the budget the lane was last armed to, ADR 0046) is what
 * separates them, and the word names the value at stake.
 */

import { isPristine, type LaneState } from 'app/util/battleMachine';
import { formatClock } from 'app/util/time';

/** The card's visual tier — its frame stroke, its word's colour tier. */
export type LaneCardTier = 'ready' | 'running' | 'break' | 'held' | 'finished';

export interface LaneCardState {
  tier: LaneCardTier;
  /** The always-rendered state word (§4.12: never an empty slot). */
  word: string;
}

export const laneCardState = (lane: LaneState): LaneCardState => {
  switch (lane.phase) {
    case 'running':
      return { tier: 'running', word: 'RUNNING' };
    case 'onBreak':
      return { tier: 'break', word: `BREAK · ${lane.breaksLeft} LEFT` };
    case 'finished':
      return { tier: 'finished', word: 'FINISHED' };
    case 'idle':
      return isPristine(lane)
        ? { tier: 'ready', word: 'READY' }
        : { tier: 'held', word: `TURN TAKEN · ${formatClock(lane.budgetMs)} held` };
  }
};
