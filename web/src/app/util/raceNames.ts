import type { Athlete } from 'app/types';

import type { LaneId } from 'app/hooks/useRaceRecorder';
import type { PlayerId } from 'app/util/breakState';

/**
 * Pure helpers for resolving a lane's assigned athlete into the display name
 * shown above each Stopwatch on the Speedline projector / OBS overlay. Kept free
 * of React/IO (sibling of raceTime.ts) so the shortName/name fallback is
 * exhaustively testable — the live control & preview pages can't be unit-tested
 * (they open real WebSocket connections).
 */

/** Lane display name: `shortName` → `lastName` → `name`; `''` for an unassigned lane or unknown athlete. */
export const laneName = (athleteId: string, athletes: Athlete[]): string => {
  if (!athleteId) return '';
  const match = athletes.find((a) => a.athleteId === athleteId);
  if (!match) return '';
  return match.shortName || match.lastName || match.name;
};

/** Build the `updateLaneNames` WS payload from the recorder's per-lane selection. */
export const laneNamesInput = (
  laneAthletes: Record<LaneId, string>,
  athletes: Athlete[],
): { lane1: string; lane2: string } => ({
  lane1: laneName(laneAthletes[1], athletes),
  lane2: laneName(laneAthletes[2], athletes),
});

/**
 * How every surface names the athlete on a side: their resolved name, or the
 * slot itself until one is picked. One helper because the fallback was copied
 * per panel, and the copies are what a rename splits — **Athlete**, never
 * Player (the board's retired word, pinned by the manual's vocabulary guard).
 */
export const athleteLabel = (side: PlayerId, name?: string): string => name || `Athlete ${side}`;
