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
import { overlayTextShadow } from 'app/theme/tokens';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  type SelectionStamp,
} from 'app/util/selectionLww';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ReadyState } from 'react-use-websocket';
import { applyOverlayBodyStyle, SURFACE_GROUND } from 'app/pages/Stream/overlayBg';
import { refVh } from 'app/util/overlayScale';
import { activeStartLanes } from 'app/util/raceTime';
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
 * Lane-scoped false-start callout (rules S2–S4), shown in place of the lane's
 * clock once flagged. "2ND FALSE START" at the second flag (the attempt-failing
 * / forfeiting one).
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
 * The start-light housing's foot — the clock plates' own bottom edge (the lane
 * blocks' corner inset plus the UNOFFICIAL marker row they reserve BELOW the
 * plate), so the light reads on the timer row rather than under it. Measured
 * rather than derived: the marker row's height is the Typography's, not a token.
 */
const SIGNAL_HOUSING_BOTTOM = refVh(139);

/**
 * Shared Speedline timer display, mounted behind two thin route wrappers:
 *  - `projector` (/speedline/preview): defaults to the chroma-key ground;
 *    Cognito auth.
 *  - `broadcast` (/stream/timer): defaults to a transparent body for OBS/H2R
 *    compositing, like every other /stream/* overlay; read-token auth.
 * The variant sets only the DEFAULT ground; `?bg=` overrides it
 * (doc/dev/broadcast-overlays.md). The chroma key is magenta, so the green GO
 * light survives it.
 */
export const SpeedlineTimerDisplay = ({ variant }: { variant: 'projector' | 'broadcast' }) => {
  const { bottomMargin, sideMargin } = useQueryParams();
  // Broadcast overlays are addressed by ?compId=, projectors by ?sessionId= — the
  // read-token WS $connect authorizer is scoped to compId, so resolve it here.
  const sessionId = useRelaySessionId();
  const { search } = useLocation();
  // Undefined on /speedline/preview (Cognito session).
  const readToken = useReadToken();

  const [isPreviewEnabled, setIsPreviewEnabled] = useState<boolean>(true);
  // The start-light phase. The operator broadcasts only the SEED (armed +
  // anchor + lanes); the mirror below derives set1/set2/GO locally off the
  // anchor, and its GO edge IGNITES the seeded lanes' clocks at the scheduled
  // epoch — so the stopwatches leave zero with this display's own green light
  // instead of waiting out the relay latency on the authoritative `start`
  // (which still follows as an idempotent same-epoch confirmation). An abort
  // cancels the mirror, so the ignition dies with it.
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
  // LWW seq (ADR 0038 §4), applied one hop out from the panels: drop the losing
  // side of a crossed concurrent panel edit, whatever the arrival order.
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

  // The last lane-scoped frame, handed to both Stopwatches. Set inside the
  // flushed delivery (ADR 0051), so each one commits — and runs the Stopwatch
  // effects — before the next frame is handled.
  const [laneFrame, setLaneFrame] = useState<StopwatchWSMessage | undefined>(undefined);

  const { readyState, sendWSMessage, sendAck } = useWS<StopwatchWSMessage>({
    sessionId,
    readToken,
    // Declared below, after the light/recovery plumbing it drives.
    onMessage: (message) => handleFrame(message),
  });
  const link = useLinkPhase(readyState);

  // sessionId doubles as the compId.
  const { byId: athleteById } = useAthleteLookup(sessionId, { readToken });

  // StreamLayout's body-style setup, for a page mounted outside it.
  useEffect(() => applyOverlayBodyStyle(search, SURFACE_GROUND[variant]), [variant, search]);

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      liveSinceOpenRef.current = false;
      // Pull the operator's current timer state so a fresh / reconnected
      // preview is not blank until the next operator action.
      sendWSMessage({ type: 'request_state', data: {} });
    }
  }, [readyState]);

  const handleFrame = (message: StopwatchWSMessage) => {
    const { data, type } = message;
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
    // Receipt ack, keyed by the message's control-minted epoch: logged +
    // swallowed server-side (doc/dev/architecture.md, the `ack` frame).
    if (type === 'start' || type === 'stop' || type === 'reset') {
      sendAck({
        of: type,
        key: type === 'start' ? data.startTime : type === 'stop' ? data.stopTime : undefined,
        page: window.location.pathname,
      });
    }
    if (type === 'start' || type === 'stop' || type === 'resume' || type === 'reset') {
      setLaneFrame(message);
    }
    switch (type) {
      case 'reset':
        cancelSignal();
        mirrorLanesRef.current = null;
        setSignalPhase(0);
        setTextDisplay('');
        // A Stopwatch that mounts later (a dormant lane re-assigned, a lane's
        // false-start badge cleared) replays `recovery` on mount; past a reset
        // the last ignition would restart it on the previous race's epoch.
        setRecovery({});
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
        // A Freestyle control sharing this session also answers request_state,
        // with a CountdownSnapshot.
        if (!isSpeedlineSnapshot(data)) {
          break;
        }
        // Signal light / text / badges roll back easily, so a live message that
        // arrived since open outranks the snapshot for them. Lane TIMER state
        // always flows through (below): the stopwatches merge it newer-wins per
        // lane, so a snapshot generated AFTER a stop this display never received
        // (operator-side connectivity loss) freezes the lane instead of leaving
        // it running forever.
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
        // Both disciplines share one relay room (compId = sessionId). Drop a
        // Freestyle push BEFORE the LWW stamp so its seq can't shadow a speed one.
        if (data.discipline !== 'speed') break;
        const stamp = acceptSelectionStamp(selectionStampRef.current, message);
        if (!stamp) break;
        selectionStampRef.current = stamp;
        applyFalseStarts(data.falseStarts ?? { 1: 0, 2: 0 }, true);
        setLaneAthleteIds({ 1: data.athlete1Id, 2: data.athlete2Id });
        break;
      }
    }
  };

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
  // A solo run (one lane assigned) drops the dormant lane's lower-third — the
  // lanes the start ignites are the lanes on air. Off the selection, not the
  // seed's `lanes`, so the layout holds before the lights run and on re-OPEN.
  const shownLanes = activeStartLanes({
    1: laneAthleteIds[1] ?? '',
    2: laneAthleteIds[2] ?? '',
  });

  // One lane's lower-third: the flag+name banner over the false-start badge or
  // the Stopwatch's own TIME plate, anchored to a bottom corner. Called as a
  // function, NOT rendered as a component, so the Stopwatch keeps stable
  // element identity and never remounts (which would reset its live tick).
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
          laneFrame={laneFrame}
          recovery={recovery[lane]}
          size="plate"
          plateAlign={side}
        />
      );

    return (
      <TimerLaneBlock
        side={side}
        athlete={athlete}
        testId={`timer-lane-${lane}`}
        sx={{
          position: 'absolute',
          // The `?bottomMargin`/`?sideMargin` producer knobs stay raw output px
          // (broadcast-overlays.md "Producer margin knobs").
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
      <ConnectingBadge link={link} defaultBg={SURFACE_GROUND[variant]} />
      <ConnectionLostBadge link={link} defaultBg={SURFACE_GROUND[variant]} />
      {/* Projector-only: it paints on the chroma ground too (unlike the badges
          above), but the broadcast overlay composites over live video where a
          muted tab is irrelevant — suppress it there. See AudioMutedBadge. */}
      {variant === 'projector' && <AudioMutedBadge blocked={audioBlocked} />}
      {/* Kept mounted regardless of ready state so the signal beeps always play. */}
      {audioElement}

      {/* Centre layer: the START ABORTED callout; clear of the corner
          lower-thirds. */}
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
              color: theme.palette.error.main,
              textAlign: 'center',
              fontWeight: 'bold',
              fontSize: 'clamp(2rem, 7vw, 7rem)',
              lineHeight: 1.1,
              // On the bare ground, not a plate.
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

      {/* Centred between the corner lower-thirds, on the timer row
          (`SIGNAL_HOUSING_BOTTOM`). */}
      {isReadyToDisplay && (
        <Box
          sx={{
            position: 'absolute',
            bottom: bottomMargin ? `${bottomMargin}px` : SIGNAL_HOUSING_BOTTOM,
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

      {/* A solo lane keeps its own corner. */}
      {isReadyToDisplay && (
        <>
          {shownLanes.includes(1) && renderLane(1, 'left')}
          {shownLanes.includes(2) && renderLane(2, 'right')}
        </>
      )}
    </Box>
  );
};
