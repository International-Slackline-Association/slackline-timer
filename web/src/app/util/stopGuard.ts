// Guard for the Speedline per-lane Stop action. The UI stop button is disabled
// outside a running lane, but the gamepad handler (buttons 10/15) fires
// unconditionally — after a lane finishes, the race start stays set until
// Reset, so a repeat press would re-send a later stopTime (POSTing a second,
// longer Time for the same run), overwrite the lane result (it can flip the
// derived match winner while the other lane still runs), and drive
// `runningTimerCount` negative.
//
// `canStopLane` is the single decision for both paths: a per-lane stop is
// valid only mid-race — the race has started and that lane has not stopped
// yet. The all-lanes false start (`stop(-1)`) is intentionally NOT routed
// through this guard: it legitimately fires before the race starts.

export interface LaneStopGuardState {
  /** Race start epoch, or null when no race is live (never started / reset). */
  startTime: number | null;
  /** Per-lane stop epochs; a lane is still timing while its entry is null. */
  stopTimes: Record<number, number | null>;
}

export const canStopLane = ({ startTime, stopTimes }: LaneStopGuardState, timer: number): boolean =>
  startTime !== null && stopTimes[timer] === null;
