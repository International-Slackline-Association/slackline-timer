import { Box } from '@mui/system';
import { AudioMutedBadge } from 'app/components/AudioMutedBadge';
import { ConnectingBadge } from 'app/components/ConnectingBadge';
import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { useQueryParams, useRelaySessionId } from 'app/hooks/useQueryParams';
import { useReadToken } from 'app/hooks/useReadToken';
import { StopwatchWSMessage, useWS } from 'app/hooks/useWebSocket';
import {
  isSpeedlineSnapshot,
  speedlineLaneState,
  type SpeedlineLaneState,
} from 'app/util/timerSnapshot';
import { colors, overlayTextShadow } from 'app/theme/tokens';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  type SelectionStamp,
} from 'app/util/selectionLww';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';
import { applyOverlayBodyStyle } from 'app/pages/Stream/overlayBg';
import { refVh } from 'app/util/overlayScale';
import { Stopwatch } from './Stopwatch';
import { Typography } from '@mui/material';
import { CORNER_INSET_X, CORNER_INSET_Y, TimerLaneBlock } from 'app/pages/Stream/TimerLaneBlock';
import { useAthleteLookup } from 'app/hooks/useAthleteLookup';
import RaceStartSignal from './StartSignal';
import { useSignalAudio } from '../../hooks/useSignalAudio';
import {
  beepIsLive,
  PRE_BEEP_PHASE,
  signalPhaseBeep,
  useStartSignalTimer,
} from '../../hooks/useStartSignalTimer';

/**
 * Shared Speedline timer display, mounted behind two thin route wrappers:
 *  - `projector` (/speedline/preview): defaults to the chroma-key ground for
 *    projector/keyed screens.
 *  - `broadcast` (/stream/timer): defaults to a transparent body so OBS/H2R
 *    composites the timer over live video, matching every other /stream/* overlay.
 * Each variant only sets the DEFAULT background; `?bg=` overrides it per the
 * shared overlay convention (see doc/dev/broadcast-overlays.md). The chroma key is
 * magenta, so the green GO light / winner numerals survive it. All
 * WS/sync/read-token wiring is identical so both authenticate correctly
 * (Cognito on /speedline/preview, read token on /stream/timer).
 */
/**
 * Lane-scoped false-start callout (rules S2–S4): flashes over the lane's column
 * when the operator has flagged that lane. "2ND FALSE START" at the second flag
 * (the attempt-failing / forfeiting one). Uses the race.stop error color + the
 * shared broadcast protection halo, matching the centre abort callout.
 */
const LaneFalseStartBadge = ({ count }: { count: number }) => {
  if (count < 1) return null;
  return (
    <Typography
      component="div"
      sx={(theme) => ({
        color: theme.palette.error.main,
        textAlign: 'center',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontSize: 'clamp(1rem, 3vw, 3rem)',
        lineHeight: 1.1,
        textShadow: overlayTextShadow,
        '@keyframes fsFlash': { '0%, 100%': { opacity: 0.45 }, '50%': { opacity: 1 } },
        animation: 'fsFlash 1s infinite',
      })}
    >
      {count >= 2 ? '2nd False Start' : 'False Start'}
    </Typography>
  );
};

/**
 * The start-light row's bottom baseline — the clock plates' own bottom edge (the
 * lane blocks' corner inset plus the UNOFFICIAL marker row they reserve BELOW
 * the plate), so the bulbs read on the timer row rather than under it. Measured
 * rather than derived: the marker row's height is the Typography's, not a token.
 */
const SIGNAL_BULB_BOTTOM = refVh(138);

export const SpeedlineTimerDisplay = ({ variant }: { variant: 'projector' | 'broadcast' }) => {
  const { bottomMargin, sideMargin } = useQueryParams();
  // Broadcast overlays are addressed by ?compId=, projectors by ?sessionId= — the
  // read-token WS $connect authorizer is scoped to compId, so resolve it here.
  const sessionId = useRelaySessionId();
  const { search } = useLocation();
  // When mounted as the /stream/timer overlay the URL carries a read token
  // instead of a Cognito session; on /speedline/preview it is undefined (no-op).
  const readToken = useReadToken();

  const [isPreviewEnabled, setIsPreviewEnabled] = useState<boolean>(true);
  // The start-light phase. The operator broadcasts only the SEED (armed +
  // anchor + lanes); the mirror below derives set1/set2/GO locally off the
  // anchor, and its GO edge IGNITES the seeded lanes' clocks at the scheduled
  // epoch — so the stopwatches leave zero with this display's own green light
  // instead of waiting out the relay latency on the authoritative `start`
  // (which still follows as an idempotent same-epoch confirmation). An abort
  // cancels the mirror, so the ignition dies with it — no retraction needed.
  // `signalPhase` holds the static states the sequence doesn't run — a peer's
  // abort/reset echo (-1/0) and a snapshot's recovered phase (no anchor to seed).
  const [signalPhase, setSignalPhase] = useState<number>(0);
  // Recovered lane states, applied through the Stopwatch's newer-wins merge.
  // Fed by two producers: a peer `state_snapshot` (reconnect recovery) and the
  // mirrored sequence's GO ignition below.
  const [recovery, setRecovery] = useState<{
    1?: SpeedlineLaneState;
    2?: SpeedlineLaneState;
  }>({});
  // The pending seed's ignition lanes; null = disarmed (after ignition, or on
  // abort/reset — nothing to ignite at the GO edge).
  const mirrorLanesRef = useRef<number[] | null>(null);
  const {
    currentSignalPhase: mirrorPhase,
    startSignal: seedSignal,
    resetSignal: cancelSignal,
  } = useStartSignalTimer({
    onSignalComplete: (goEpoch) => {
      const lanes = mirrorLanesRef.current;
      if (!lanes) return;
      mirrorLanesRef.current = null; // one ignition per seed
      setRecovery({
        1: lanes.includes(1) ? { kind: 'running', startTime: goEpoch } : { kind: 'idle' },
        2: lanes.includes(2) ? { kind: 'running', startTime: goEpoch } : { kind: 'idle' },
      });
    },
  });
  const mirrorAnchorRef = useRef<number>(0);
  // The mirrored sequence drives the light while running; otherwise `signalPhase`
  // holds the static states it doesn't run (abort/reset echo, snapshot recovery).
  const effectiveSignalPhase = mirrorPhase !== 0 ? mirrorPhase : signalPhase;
  const [textDisplay, setTextDisplay] = useState<string>('');
  // The lane athletes off the board's live selection (re-pushed on every socket
  // OPEN, so this recovers on reconnect), resolved to full athletes for the
  // flag+name banner (AthleteNameStrip). The board also relays `updateLaneNames`
  // (plain strings), but the banner needs the athlete record for the flag.
  const [laneAthleteIds, setLaneAthleteIds] = useState<{ 1: string | null; 2: string | null }>({
    1: null,
    2: null,
  });
  // Per-lane false-start counts (rules S2–S4), tracked off the board's live
  // selection (and recovered from a snapshot). The alert plays only when a count
  // *increases* — selection re-pushes on every socket OPEN, so playing per
  // message would false-alarm a reconnecting overlay.
  const [falseStarts, setFalseStarts] = useState<{ 1: number; 2: number }>({ 1: 0, 2: 0 });
  const prevFalseStartsRef = useRef<{ 1: number; 2: number }>({ 1: 0, 2: 0 });
  // LWW seq (ADR 0038 §4), one hop out from the panels: drop the losing
  // (stale-stamped) side of a crossed concurrent panel edit, whatever the
  // arrival order — exactly like the control panels do.
  const selectionStampRef = useRef<SelectionStamp>(INITIAL_SELECTION_STAMP);

  // A snapshot must never overwrite newer live truth: if any live timer message
  // arrived since the socket opened, ignore the (now stale) snapshot. Reset on
  // each (re)open so a reconnect can recover again.
  const liveSinceOpenRef = useRef<boolean>(false);

  const { playAudio, audioElement, audioBlocked } = useSignalAudio();

  const applyFalseStarts = (next: { 1: number; 2: number }, alertOnIncrease: boolean): void => {
    const prev = prevFalseStartsRef.current;
    if (alertOnIncrease && (next[1] > prev[1] || next[2] > prev[2])) playAudio('alert');
    prevFalseStartsRef.current = next;
    setFalseStarts(next);
  };

  const { lastJsonMessage, readyState, sendWSMessage, sendAck } = useWS<StopwatchWSMessage>({
    sessionId,
    readToken,
  });
  const link = useLinkPhase(readyState);

  // sessionId doubles as the compId; resolves the lane athletes for the banner.
  // Works under both auth modes (Cognito on the projector, read token on the
  // broadcast overlay), mirroring VsOverlay.
  const { byId: athleteById } = useAthleteLookup(sessionId, { readToken });

  // The same body-style dance StreamLayout does for /stream/*; the variant only
  // sets the DEFAULT ground and `?bg=` overrides it (see this file's JSDoc).
  useEffect(
    () => applyOverlayBodyStyle(search, variant === 'projector' ? colors.chromaKey : 'transparent'),
    [variant, search],
  );

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      liveSinceOpenRef.current = false;
      // Pull the operator's current timer state so a fresh / reconnected
      // preview is not blank until the next operator action.
      sendWSMessage({ type: 'request_state', data: {} });
    }
  }, [readyState]);

  useEffect(() => {
    if (!lastJsonMessage) {
      return;
    }
    const { data, type } = lastJsonMessage;
    // Any live timer message after open is newer truth than a pending snapshot.
    if (
      type === 'start' ||
      type === 'stop' ||
      type === 'resume' ||
      type === 'reset' ||
      type === 'updateText'
    ) {
      liveSinceOpenRef.current = true;
    }
    // Receipt ack (debug telemetry, HWC 2026 missed-stop incident): confirm the
    // timer-critical messages this display consumed, keyed by their own
    // control-minted epoch, so CloudWatch can name the consumers a relayed
    // message never reached. Logged + swallowed server-side — never fanned out.
    if (type === 'start' || type === 'stop' || type === 'reset') {
      sendAck({
        of: type,
        key: type === 'start' ? data.startTime : type === 'stop' ? data.stopTime : undefined,
        page: window.location.pathname,
      });
    }
    switch (type) {
      case 'reset':
        cancelSignal();
        mirrorLanesRef.current = null;
        setSignalPhase(0);
        setTextDisplay('');
        break;
      case 'updatePreview':
        setIsPreviewEnabled(data.enabled);
        break;
      case 'updateSignalPhase': {
        const { currentPhase, anchorEpoch } = data;
        // SEED (armed + anchor + lanes): run the sequence locally off the
        // operator's anchor (see the mirror hook above). A late seed
        // fast-forwards the light while muting passed beeps; a seed past GO
        // still ignites with the true past epoch, so even a laggy display
        // shows the correct running time.
        if (currentPhase === PRE_BEEP_PHASE && anchorEpoch != null) {
          mirrorAnchorRef.current = anchorEpoch;
          mirrorLanesRef.current = data.lanes ?? null;
          seedSignal(anchorEpoch);
          break;
        }
        // Abort (-1) / reset echo (0): cancel the local sequence, disarm the
        // pending clock ignition, and show the static phase.
        if (currentPhase <= 0) {
          cancelSignal(currentPhase === -1 ? -1 : undefined);
          mirrorLanesRef.current = null;
          setSignalPhase(currentPhase);
        }
        break;
      }
      case 'updateText':
        setTextDisplay(data.text);
        playAudio('alert');
        break;
      case 'state_snapshot':
        // Cross-mode crosstalk tolerance: a Freestyle control sharing this
        // session also answers request_state, with a CountdownSnapshot; drop it
        // rather than blank the start light off a foreign shape.
        if (!isSpeedlineSnapshot(data)) {
          break;
        }
        // Signal light / text / badges roll back easily, so a live message that
        // arrived since open outranks the snapshot for them. Lane TIMER state
        // always flows through (below): the stopwatches merge it newer-wins per
        // lane, so a snapshot generated AFTER a stop this display never received
        // (operator-side connectivity loss, HWC 2026 race 2) freezes the lane
        // instead of being discarded and leaving the timer running forever.
        if (!liveSinceOpenRef.current) {
          setIsPreviewEnabled(data.isPreviewEnabled);
          setSignalPhase(data.signalPhase);
          setTextDisplay(data.text);
          // Recover a flagged lane's badge without re-alerting (this is a re-sync).
          applyFalseStarts(data.falseStarts ?? { 1: 0, 2: 0 }, false);
        }
        // `data.at` rides along as the lane state's assertion time: it is what
        // lets the merge un-freeze a lane whose `resume` this display missed
        // without a stale snapshot doing the same (`Stopwatch.mergeRecovery`).
        setRecovery({
          1: speedlineLaneState(
            data.timers.find((t) => t.timerId === 1) ?? {
              timerId: 1,
              startTime: null,
              stopTime: null,
            },
            data.at,
          ),
          2: speedlineLaneState(
            data.timers.find((t) => t.timerId === 2) ?? {
              timerId: 2,
              startTime: null,
              stopTime: null,
            },
            data.at,
          ),
        });
        break;
      // The board re-pushes its selection on every change + socket OPEN; track
      // the per-lane false-start counts off it and alert on a fresh flag (S2–S4).
      case 'updateSelection': {
        // Both disciplines share one relay room (compId = sessionId); a Freestyle
        // board's selection must never drive the speed display. Drop it BEFORE the
        // LWW stamp so a foreign seq can't shadow a real speed push.
        if (data.discipline !== 'speed') break;
        const stamp = acceptSelectionStamp(selectionStampRef.current, lastJsonMessage);
        if (!stamp) break;
        selectionStampRef.current = stamp;
        applyFalseStarts(data.falseStarts ?? { 1: 0, 2: 0 }, true);
        setLaneAthleteIds({ 1: data.athlete1Id, 2: data.athlete2Id });
        break;
      }
    }
  }, [lastJsonMessage]);

  // Beeps for the mirrored sequence: each phase fires on its own local timer off
  // the operator's relayed anchor, so the beep is exact. Sound it only while it's
  // still live — a late seed's already-passed pre-beep stays silent (a beep in
  // the past is worse than none) — and never on the mount-time idle phase.
  const mirrorBeepInit = useRef(false);
  useEffect(() => {
    if (!mirrorBeepInit.current) {
      mirrorBeepInit.current = true;
      return;
    }
    const beep = signalPhaseBeep(mirrorPhase);
    if (beep && beepIsLive(mirrorAnchorRef.current, mirrorPhase, Date.now())) playAudio(beep);
  }, [mirrorPhase]);

  const isReadyToDisplay = readyState === ReadyState.OPEN && isPreviewEnabled;

  // One lane's timertimer-style lower-third: the flag+name banner
  // (AthleteNameStrip), the false-start badge and the white TIME plate (drawn by
  // the Stopwatch `plate` variant itself, around the time only) stacked,
  // anchored to a bottom corner (`bottom-28 left/right-28` in the reference).
  // Called as a function — NOT rendered as a component — so the two lanes keep
  // stable element identity and the Stopwatch never remounts (which would reset
  // its live tick). The banner shows only once an athlete is assigned to the lane.
  const renderLane = (lane: 1 | 2, side: 'left' | 'right') => {
    const athleteId = laneAthleteIds[lane];
    const athlete = athleteId ? athleteById(athleteId) : undefined;
    const secondLine =
      lane in falseStarts && falseStarts[lane] ? (
        <LaneFalseStartBadge count={falseStarts[lane]} />
      ) : (
        <Stopwatch
          isReady={isReadyToDisplay}
          timerId={lane}
          lastJsonMessage={lastJsonMessage}
          recovery={recovery[lane]}
          size="plate"
        />
      );

    return (
      <TimerLaneBlock
        side={side}
        athlete={athlete}
        testId={`timer-lane-${lane}`}
        sx={{
          position: 'absolute',
          // The `?bottomMargin`/`?sideMargin` producer knobs stay RAW px against
          // the capture — they exist to nudge the overlay clear of a rig's own
          // furniture, which is measured in output px, not in frame fractions.
          bottom: bottomMargin ? `${bottomMargin}px` : CORNER_INSET_Y,
          [side]: sideMargin ? `${sideMargin}px` : CORNER_INSET_X,
        }}
      >
        {secondLine}
      </TimerLaneBlock>
    );
  };

  return (
    <Box sx={{ height: '100vh', position: 'relative' }}>
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
      {/* Kept mounted regardless of ready state so the signal beeps always play. */}
      {audioElement}

      {/* Centre layer: the false-start abort callout, centred in the frame. The
          two lane lower-thirds sit at the bottom corners, so this never overlaps
          them. */}
      {isReadyToDisplay && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            pointerEvents: 'none',
          }}
        >
          <Typography
            component="div"
            sx={(theme) => ({
              // race.stop token — the false-start state in the color contract.
              color: theme.palette.error.main,
              textAlign: 'center',
              fontWeight: 'bold',
              // Viewport-relative so the false-start callout reads at distance.
              fontSize: 'clamp(2rem, 7vw, 7rem)',
              lineHeight: 1.1,
              // Shared broadcast protection halo — the false-start callout keys /
              // reads over chroma + busy footage (it sits on the ground, not a plate).
              textShadow: overlayTextShadow,
              '@keyframes flashAnimation': {
                '0%, 100%': { opacity: 0.5 },
                '50%': { opacity: 1 },
              },
              animation: 'flashAnimation 1.2s infinite',
            })}
          >
            {textDisplay}
          </Typography>
        </Box>
      )}

      {/* The start-signal light sequence, anchored to the same bottom height as
          the lane timer plates and centred between the two lower-thirds (which
          hug the bottom corners), so the lights read on the timer's row. */}
      {isReadyToDisplay && (
        <Box
          sx={{
            position: 'absolute',
            bottom: bottomMargin ? `${bottomMargin}px` : SIGNAL_BULB_BOTTOM,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <RaceStartSignal currentPhase={effectiveSignalPhase} />
        </Box>
      )}

      {/* The two lane lower-thirds at the bottom corners (blank until preview is
          enabled and the socket is open). */}
      {isReadyToDisplay && (
        <>
          {renderLane(1, 'left')}
          {renderLane(2, 'right')}
        </>
      )}
    </Box>
  );
};
