import React, { useState, useEffect, useRef } from 'react';
import { Stack, Typography } from '@mui/material';
import { ElapsedTime } from 'app/components/ElapsedTime';
import { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import { Plate } from 'app/pages/Stream/Plate';
import {
  CLOCK_PLATE_PX,
  CLOCK_PLATE_WIDTH,
  laneEdge,
  type LaneSide,
} from 'app/pages/Stream/TimerLaneBlock';
import { colors, fonts, overlayTextShadow } from 'app/theme/tokens';
import { refVh } from 'app/util/overlayScale';
import type { SpeedlineLaneState } from 'app/util/timerSnapshot';

// Race-state color for the hero numeral (design-system §2 / §6 "Hero timer
// numeral"): idle slate, running teal. A finished lane is the payload moment of
// the stream overlay, so it reads plain white (+ the §7 protection halo) to
// survive composited over dark/busy footage — slate ink.hi is near-invisible
// there — and white is chroma-safe on the magenta ground too. Idle keeps its
// recessive slate+halo placeholder (ADR 0041 §2).
// `onPlate` (size="plate"): the numeral sits on the white plate the component
// draws itself, so idle and finished digits take `overlay.nameInk` — the one
// black of every filled stream plate, including the SVO cards composited over
// this lower third.
const numeralColor = (isRunning: boolean, stopped: boolean, onPlate = false): string => {
  if (isRunning) return colors.race.running;
  if (onPlate) return colors.overlay.nameInk;
  return stopped ? 'common.white' : colors.ink.hi;
};

// Size variants of the hero block (variant roles: the `size` prop doc).
// `projector` and `control` size by clamp/vw (design-system §4); `plate` is in
// 1080p reference px like the rest of the /stream/* set.
const SIZES = {
  projector: {
    // Two lanes side by side, each in a `minmax(0,1fr)` column. The vw factor
    // stays well under the per-lane track budget (laneTrack / 4.2 for a 7-glyph
    // `M:SS.CC` at JetBrains Mono's ≈ 0.6em advance), so the numeral reads as a
    // compact figure biased to its lane's outer edge and the centre stays open.
    // Bump the vw term (and, for very wide walls, the rem cap) to grow it.
    numeral: 'clamp(2rem, 6vw, 12rem)',
    marker: 'clamp(0.75rem, 1.6vw, 1.5rem)',
  },
  control: {
    // One of the live deck's two lane tracks (`LIVE_DECK_SX`, ~5/13 of a
    // ≤880px deck); a 7-glyph `M:SS.CC` runs ~4.2em, so the vw factor and cap
    // keep it inside the column at every viewport — else the widest glyphs crop
    // against the column's overflow:hidden.
    numeral: 'clamp(1.5rem, 3.2vw, 2.75rem)',
    marker: 'clamp(0.625rem, 1vw, 0.875rem)',
  },
  // SpeedlineTimerDisplay's white lower-third, stacked over the
  // AthleteNameStrip: the reference draws the time at text-6xl (60px) on the
  // shared lane clock plate (`OVERLAY_LANE.clockPlate`).
  plate: {
    numeral: refVh(60),
    marker: refVh(14),
  },
} as const;

interface Props {
  /** The display's last lane-scoped relay frame (`start`/`stop`/`resume`/
   * `reset`) — a new object per frame, applied once per change. */
  laneFrame?: StopwatchWSMessage;
  /** Shows the block. The preview gates it on its socket being OPEN; the control
   * board's clocks are its own state and always show (`StopwatchControl`). */
  isReady: boolean;
  timerId: number;
  /**
   * A recovered lane state (peer-to-peer state recovery). Applied once on
   * change to reconstruct idle/running/finished without going through the
   * start/stop message replay (whose `time === 0` guard cannot reconstruct a
   * finished lane in a single tick).
   */
  recovery?: SpeedlineLaneState;
  /**
   * Controlled lane state (ControlPage owns timer state, ADR 0027): when set,
   * the component is presentational and `laneFrame` is ignored. The preview
   * leaves it unset and consumes relay frames.
   */
  laneState?: SpeedlineLaneState;
  /**
   * Render scale. `projector` (default) is the full-screen clamp/vw hero for the
   * preview/broadcast display; `control` is the ControlPage lane column, sized
   * so it cannot overflow onto the centre start strip; `plate` is the compact
   * lower-third — its own white plate around the time only (dark numeral, no
   * halo), the UNOFFICIAL marker below it on the bare ground (white + halo).
   */
  size?: 'projector' | 'control' | 'plate';
  /** `plate` only: the lane edge the time hugs inside its plate, mirroring the
   *  name strip above it. */
  plateAlign?: LaneSide;
}

export const Stopwatch: React.FC<Props> = ({
  laneFrame,
  isReady,
  timerId,
  recovery,
  laneState,
  size = 'projector',
  plateAlign = 'right',
}) => {
  const sizes = SIZES[size];
  const onPlate = size === 'plate';
  // On the white plate the halo (a dark outline meant to protect white text
  // over footage) reads as grime — the plate itself is the protection.
  const shadow = onPlate ? 'none' : overlayTextShadow;
  const [time, setTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const startTimeRef = useRef<number | null>(null);
  // The control-minted epoch this lane froze on — the watermark a snapshot has to
  // beat to un-freeze it (`mergeRecovery`). Null whenever the lane is not frozen.
  const stopTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [showTimerText, setShowTimerText] = useState<boolean>(false);

  // Stop the live tick synchronously the instant a lane freezes (stop / reset /
  // finished recovery), not one commit later in the [isRunning] effect: a 50ms
  // tick queued before the freeze must not overwrite the authoritative
  // stopTime−startTime with Date.now()−startTime (a frozen lane is skew-free by
  // construction, ADR 0021). The null handle also gates the tick callback, so a
  // tick whose task already dequeued bails instead of writing.
  const clearTick = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const start = (startTime: number) => {
    setTime(0);
    startTimeRef.current = startTime;
    stopTimeRef.current = null;
    setIsRunning(true);
    setShowTimerText(false);
  };

  const stop = (stopTime: number) => {
    // Gate on running state, not `time === 0`: a sub-50ms stop lands before the
    // first tick, while `time` is still 0.
    if (!isRunning || startTimeRef.current === null) return;
    clearTick();
    stopTimeRef.current = stopTime;
    setIsRunning(false);
    setTime(stopTime - startTimeRef.current);
    setShowTimerText(true);
  };

  // Undo of a withdrawn stop: the start epoch is kept, so the clock picks up
  // exactly where it would have been — no epoch travels on the wire.
  const resume = () => {
    if (isRunning || startTimeRef.current === null) return;
    stopTimeRef.current = null;
    setIsRunning(true);
    setShowTimerText(false);
    setTime(Date.now() - startTimeRef.current);
  };

  const reset = () => {
    clearTick();
    stopTimeRef.current = null;
    setIsRunning(false);
    setTime(0);
    setShowTimerText(false);
  };

  // Reconstruct a lane state directly, not by replaying start/stop: shared by
  // `recovery` (preview snapshot merge) and the controlled `laneState`.
  const applyLaneState = (state: SpeedlineLaneState) => {
    switch (state.kind) {
      case 'idle':
        reset();
        break;
      case 'running':
        startTimeRef.current = state.startTime;
        stopTimeRef.current = null;
        setTime(Date.now() - startTimeRef.current);
        setIsRunning(true);
        setShowTimerText(false);
        break;
      case 'finished':
        clearTick();
        startTimeRef.current = state.startTime;
        stopTimeRef.current = state.stopTime;
        setIsRunning(false);
        setTime(state.elapsedMs);
        setShowTimerText(true);
        break;
    }
  };

  const controlled = laneState !== undefined;

  useEffect(() => {
    if (controlled || !laneFrame) {
      return;
    }
    const { data, type } = laneFrame;
    switch (type) {
      case 'start':
        // A start ignites only its listed lanes (a solo quali run — the other
        // lane stays dormant, cleared of any prior run's frozen time).
        if (!data.lanes.includes(timerId)) {
          reset();
          break;
        }
        // Idempotent confirmation: the seed-driven GO ignition (recovery path)
        // may already run this lane on the SAME schedule epoch — restarting
        // would blip the numeral to 0 for a frame. Same epoch = same race.
        if (isRunning && startTimeRef.current === data.startTime) {
          break;
        }
        start(data.startTime);
        break;
      case 'stop':
        if (data.timerId == timerId || data.timerId === -1) {
          stop(data.stopTime);
        }
        break;
      case 'resume':
        if (data.timerId === timerId) {
          resume();
        }
        break;
      case 'reset':
        reset();
        break;
    }
  }, [laneFrame]);

  // Snapshot recovery (preview): merge newer-wins per lane, since a snapshot can
  // arrive AFTER live messages (the display forwards every snapshot; ADR 0047
  // for the `assertedAt` stamp). All startTimes are control-minted epochs, so
  // comparing them never crosses machine clocks:
  //  - a blank lane takes whatever the snapshot has (the fresh-open case);
  //  - a NEWER startTime is a later run — take it;
  //  - the SAME startTime + snapshot `finished` while we still run is a stop
  //    this display missed — freeze the lane (the running-forever fix);
  //  - the SAME startTime + snapshot `running` while we are frozen is a `resume`
  //    this display missed — but only if the snapshot was ASSERTED after the
  //    stop we applied (`assertedAt`, the control's own clock on both sides of
  //    the comparison). A snapshot built before that stop is simply describing
  //    the lane as it was, and un-freezing on it would revive a finished race;
  //  - anything else (older/equal info, or `idle` over a lane with state) is
  //    stale or ambiguous — keep what live messages built.
  const mergeRecovery = (state: SpeedlineLaneState) => {
    const currentStart = startTimeRef.current;
    if (state.kind === 'idle') {
      if (currentStart === null) applyLaneState(state);
      return;
    }
    if (currentStart === null || state.startTime > currentStart) {
      applyLaneState(state);
      return;
    }
    if (state.startTime !== currentStart) {
      return;
    }
    if (state.kind === 'finished' && isRunning) {
      applyLaneState(state);
      return;
    }
    const frozenAt = stopTimeRef.current;
    if (
      state.kind === 'running' &&
      !isRunning &&
      frozenAt !== null &&
      state.assertedAt != null &&
      state.assertedAt > frozenAt
    ) {
      applyLaneState(state);
    }
  };

  useEffect(() => {
    if (controlled || !recovery) {
      return;
    }
    mergeRecovery(recovery);
  }, [recovery]);

  useEffect(() => {
    if (laneState === undefined) {
      return;
    }
    applyLaneState(laneState);
  }, [laneState]);

  useEffect(() => {
    if (isRunning && startTimeRef.current) {
      // The handle IS cleared — by `clearTick`, both as this effect's cleanup
      // (returned below) and in the else branch. The rule only recognises a
      // literal `clearInterval` in the cleanup, not the shared helper.
      // eslint-disable-next-line @eslint-react/web-api-no-leaked-interval
      intervalRef.current = setInterval(() => {
        // Nulled by a synchronous freeze (`clearTick`).
        if (intervalRef.current === null) return;
        setTime(Date.now() - startTimeRef.current!);
      }, 50);
    } else {
      clearTick();
    }

    return clearTick;
  }, [isRunning]);

  return (
    <Stack
      sx={{
        display: isReady ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        // Fences a running control-variant numeral off the centre start strip.
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      {/* The plate wraps the TIME ONLY, so its height is constant; the marker
          sits outside it on the bare ground. */}
      {onPlate ? (
        <Plate
          bordered={false}
          fill={colors.overlay.plateFilled}
          data-testid="stopwatch-plate"
          sx={{
            width: CLOCK_PLATE_WIDTH,
            px: CLOCK_PLATE_PX,
            display: 'flex',
            justifyContent: laneEdge(plateAlign),
          }}
        >
          <ElapsedTime
            ms={time}
            component="div"
            fontSize={sizes.numeral}
            lineHeight={1}
            fontWeight="bold"
            color={numeralColor(isRunning, showTimerText, true)}
            textShadow="none"
          />
        </Plate>
      ) : (
        <ElapsedTime
          ms={time}
          component="div"
          fontSize={sizes.numeral}
          lineHeight={1}
          fontWeight="bold"
          color={numeralColor(isRunning, showTimerText)}
          textShadow={shadow}
        />
      )}
      {/* Kept mounted, toggled via visibility, so the numeral (and its plate)
          never move when a lane freezes/resets. White + the §7 halo on every
          variant: it paints on the bare ground, below any plate. */}
      <Typography
        component="div"
        sx={{
          fontFamily: fonts.display,
          fontSize: sizes.marker,
          fontWeight: 'bold',
          letterSpacing: '0.08em',
          color: colors.ink.onBrand,
          textShadow: overlayTextShadow,
          ...(onPlate && { mt: refVh(6) }),
          visibility: showTimerText ? 'visible' : 'hidden',
        }}
      >
        UNOFFICIAL
      </Typography>
    </Stack>
  );
};
