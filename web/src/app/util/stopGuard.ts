// Guard for the Speedline per-lane Stop. The UI button is disabled outside a
// running lane, but the gamepad path (buttons 10/15) fires unconditionally, and
// a lane's start stays set until Reset — a repeat press would re-freeze the lane
// at a later stopTime and relay it to every peer and overlay (`recordFinish`
// keeps its own once-per-run lock on the Time and the lane result).
//
// `canStopLane` is the single decision for both paths: valid only once the race
// has started and before that lane has stopped. A false start never routes here
// — it never stops the lanes (rule S4).

export interface LaneStopGuardState {
  /** Race start epoch, or null when no race is live (never started / reset). */
  startTime: number | null;
  /** Per-lane stop epochs; a lane is still timing while its entry is null. */
  stopTimes: Record<number, number | null>;
}

export const canStopLane = ({ startTime, stopTimes }: LaneStopGuardState, timer: number): boolean =>
  startTime !== null && stopTimes[timer] === null;
