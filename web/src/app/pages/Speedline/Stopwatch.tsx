import React, { useState, useEffect, useRef } from 'react';
import { Stack, Typography } from '@mui/material';
import { ElapsedTime } from 'app/components/ElapsedTime';
import { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import { Plate } from 'app/pages/Stream/Plate';
import { colors, fonts, overlayTextShadow } from 'app/theme/tokens';
import { refVh, refVw } from 'app/util/overlayScale';
import type { SpeedlineLaneState } from 'app/util/timerSnapshot';

// Race-state color for the hero numeral (DESIGN_SYSTEM §2 / "Hero timer
// numeral"): idle slate, running teal. A finished lane — a frozen time — is the
// payload moment of the stream overlay, so it reads plain white (+ the §7
// rules 4/6 protection halo below) to survive composited over dark/busy footage; the slate
// ink.hi was near-invisible there, and white is chroma-safe on the magenta
// projector ground too. Idle keeps its recessive slate+halo placeholder (accepted
// for the pre-race state, ADR 0041 §2).
// `onPlate` is the timertimer-style white-plate variant (size="plate"): the
// numeral sits on the solid white plate the component draws itself, so the
// finished white flips to dark slate ink. Running teal reads on white as-is.
const numeralColor = (isRunning: boolean, stopped: boolean, onPlate = false): string => {
  if (isRunning) return colors.race.running;
  if (stopped) return onPlate ? colors.ink.hi : 'common.white';
  return colors.ink.hi;
};

// Size variants of the hero block. `projector` fills a projector/broadcast
// screen via clamp/vw (DESIGN_SYSTEM §4) rather than a fixed MUI h3 — two lanes
// sit side by side, so the vw factor leaves room for both plus the centre signal.
// `control` is the contained variant for the operator's ControlPage, where the
// stopwatch lives in a lane column of the live deck flanking the start strip: a
// much smaller vw factor (capped well below the projector clamp) so a running
// lane's numeral cannot bleed sideways onto the centre controls.
const SIZES = {
  projector: {
    // Two-lane fit: unlike the single-lane Freestyle clock, two of these sit side
    // by side, each in a `minmax(0,1fr)` grid column. The vw factor is held well
    // under the per-lane track budget (laneTrack / 4.2 for a 7-glyph `M:SS.CC` in
    // JetBrains Mono ≈ 0.6em advance) so the numeral reads as a compact figure
    // biased to its lane's outer edge rather than filling the track — the lanes
    // sit toward the screen edges and open up the centre. Bump the vw term (and,
    // for very wide walls, the rem cap) to grow it back toward the track budget.
    numeral: 'clamp(2rem, 6vw, 12rem)',
    // UNOFFICIAL status tag (replaces the tiny "(Unofficial)" caption).
    marker: 'clamp(0.75rem, 1.6vw, 1.5rem)',
  },
  control: {
    // Sized to fit the operator column, not clip. The stopwatch sits in one of
    // the live deck's two lane tracks (`LIVE_DECK_SX`, ~5/13 of a ≤880px deck);
    // a 7-glyph `M:SS.CC` numeral in JetBrains Mono runs ~4.2em wide, so the vw factor and
    // cap are held so that width stays inside the column at every viewport
    // (else the widest glyphs crop against the column's overflow:hidden, which
    // itself is deliberate — it fences a running lane off the centre controls).
    numeral: 'clamp(1.5rem, 3.2vw, 2.75rem)',
    marker: 'clamp(0.625rem, 1vw, 0.875rem)',
  },
  // The timertimer-style white lower-third (SpeedlineTimerDisplay): a compact
  // scoreboard numeral on the 1080p broadcast baseline, stacked over the
  // AthleteNameStrip banner. This variant draws its OWN white plate around the
  // time (only the time — the UNOFFICIAL marker sits below it on the bare
  // ground), a scoreboard figure rather than a keyed-ground hero: the reference
  // draws the time at text-6xl (60px) on a 320px-wide plate — reference px on the
  // 1920×1080 capture frame (`refVh`/`refVw`), like every other metric in the
  // /stream/* set. The two variants above answer to a projector wall and an
  // operator column instead, so they keep their clamp/vw sizing.
  plate: {
    numeral: refVh(60),
    marker: refVh(14),
  },
} as const;

// The plate variant's white time plate, matched to the reference (`w-80 p-3`).
const PLATE_WIDTH = refVw(320);

interface Props {
  lastJsonMessage: StopwatchWSMessage | undefined;
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
   * Controlled lane state for the operator's ControlPage: the page owns timer
   * state outright and drives the display through this prop, so the component is
   * presentational there and does NOT depend on the relay echo. When set,
   * `lastJsonMessage` is ignored (the loopback is not a delivery channel for the
   * control's own clocks — ADR 0027); the preview leaves it unset and keeps
   * consuming relay messages.
   */
  laneState?: SpeedlineLaneState;
  /**
   * Render scale. `projector` (default) is the full-screen clamp/vw hero for the
   * preview/broadcast display; `control` is the contained variant for the
   * operator's ControlPage column, sized so it cannot overflow onto the centre
   * Start / False Start controls; `plate` is the compact timertimer-style
   * lower-third — it draws its own solid white plate around the time (dark
   * numeral hues, no halo on the plate) with the UNOFFICIAL marker below it on
   * the bare ground (white + the protection halo).
   */
  size?: 'projector' | 'control' | 'plate';
}

export const Stopwatch: React.FC<Props> = ({
  lastJsonMessage,
  isReady,
  timerId,
  recovery,
  laneState,
  size = 'projector',
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

  // Stop the live tick synchronously and drop its handle. Called the instant a
  // lane freezes (stop / reset / finished recovery) rather than deferring to the
  // [isRunning] effect one commit later: a 50ms tick queued before the freeze
  // must not fire afterwards and overwrite the authoritative stopTime−startTime
  // with Date.now()−startTime — that would defeat the skew-free-by-construction
  // guarantee a frozen lane has (ADR 0021). The null handle also gates the tick callback below,
  // so even a tick whose task already dequeued bails instead of writing.
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
    // Only a genuinely running lane can be stopped. The old `time === 0` guard
    // swallowed a sub-50ms stop (the tick interval has not run yet, so `time` is
    // still 0) — gate on the actual running state / known start instead.
    if (!isRunning || startTimeRef.current === null) return;
    clearTick();
    stopTimeRef.current = stopTime;
    setIsRunning(false);
    setTime(stopTime - startTimeRef.current);
    setShowTimerText(true);
  };

  // Undo of a withdrawn stop (`speedline-resume-stopped-lane`). The start epoch
  // is kept, so the clock picks up exactly where it would have been — no epoch
  // travels on the wire and none is re-derived here.
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

  // Reconstruct a normalized lane state directly (rather than replaying
  // start/stop messages) so a finished lane shows its frozen elapsed and a
  // running lane resumes ticking from its start. Shared by the one-shot
  // `recovery` (preview snapshot restore) and the continuous controlled
  // `laneState` (the control page's owned state).
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

  // Controlled mode (control page): the page owns lane state and drives the
  // display through `laneState`, so the relay echo never feeds these clocks.
  const controlled = laneState !== undefined;

  useEffect(() => {
    if (controlled || !lastJsonMessage) {
      return;
    }
    const { data, type } = lastJsonMessage;
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
  }, [lastJsonMessage]);

  // Snapshot recovery (preview): merge newer-wins per lane rather than blindly
  // replacing, because a snapshot can now arrive AFTER live messages (the
  // display forwards every snapshot since the HWC 2026 missed-stop incident).
  // All startTimes are control-minted epochs, so comparing them never crosses
  // machine clocks:
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

  // Controlled lane state (control page): apply on every change.
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
        // A tick that lands after a synchronous freeze (which nulls the handle)
        // must not overwrite the frozen time — bail if we are no longer the
        // active ticker.
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
        // Keep a (control-variant) lane numeral inside its column so a running
        // time cannot bleed sideways onto the centre Start / False Start controls.
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      {/* The plate variant draws the white plate around the TIME ONLY — the
          UNOFFICIAL marker below sits outside it on the bare (keyed/composited)
          ground, so the plate's height is constant by construction. */}
      {onPlate ? (
        <Plate
          bordered={false}
          fill={colors.overlay.plateFilled}
          data-testid="stopwatch-plate"
          sx={{ width: PLATE_WIDTH, px: '.25em', display: 'flex', justifyContent: 'right' }}
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
      {/* Kept mounted, toggled via visibility (the Countdown reserve-row
          pattern): the marker row always occupies its line, so the numeral —
          and the plate around it — never move when a lane freezes/resets. On
          the plate variant it reads white with the §7 protection halo (the
          slate outline — the opposite of the font color), since it paints on
          the bare ground below the plate. */}
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
