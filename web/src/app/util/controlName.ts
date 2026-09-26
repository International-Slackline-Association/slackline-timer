/**
 * How the Freestyle board names a per-athlete control (FREESTYLE_BOARD_UX §10).
 *
 * The board renders two of nearly everything, so every per-athlete control
 * answers to `<verb> Athlete <n>` — a screen reader needs it, and a test that
 * cannot say which athlete slot it means ends up addressing one by DOM position.
 * The spelling has one owner here so a later rewrite of the transport cannot
 * drop the suffix in one place, and so the on-screen twin and the handset row
 * for the same physical key (§4.14) cannot word one press two ways —
 * `buzzerRows` generates its actions from this module.
 */

import type { FreestyleMode } from 'app/state/freestyleModeMemory';
import type { LaneButtonRole } from 'app/util/buzzer';
import type { PlayerId } from 'app/util/breakState';

export const athleteControlName = (label: string, athlete: PlayerId): string =>
  `${label} Athlete ${athlete}`;

/** The verb a handset role carries, in the manual's vocabulary. `aux` is the
 * one that is mode-dependent: quali's advisory break and battle's End turn are
 * the same green key (§4.14). */
export const laneControlVerb = (role: LaneButtonRole, mode: FreestyleMode): string => {
  switch (role) {
    case 'start':
      return 'Start';
    case 'reset':
      return 'Reset';
    case 'aux':
      return mode === 'battle' ? 'End turn' : 'Take break';
    case 'try':
      return 'Start try';
    case 'stop':
      return 'Stop';
  }
};

export const laneControlName = (
  role: LaneButtonRole,
  mode: FreestyleMode,
  athlete: PlayerId,
): string => athleteControlName(laneControlVerb(role, mode), athlete);
