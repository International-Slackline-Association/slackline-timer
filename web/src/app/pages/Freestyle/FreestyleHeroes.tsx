import { Box } from '@mui/system';
import { Typography } from '@mui/material';

import { colors, fonts, overlayTextShadow } from 'app/theme/tokens';
import { CountdownWSMessage, type FreestyleSelection } from 'app/hooks/useWebSocket';
import { BEST_TRICK_TIMER_ID } from 'app/util/bestTrickSeries';
import { athleteLabel } from 'app/util/raceNames';
import { WARMUP_TIMER_ID } from 'app/util/warmupChannel';
import { Plate } from 'app/pages/Stream/Plate';
import { LANE_NAME_STRIP_HEIGHT, TimerLaneBlock } from 'app/pages/Stream/TimerLaneBlock';
import { Countdown } from './Countdown';
import { type RecoveredLane } from './useFreestyleTimerFeed';

/**
 * The full-screen hero phases of the audience-facing Freestyle surfaces,
 * rendered over the shared feed (`useFreestyleTimerFeed`). Both are centred
 * absolute overlays and the caller mounts at most one (best trick takes
 * precedence over a stale warm-up — see the mounting sites). The warm-up hero
 * serves both surfaces; the best-trick hero is athlete-display-only — the
 * broadcast band prints each lane's tries on its banner and rides the try clock
 * on the turn lane instead (`FreestyleTimerDisplay`).
 */

// Screen-filling scale (clamp/vw, design-system §4).
const TALLY_SIZES = {
  title: 'clamp(1.5rem, 5vw, 4rem)',
  row: 'clamp(2rem, 7vw, 6rem)',
  gap: 'clamp(1rem, 4vw, 3rem)',
} as const;

/** The BEST TRICK title + per-athlete tries tally (battle part 2, rule F6) of
 * the athlete display's full-screen hero. The tally row's teal highlight marks
 * whose turn it is. */
export const BestTrickTally = ({
  bestTrick,
  laneNames,
}: {
  bestTrick: NonNullable<FreestyleSelection['bestTrick']>;
  laneNames: { lane1: string; lane2: string };
}) => {
  // The on-dark tier: the hero's slate void ground washes the base teal to
  // ~3.8:1 (the two-tier race contract, tokens.ts).
  const turnHue = colors.race.runningBright;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      <Typography
        component="div"
        sx={{
          fontFamily: fonts.display,
          fontWeight: 'bold',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: TALLY_SIZES.title,
          color: 'common.white',
          textShadow: overlayTextShadow,
        }}
      >
        Best Trick
      </Typography>
      <Box
        sx={{
          display: 'flex',
          gap: TALLY_SIZES.gap,
          fontFamily: fonts.display,
          fontWeight: 'bold',
          fontSize: TALLY_SIZES.row,
        }}
      >
        <Box
          component="span"
          sx={{
            color: bestTrick.turn === 1 ? turnHue : 'common.white',
            textShadow: overlayTextShadow,
          }}
        >
          {athleteLabel(1, laneNames.lane1)} {bestTrick.tries[1]}/{bestTrick.cap}
        </Box>
        <Box
          component="span"
          sx={{
            color: bestTrick.turn === 2 ? turnHue : 'common.white',
            textShadow: overlayTextShadow,
          }}
        >
          {athleteLabel(2, laneNames.lane2)} {bestTrick.tries[2]}/{bestTrick.cap}
        </Box>
      </Box>
    </Box>
  );
};

/** BEST TRICK hero (battle part 2, rule F6): the tally + turn + try clock,
 * filling the screen. Present only while the board has best trick armed
 * (updateSelection.bestTrick). */
export const BestTrickHero = ({
  isReady,
  bestTrick,
  laneNames,
  countdownMessage,
  recovery,
  onExpire,
}: {
  isReady: boolean;
  bestTrick: NonNullable<FreestyleSelection['bestTrick']>;
  laneNames: { lane1: string; lane2: string };
  countdownMessage: CountdownWSMessage | undefined;
  recovery?: RecoveredLane;
  onExpire: () => void;
}) => (
  <Box
    sx={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}
  >
    <BestTrickTally bestTrick={bestTrick} laneNames={laneNames} />
    {/* Athlete-display-only hero, so the try clock always paints on the dark
        ground — on-dark hues at projector scale (Countdown onDark). */}
    <Countdown
      isReady={isReady}
      timerId={BEST_TRICK_TIMER_ID}
      mode="feed"
      message={countdownMessage}
      recovery={recovery}
      onExpire={onExpire}
      expiredLabel="OVER"
      size="heroSolo"
      onDark
    />
  </Box>
);

/** Warm-up hero (timerId 0): a single centered clock that fills the screen while
 * the warm-up is the session's current surface — pending (the default on a fresh
 * display) or running. The expiry beep fires via the shared Countdown onExpire
 * seam, which ALSO hands the surface off to the armed lanes — so the WARM-UP
 * OVER label never lingers here (it stays the operator board's affordance); the feed likewise drops it on an operator
 * stop or when a competition action takes over. Yields to the best-trick hero
 * when that phase is live. */
export const WarmupHero = ({
  isReady,
  countdownMessage,
  recovery,
  onExpire,
}: {
  isReady: boolean;
  countdownMessage: CountdownWSMessage | undefined;
  recovery?: RecoveredLane;
  onExpire: () => void;
}) => (
  <Box
    sx={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}
  >
    <Typography
      component="div"
      sx={{
        fontFamily: fonts.display,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: 'clamp(1.5rem, 5vw, 4rem)',
        color: 'common.white',
        textShadow: overlayTextShadow,
      }}
    >
      Warm-up
    </Typography>
    {/* `heroSolo`: one clock fills the athlete display's dark ground, far
        larger than the two-up `hero` scale (tuned to fill FHD). */}
    <Countdown
      isReady={isReady}
      timerId={WARMUP_TIMER_ID}
      mode="feed"
      message={countdownMessage}
      recovery={recovery}
      onExpire={onExpire}
      expiredLabel="WARM-UP OVER"
      size="heroSolo"
      onDark
    />
  </Box>
);

// The band warm-up label matches the lane banner (AthleteNameStrip) height, so
// warm-up reads as a lane's name slot — pinned to the shared token so the two
// can't drift. Cap-height and inset are the strip's own ratios (0.63 caps at the
// 0.72 display-face cap ratio; the ~18% inset), kept here so the two sit at the
// same size without importing the strip (which needs an Athlete + flag).
const WARMUP_LABEL_HEIGHT = LANE_NAME_STRIP_HEIGHT;

/** Warm-up as it appears IN the broadcast/projector scoreboard band
 * (`FreestyleTimerDisplay`) rather than as the full-screen `WarmupHero`: the
 * left-corner "athlete" slot — a name-strip-style label plate (the
 * AthleteNameStrip look minus the flag, since warm-up has no nationality) over
 * the same white `plate` Countdown the performance lanes draw, so warm-up
 * occupies a lane position instead of taking over the screen. */
export const WarmupBand = ({
  isReady,
  countdownMessage,
  recovery,
  onExpire,
}: {
  isReady: boolean;
  countdownMessage: CountdownWSMessage | undefined;
  recovery?: RecoveredLane;
  onExpire: () => void;
}) => (
  // The warm-up slot reuses the shared lane column (TimerLaneBlock): no athlete,
  // so its `header` carries the label plate in the name-strip's place, over the
  // same `plate` Countdown the performance lanes draw.
  <TimerLaneBlock
    side="left"
    header={
      // The name-strip plate with no flag block: filled white lower-third, dark
      // ink, at the band's banner height.
      <Plate
        bordered={false}
        fill={colors.overlay.plateFilled}
        sx={{
          height: WARMUP_LABEL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          px: `calc(${WARMUP_LABEL_HEIGHT} * 0.18)`,
        }}
      >
        <Typography
          component="div"
          sx={{
            fontFamily: fonts.display,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.01em',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            color: colors.overlay.nameInk,
            fontSize: `calc(${WARMUP_LABEL_HEIGHT} * ${0.63 / 0.72})`,
            // Dark ink on a white plate — cancel the footage drop-shadow (the
            // AthleteName plate rule), else it reads as a double-image.
            textShadow: 'none',
          }}
        >
          Warm-up
        </Typography>
      </Plate>
    }
  >
    <Countdown
      isReady={isReady}
      timerId={WARMUP_TIMER_ID}
      mode="feed"
      message={countdownMessage}
      recovery={recovery}
      onExpire={onExpire}
      expiredLabel="WARM-UP OVER"
      size="plate"
      plateAlign="left"
    />
  </TimerLaneBlock>
);
