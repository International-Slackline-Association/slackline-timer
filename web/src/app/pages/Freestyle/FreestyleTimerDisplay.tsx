import { Box } from '@mui/system';
import { Typography } from '@mui/material';
import { AudioMutedBadge } from 'app/components/AudioMutedBadge';
import { ConnectingBadge } from 'app/components/ConnectingBadge';
import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { colors, fonts, overlayTextShadow } from 'app/theme/tokens';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import { useQueryParams } from 'app/hooks/useQueryParams';
import { CORNER_INSET_X, OVERLAY_LANE, TimerLaneBlock } from 'app/pages/Stream/TimerLaneBlock';
import { RankingsBody } from 'app/pages/Stream/RankingsOverlay';
import { isGender, isMatchRound } from 'app/types';
import { applyOverlayBodyStyle } from 'app/pages/Stream/overlayBg';
import { refVh } from 'app/util/overlayScale';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';
import { BEST_TRICK_TIMER_ID } from 'app/util/bestTrickSeries';
import { Countdown, COUNTDOWN_SIZES } from './Countdown';
import { WarmupBand } from './FreestyleHeroes';
import { useFreestyleTimerFeed } from './useFreestyleTimerFeed';

// The reserved height of the best-trick try-clock slot: the plate clock's own
// height (Countdown `COUNTDOWN_SIZES.plate` numeral, lineHeight 1). Both lanes
// reserve this in best trick — only the turn lane fills it — so the name strips
// keep their baseline and never jump when the turn switches.
const BEST_TRICK_CLOCK_SLOT = COUNTDOWN_SIZES.plate.numeral;

/** The BEST TRICK count above each lane banner, on the shared reference frame. */
const BEST_TRICK_LABEL_SIZE = refVh(24);

// Bottom-align with the Speedline timer's clock plate so the two overlays read
// as siblings. Speedline's lane block sits at the shared inset but always
// reserves a ~27px "UNOFFICIAL" marker row BELOW its plate, so its visible plate
// floats ~27 reference px above the inset line. This band has no such row, so it
// carries that allowance instead.
const MARKER_ROW_ALLOWANCE = 27;
const BAND_BOTTOM = refVh(OVERLAY_LANE.inset + MARKER_ROW_ALLOWANCE);

// The clamp/vw numeral (DESIGN_SYSTEM §4) sizes itself; the band only sets a floor.
const BAND_MIN_HEIGHT = refVh(120);

/**
 * Shared Freestyle timer display, mounted behind two thin route wrappers:
 *  - `projector` (/freestyle/preview): defaults to the chroma-key ground for
 *    projector/keyed screens.
 *  - `broadcast` (/stream/timer-freestyle): defaults to a transparent body so
 *    OBS/H2R composites the countdown over live video, matching every other
 *    /stream/* overlay.
 * Each variant only sets the DEFAULT background; `?bg=` overrides it per the
 * shared overlay convention (see doc/dev/broadcast-overlays.md). The chroma key is
 * magenta, so the green GO light / winner numerals survive it. All WS/read-token
 * wiring lives in the shared feed (`useFreestyleTimerFeed`) so both authenticate
 * correctly (Cognito on /freestyle/preview, read token on
 * /stream/timer-freestyle); the full-screen athlete display
 * (`FreestyleAthleteDisplay`) mounts the same feed under a different render.
 */
export const FreestyleTimerDisplay = ({ variant }: { variant: 'projector' | 'broadcast' }) => {
  const { bottomMargin, sideMargin } = useQueryParams();
  const location = useLocation();
  const {
    sessionId,
    readToken,
    readyState,
    isPreviewEnabled,
    warmupSurface,
    endWarmup,
    endTryWindow,
    laneAthleteIds,
    bestTrick,
    freestyleMode,
    recovery,
    countdownMessage,
    audioElement,
    playAudio,
    audioBlocked,
  } = useFreestyleTimerFeed();

  const link = useLinkPhase(readyState);

  // sessionId doubles as the compId; resolves the lane athletes for the
  // flag+name banner under both auth modes (Cognito on the projector, read
  // token on the broadcast overlay) — the SpeedlineTimerDisplay twin.
  const { byId: athleteById } = useAthleteLookup(sessionId, { readToken });

  // Standings parameters live in the URL, separate from the shared
  // useQueryParams hook (kept local so the panel never touches a hook used by
  // every page). The panel is only shown when both validate.
  const params = new URLSearchParams(location.search);
  const round = params.get('round');
  const gender = params.get('gender');
  // Standings query the freestyle Score plane (discipline="freestyle"), which
  // reuses MATCH_ROUNDS — so validate against match rounds, not time rounds
  // (`training` is a Time-plane-only round and has no Score-plane standings).
  const hasValidStandings = isMatchRound(round) && isGender(gender);

  // The same body-style dance StreamLayout does for /stream/*; the variant only
  // sets the DEFAULT ground and `?bg=` overrides it (see this file's JSDoc).
  useEffect(
    () =>
      applyOverlayBodyStyle(
        location.search,
        variant === 'projector' ? colors.chromaKey : 'transparent',
      ),
    [variant, location.search],
  );

  const isReadyToDisplay = readyState === ReadyState.OPEN && isPreviewEnabled;
  // On this scoreboard-band surface warm-up is NOT a full-screen takeover (that
  // stays the athlete display's `WarmupHero`): it rides the band as a left-corner
  // "athlete" slot — the `WarmupBand` label plate + plate clock in lane 1's
  // position. Best trick keeps the match band layout (side try clock under the
  // turn athlete's banner, centre tally on pause); a live best trick still
  // shadows a stale warm-up (the athlete-display precedence rule), so the
  // warm-up slot yields to it — and it is itself evidence of a live room, so it
  // reveals the band even while the clock channels are still unseeded.
  // `none` is the unseeded fail-safe (fsux-preview-warmup-seed): nothing has
  // arrived, so the band paints EMPTY rather than the defaults' dead
  // `WARM-UP 00:00` — on air a wrong number is worse than none, and the operator
  // reads the gap as "not seeded yet" while the reconnect fills it.
  const band: 'none' | 'warmup' | 'lanes' =
    bestTrick || warmupSurface === 'lanes'
      ? 'lanes'
      : warmupSurface === 'warmup'
        ? 'warmup'
        : 'none';
  const warmupInBand = band === 'warmup';

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        justifyContent: 'flex-end',
        flexDirection: 'column',
      }}
    >
      {audioElement}
      {/* The graded link, split across the corner pair: the in-progress cue inside
          the grace, the alarm past it — both invisible on chroma grounds (the
          projector default). */}
      <ConnectingBadge
        link={link}
        defaultBg={variant === 'projector' ? colors.chromaKey : 'transparent'}
      />
      <ConnectionLostBadge
        link={link}
        defaultBg={variant === 'projector' ? colors.chromaKey : 'transparent'}
      />
      {/* Projector-only: it paints on the chroma ground too (unlike the badges
          above), but the broadcast overlay composites over live video where a
          muted tab is irrelevant — suppress it there. See AudioMutedBadge. */}
      {variant === 'projector' && <AudioMutedBadge blocked={audioBlocked} />}
      {isPreviewEnabled && hasValidStandings && (
        <Box
          sx={{
            mx: sideMargin ? `${sideMargin}px` : CORNER_INSET_X,
            mb: 4,
            color: 'common.white',
          }}
        >
          <RankingsBody compId={sessionId} round={round} gender={gender} discipline="freestyle" />
        </Box>
      )}
      <Box
        sx={{
          // The `?bottomMargin`/`?sideMargin` producer knobs stay RAW px against
          // the capture (the Speedline twin's rule).
          mb: bottomMargin ? `${bottomMargin}px` : BAND_BOTTOM,
          mx: sideMargin ? `${sideMargin}px` : CORNER_INSET_X,
          position: 'relative',
          minHeight: BAND_MIN_HEIGHT,
          // Bottom-anchor the lane row within that floor: without a name strip the
          // block is shorter than minHeight, and a top-aligned row would float the
          // clock high, then drop it when the name strip is added and the block
          // outgrows the floor. Pinning to the bottom keeps the clock on the same
          // baseline whether or not a name is shown — the Speedline twin never
          // moves because its lanes are `position: absolute; bottom`. The
          // best-trick tally is position:absolute, so it is unaffected.
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        {/* Warm-up rides the band as a left-corner "athlete" slot (WarmupBand);
            otherwise the lane row. Quali (ADR 0036): one athlete at a time, so a
            single centred hero (lane 1). Battle / no mode on the wire: the
            two-lane row. Each lane stacks the flag+name banner (AthleteNameStrip,
            shown once the board assigns an athlete — the SpeedlineTimerDisplay
            twin) over its plate clock; the Countdown's own name row stays off (the
            banner owns the name). Best trick (rule F6) keeps this match layout:
            the lane run clocks yield to the shared try clock (timerId 3), which
            follows the turn athlete's side under a BEST TRICK label, and the tries
            tally paints the centre only between tries (the running window shows
            the side clock alone). */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: warmupInBand
              ? 'flex-start'
              : freestyleMode === 'quali'
                ? 'center'
                : 'space-between',
            alignItems: 'flex-end',
          }}
        >
          {band === 'none'
            ? null
            : warmupInBand
              ? isReadyToDisplay && (
                  <WarmupBand
                    isReady={isReadyToDisplay}
                    countdownMessage={countdownMessage}
                    recovery={recovery[0]}
                    onExpire={() => {
                      // Per-channel tone, the same one the control board plays
                      // (§4.2): the room hears which clock ended, not just that
                      // one did.
                      playAudio('alert');
                      endWarmup();
                    }}
                  />
                )
              : ([1, 2] as const).map((lane) => {
                  if (lane === 2 && freestyleMode === 'quali') return null;
                  const athleteId = laneAthleteIds[lane];
                  const athlete = athleteId ? athleteById(athleteId) : undefined;
                  const side = freestyleMode === 'quali' ? 'center' : lane === 1 ? 'left' : 'right';
                  const isTryLane = bestTrick !== null && bestTrick.turn === lane;
                  return (
                    <TimerLaneBlock
                      key={lane}
                      side={side}
                      athlete={athlete}
                      header={
                        // Best trick: BOTH lanes' banners carry the round count
                        // (each player's own tries so far / cap, e.g. "BEST TRICK
                        // 2/5") for the whole session — only the try clock below
                        // follows the turn. Moved here from the removed centre tally,
                        // which mostly repeated the names the strips already show.
                        bestTrick ? (
                          <Typography
                            component="div"
                            sx={{
                              fontFamily: fonts.display,
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                              fontSize: BEST_TRICK_LABEL_SIZE,
                              color: 'common.white',
                              textShadow: overlayTextShadow,
                            }}
                          >
                            {`Best Trick ${bestTrick.tries[lane]}/${bestTrick.cap}`}
                          </Typography>
                        ) : undefined
                      }
                    >
                      {/* Distinct keys: the try and lane clocks land on the same
                        child position, and without them React repurposes one
                        Countdown instance into the other across the phase change,
                        carrying its internal clock state over the timerId swap. */}
                      {bestTrick ? (
                        // Best trick: the single shared try clock rides the turn
                        // lane; BOTH lanes reserve an equal-height slot so the name
                        // strips stay on the same baseline and never jump when the
                        // turn switches (the non-turn lane's slot is simply empty).
                        <Box
                          sx={{
                            height: BEST_TRICK_CLOCK_SLOT,
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'center',
                          }}
                        >
                          {isTryLane && (
                            <Countdown
                              key="try-clock"
                              isReady={isReadyToDisplay}
                              timerId={BEST_TRICK_TIMER_ID}
                              mode="feed"
                              message={countdownMessage}
                              recovery={recovery[3]}
                              onExpire={() => {
                                playAudio('short');
                                endTryWindow();
                              }}
                              size="plate"
                            />
                          )}
                        </Box>
                      ) : (
                        <Countdown
                          key="lane-clock"
                          isReady={isReadyToDisplay}
                          timerId={lane}
                          mode="feed"
                          message={countdownMessage}
                          recovery={recovery[lane]}
                          onExpire={() => playAudio('long')}
                          onBreakExpire={() => playAudio('alert2')}
                          // Reserve the hidden break rows ONLY in quali, where a lane
                          // can go on break (advisory breaks, ADR 0036) and the layout
                          // must not jump. Battle has no breaks, so reserving there just
                          // injected dead space that pushed the clock ~32px below its
                          // name strip — off vs the Speedline twin's tight 16px gap.
                          // The band carries no expiry caption (the best-trick smoke
                          // pins that), so the caption row follows the break rows here.
                          reserveBreakRows={freestyleMode === 'quali'}
                          reserveCaptionRow={freestyleMode === 'quali'}
                          size="plate"
                        />
                      )}
                    </TimerLaneBlock>
                  );
                })}
        </Box>
      </Box>
    </Box>
  );
};
