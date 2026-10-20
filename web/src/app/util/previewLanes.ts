import type { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import {
  isSpeedlineSnapshot,
  speedlineLaneState,
  type SpeedlineLaneState,
} from 'app/util/timerSnapshot';

/**
 * The Speedline display's two lane clocks as one pure reducer over the relay
 * frames it receives (ADR 0051 §5): the receive callback dispatches each frame,
 * and the `Stopwatch`es render the lane state handed down. Every epoch here is
 * control-minted, so comparisons never cross machine clocks.
 */

/** One display lane. `idle.clearedStart` is the start epoch of the run a reset
 * (or a solo start leaving this lane out) cleared: the watermark a snapshot must
 * beat, so a snapshot built before that reset cannot revive the run. */
export type PreviewLane =
  | { kind: 'idle'; clearedStart: number | null }
  | { kind: 'running'; startTime: number }
  | { kind: 'finished'; startTime: number; stopTime: number; elapsedMs: number };

export type PreviewLanes = Readonly<{ 1: PreviewLane; 2: PreviewLane }>;

/** The display's own GO edge, off the seed anchor: the seeded lanes start on the
 * schedule epoch before the authoritative `start` arrives (which then confirms
 * the same epoch). Merged newer-wins like a snapshot. */
export type IgniteEvent = { type: 'ignite'; lanes: number[]; goEpoch: number };

export type PreviewLaneEvent = StopwatchWSMessage | IgniteEvent;

export const INITIAL_PREVIEW_LANES: PreviewLanes = {
  1: { kind: 'idle', clearedStart: null },
  2: { kind: 'idle', clearedStart: null },
};

/** The start epoch of the newest run this lane has seen, cleared or not. */
const lastStart = (lane: PreviewLane): number | null =>
  lane.kind === 'idle' ? lane.clearedStart : lane.startTime;

const cleared = (lane: PreviewLane): PreviewLane =>
  lane.kind === 'idle' ? lane : { kind: 'idle', clearedStart: lane.startTime };

const fromRecovered = (state: Exclude<SpeedlineLaneState, { kind: 'idle' }>): PreviewLane =>
  state.kind === 'running'
    ? { kind: 'running', startTime: state.startTime }
    : {
        kind: 'finished',
        startTime: state.startTime,
        stopTime: state.stopTime,
        elapsedMs: state.elapsedMs,
      };

/**
 * Newer-wins per lane, since a snapshot can land after live frames (every
 * snapshot is forwarded; ADR 0047 for `assertedAt`):
 *  - an idle row is never newer than anything — keep the lane;
 *  - a blank lane, or a later run (newer startTime), takes the row;
 *  - the same run `finished` while we still run is a stop this display missed
 *    — freeze (the running-forever fix);
 *  - the same run `running` while we are frozen is a missed `resume` — but only
 *    if the snapshot was asserted after the stop we applied (the control's own
 *    clock on both sides); an earlier snapshot describes the lane as it was;
 *  - anything else is stale or ambiguous — keep what live frames built.
 */
const merge = (lane: PreviewLane, incoming: SpeedlineLaneState): PreviewLane => {
  if (incoming.kind === 'idle') return lane;
  const seen = lastStart(lane);
  if (seen === null || incoming.startTime > seen) return fromRecovered(incoming);
  if (incoming.startTime !== seen) return lane;
  if (incoming.kind === 'finished' && lane.kind === 'running') return fromRecovered(incoming);
  if (
    incoming.kind === 'running' &&
    lane.kind === 'finished' &&
    incoming.assertedAt != null &&
    incoming.assertedAt > lane.stopTime
  ) {
    return fromRecovered(incoming);
  }
  return lane;
};

/** Apply `next` per lane, returning the SAME state when no lane changed so React
 * bails out of the render. */
const perLane = (
  state: PreviewLanes,
  next: (lane: PreviewLane, id: 1 | 2) => PreviewLane,
): PreviewLanes => {
  const l1 = next(state[1], 1);
  const l2 = next(state[2], 2);
  return l1 === state[1] && l2 === state[2] ? state : { 1: l1, 2: l2 };
};

export const previewLanesReducer = (state: PreviewLanes, event: PreviewLaneEvent): PreviewLanes => {
  switch (event.type) {
    case 'start': {
      const { startTime, lanes } = event.data;
      return perLane(state, (lane, id) => {
        if (!lanes.includes(id)) return cleared(lane);
        // Same epoch = same race: the GO ignition already runs it.
        if (lane.kind === 'running' && lane.startTime === startTime) return lane;
        return { kind: 'running', startTime };
      });
    }
    case 'stop': {
      const { timerId, stopTime } = event.data;
      return perLane(state, (lane, id) =>
        lane.kind === 'running' && (timerId === id || timerId === -1)
          ? {
              kind: 'finished',
              startTime: lane.startTime,
              stopTime,
              elapsedMs: Math.max(0, stopTime - lane.startTime),
            }
          : lane,
      );
    }
    case 'resume':
      // The undo of a withdrawn stop: the original start epoch carries on.
      return perLane(state, (lane, id) =>
        lane.kind === 'finished' && event.data.timerId === id
          ? { kind: 'running', startTime: lane.startTime }
          : lane,
      );
    case 'reset':
      return perLane(state, cleared);
    case 'state_snapshot': {
      const { data } = event;
      // A Freestyle control sharing the room answers with a CountdownSnapshot.
      if (!isSpeedlineSnapshot(data)) return state;
      return perLane(state, (lane, id) =>
        merge(
          lane,
          speedlineLaneState(
            data.timers.find((t) => t.timerId === id) ?? {
              timerId: id,
              startTime: null,
              stopTime: null,
            },
            data.at,
          ),
        ),
      );
    }
    case 'ignite':
      return perLane(state, (lane, id) =>
        event.lanes.includes(id)
          ? merge(lane, { kind: 'running', startTime: event.goEpoch })
          : lane,
      );
    case 'updatePreview':
    case 'updateLaneNames':
    case 'updateSelection':
    case 'request_state':
    case 'updateSignalPhase':
    case 'updateText':
      return state;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
};
