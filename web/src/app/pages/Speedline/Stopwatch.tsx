import React, { useLayoutEffect, useState } from 'react';
import { Stack, Typography } from '@mui/material';
import { ElapsedTime } from 'app/components/ElapsedTime';
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
  /** Shows the block. The preview gates it on its socket being OPEN; the control
   * board's clocks are its own state and always show (`StopwatchControl`). */
  isReady: boolean;
  /**
   * The lane to render, owned by the page: the control board's lane timers
   * (ADR 0027) or the display's relay-frame reducer (`app/util/previewLanes`).
   * A lane that mounts mid-race paints from it on its first render.
   */
  laneState: SpeedlineLaneState;
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
  isReady,
  laneState,
  size = 'projector',
  plateAlign = 'right',
}) => {
  const sizes = SIZES[size];
  const onPlate = size === 'plate';
  // On the white plate the halo (a dark outline meant to protect white text
  // over footage) reads as grime — the plate itself is the protection.
  const shadow = onPlate ? 'none' : overlayTextShadow;
  const isRunning = laneState.kind === 'running';
  const showTimerText = laneState.kind === 'finished';

  // Only a running lane ticks, off its start epoch (anchor + wall clock). Keyed
  // on the epoch, so a new lane object for the same run keeps the interval.
  const runStart = laneState.kind === 'running' ? laneState.startTime : null;
  const [runningMs, setRunningMs] = useState<number>(() =>
    runStart === null ? 0 : Date.now() - runStart,
  );
  // Layout, not passive: a lane that starts or resumes paints its true elapsed
  // in the same frame instead of the previous run's last tick.
  useLayoutEffect(() => {
    if (runStart === null) return;
    setRunningMs(Date.now() - runStart);
    const id = setInterval(() => setRunningMs(Date.now() - runStart), 50);
    return () => clearInterval(id);
  }, [runStart]);

  // A frozen lane renders its control-minted elapsed, never the tick: a tick
  // that fires after the freeze cannot move it (skew-free, ADR 0021).
  const time =
    laneState.kind === 'running'
      ? runningMs
      : laneState.kind === 'finished'
        ? laneState.elapsedMs
        : 0;

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
