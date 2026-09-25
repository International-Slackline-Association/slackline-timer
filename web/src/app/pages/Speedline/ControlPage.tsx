import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  useMediaQuery,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Stack } from '@mui/system';
import { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import { useControlSession, useSessionId } from 'app/hooks/useControlSession';
import {
  buildSpeedlineSnapshot,
  isSpeedlineSnapshot,
  speedlineLaneState,
} from 'app/util/timerSnapshot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGamepads } from 'app/hooks/useGamepads';
import {
  beepIsLive,
  PRE_BEEP_PHASE,
  signalPhaseBeep,
  useStartSignalTimer,
} from 'app/hooks/useStartSignalTimer';
import RaceStartSignal from './StartSignal';
import { useSignalAudio } from '../../hooks/useSignalAudio';
import { useAthletes } from 'app/api/athletes';
import { useRaceRecorder } from 'app/hooks/useRaceRecorder';
import { RaceLaneColumn } from './RaceLaneColumn';
import { RaceRecorderControls } from './RaceRecorderControls';
import { laneNamesInput } from 'app/util/raceNames';
import { activeStartLanes } from 'app/util/raceTime';
import { resetNeedsConfirm } from 'app/util/resetGuard';
import { resumeWindowDeadline, speedlineLocks } from 'app/util/speedlineLocks';
import { canStopLane } from 'app/util/stopGuard';
import { genderLabel } from 'app/util/gender';
import { handsetReadout } from 'app/util/handsetReadout';
import { roundLabel } from 'app/util/rounds';
import { SPEEDLINE_BUZZER_ROWS, speedlineHandsetOutcome } from 'app/util/speedlineHandset';
import { ControlStatusHeader } from 'app/components/ControlStatusHeader';
import { HandsetCard } from 'app/components/HandsetCard';
import { LockedControl } from 'app/components/LockedControl';
import { PreviewControls } from 'app/components/PreviewControls';
import { RaceButton } from 'app/components/RaceButton';
import { RecorderToast } from 'app/components/RecorderToast';
import { WhyLine } from 'app/components/WhyLine';
import { advanceOverlay, overlayOwnsBoard, useConfirmGuard } from 'app/hooks/useAdvanceInput';

/**
 * The desk (`speedline-desk-layout`, after FREESTYLE_BOARD_UX §2): setup chrome
 * left, the live path centre, the recording rail right, so a lane's athlete and
 * its Saved chip stand beside that lane's clock instead of in a panel below the
 * whole board.
 *
 * The gate is width only, unlike the Freestyle desk's width-AND-height one.
 * That desk is three stacked steps deep and genuinely does not fit 720 px; this
 * one is a start strip and two lane columns, and stacking it at 1280×720 is
 * what would put the transport under the fold — the exact failure the height
 * gate exists to prevent over there.
 */
const DESK_MEDIA = '(min-width:1280px)';

const DESK_SX = {
  width: '100%',
  display: 'grid',
  gap: 2,
  gridTemplateColumns: '1fr',
  alignItems: 'start',
  [`@media ${DESK_MEDIA}`]: {
    gridTemplateColumns: '248px minmax(0, 1fr) 360px',
  },
} as const;

/**
 * The live deck: the start strip between the two lane columns rather than above
 * them. Both lanes' clocks, pickers and Saved chips have to share one fold with
 * Start and Abort at 1280×720 (the item's acceptance), and stacked they do not
 * — the same reason the Freestyle run deck puts the changeover clock in a
 * middle column instead of a row of its own.
 *
 * The width ceiling is the Freestyle deck's rule (`RUN_MAX_WIDTH`) with a start
 * strip added: past it the two lanes stop reading as one board and become a
 * scan across the desk, which at 1920 put ~450 px of empty column between a
 * clock and the Start that fires it.
 */
const LIVE_DECK_SX = {
  width: '100%',
  maxWidth: 880,
  mx: 'auto',
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: '1fr',
  '@media (min-width:900px)': {
    gridTemplateColumns: 'minmax(0, 5fr) minmax(184px, 3fr) minmax(0, 5fr)',
    alignItems: 'start',
  },
} as const;

// The lane timers a start produces: the ignited lanes get the shared start
// epoch, the rest stay idle (a solo quali run's dormant lane — see
// activeStartLanes). Shared by the local start and the mirrored peer start.
const startLaneTimers = (startTime: number, lanes: number[]) => {
  const lane = (id: number) =>
    lanes.includes(id) ? { startTime, stopTime: null } : { startTime: null, stopTime: null };
  return { 1: lane(1), 2: lane(2) };
};

export const SpeedlineControlPage = () => {
  // The desk gate, asked once (`speedline-compact-setup-strip`). Below it the
  // three columns stack and the setup column goes FIRST — the order the manual
  // promises — so it has to cost a row, not a column: a ~220 px card there put
  // `False start` and `DNF` under a 768 px fold. One reading, not a CSS toggle:
  // the handset card owns a pad listener and a per-second ticker.
  const wideDesk = useMediaQuery(DESK_MEDIA);
  const sessionId = useSessionId();

  // Result recording (additive over the live timer; sessionId === compId).
  const recorder = useRaceRecorder(sessionId);
  const athletes = useAthletes(sessionId);

  const { currentSignalPhase, signalAnchor, signalAborted, startSignal, resetSignal } =
    useStartSignalTimer({
      onSignalComplete: (goEpoch) => start(goEpoch),
    });

  // A SECOND, mirroring sequence for a peer panel's lights (ADR 0038): the
  // driving panel broadcasts only the SEED (armed + anchor), so this panel
  // derives the peer's set1/set2/GO + beeps locally off that anchor — exact
  // under latency. It never owns the race start (the authoritative `start`
  // arrives as its own relayed message), hence the no-op completion.
  const {
    currentSignalPhase: mirrorPeerPhase,
    signalAborted: mirrorPeerAborted,
    startSignal: seedPeerSignal,
    resetSignal: cancelPeerSignal,
  } = useStartSignalTimer({ onSignalComplete: () => {} });
  const peerAnchorRef = useRef<number>(0);

  const { lastPressedGamepadButton } = useGamepads();

  const { playAudio, audioElement, audioBlocked } = useSignalAudio();

  const [resetConfirmOpen, setResetConfirmOpen] = useState<boolean>(false);

  // The control page owns lane timer state (ADR 0027, revised by 0038): per-lane
  // start/stop epochs + the displayed text are the single source of truth,
  // written by local operator actions AND by mirrored peer-panel messages. The
  // presentational Stopwatch columns render from this (no relay echo), the
  // gamepad/reset guards read the live value, and `request_state` answers
  // straight from it. `runningTimerCount` is derived, not tracked separately.
  const [laneTimers, setLaneTimers] = useState<{
    1: { startTime: number | null; stopTime: number | null };
    2: { startTime: number | null; stopTime: number | null };
  }>({ 1: { startTime: null, stopTime: null }, 2: { startTime: null, stopTime: null } });
  const [text, setText] = useState<string>('');
  // A peer panel's start-light phase (ADR 0038). The mirrored sequence above
  // drives it when running; `reactivePeerPhase` carries the static states the
  // sequence doesn't run — a peer's abort/reset echo (-1/0) and a snapshot's
  // recovered phase (no anchor to seed the scheduler). The board runs off the
  // EFFECTIVE phase: a locally-driven sequence wins (it owes the real `start`
  // on GO), otherwise the mirrored peer phase drives the lights + gating.
  const [reactivePeerPhase, setReactivePeerPhase] = useState<number>(0);
  // Whether the peer's -1 was an ABORT. A peer only ever sends -1 for an abort
  // (the seed protocol sends no terminal phase), so the echo says so outright;
  // a mirrored sequence reaching its own `cleared` says the opposite by not
  // latching. A snapshot's recovered -1 has neither — it reads as spent, the
  // commoner ending, and both wordings send the operator to the same Reset.
  const [reactivePeerAborted, setReactivePeerAborted] = useState<boolean>(false);
  const peerSignalPhase = mirrorPeerPhase !== 0 ? mirrorPeerPhase : reactivePeerPhase;
  const peerAborted = mirrorPeerPhase !== 0 ? mirrorPeerAborted : reactivePeerAborted;
  const effectiveSignalPhase = currentSignalPhase !== 0 ? currentSignalPhase : peerSignalPhase;
  const effectiveAborted = currentSignalPhase !== 0 ? signalAborted : peerAborted;

  const laneState = useMemo(
    () => ({
      1: speedlineLaneState({ timerId: 1, ...laneTimers[1] }),
      2: speedlineLaneState({ timerId: 2, ...laneTimers[2] }),
    }),
    [laneTimers],
  );
  const runningTimerCount =
    (laneState[1].kind === 'running' ? 1 : 0) + (laneState[2].kind === 'running' ? 1 : 0);

  // The gamepad handler + the snapshot builder + the peer-message handler run
  // from effects keyed on a narrow dep (last pressed button / peerMessage), so
  // their closures can hold stale timer state. Mirror the single source into one
  // ref they read. `signalPhase` is the effective phase (what the board shows /
  // answers request_state with); `localSignalPhase` is only the local sequence,
  // read by the peer-abort handler (a peer -1/0 must cancel a LOCAL run only).
  const stateRef = useRef({
    laneTimers,
    text,
    signalPhase: effectiveSignalPhase,
    localSignalPhase: currentSignalPhase,
    falseStarts: recorder.fsCounts,
    laneAthletes: recorder.laneAthletes,
  });
  stateRef.current = {
    laneTimers,
    text,
    signalPhase: effectiveSignalPhase,
    localSignalPhase: currentSignalPhase,
    falseStarts: recorder.fsCounts,
    laneAthletes: recorder.laneAthletes,
  };

  // A live run (start sequence running or a lane still timing) must not be
  // torn down by an accidental tab close / reload / nav-away, whichever panel
  // drives it. Reuse the reset-guard's "is this live?" decision so the two stay
  // in lockstep.
  const runLive = resetNeedsConfirm({ signalPhase: effectiveSignalPhase, runningTimerCount });

  const {
    sendWSMessage,
    peerMessage,
    link,
    peerState,
    selfRecovered,
    enabledPreview,
    togglePreview,
  } = useControlSession<StopwatchWSMessage>({
    sessionId,
    runLive,
    laneNames: laneNamesInput(recorder.laneAthletes, athletes.data ?? []),
    selection: {
      discipline: 'speed',
      round: recorder.round,
      gender: recorder.selectedGender,
      matchId: recorder.selectedMatchId || null,
      athlete1Id: recorder.laneAthletes[1] || null,
      athlete2Id: recorder.laneAthletes[2] || null,
      // Best-of-3 series tally (ADR 0017 §4) — drives the rounds-summary overlay.
      runWins: recorder.runWins,
      // Per-lane false-start counts — drives the preview's lane FALSE START badge.
      falseStarts: recorder.fsCounts,
    },
    buildPreview: (enabled) => ({ type: 'updatePreview', data: { enabled } }),
    buildLaneNames: (data) => ({
      type: 'updateLaneNames',
      data: { ...data, discipline: 'speed' },
    }),
    buildSelection: (data) => ({ type: 'updateSelection', data }),
    buildSnapshot: (isPreviewEnabled) => ({
      type: 'state_snapshot',
      data: buildSpeedlineSnapshot({
        isPreviewEnabled,
        now: Date.now(),
        signalPhase: stateRef.current.signalPhase,
        text: stateRef.current.text,
        timers: [
          { timerId: 1, ...stateRef.current.laneTimers[1] },
          { timerId: 2, ...stateRef.current.laneTimers[2] },
        ],
        falseStarts: stateRef.current.falseStarts,
      }),
    }),
    // Peer mirroring (ADR 0038): catch up to an already-running peer panel on
    // open. Write-free by construction — the snapshot only sets local state,
    // and arming the recorder start lets a LATER LOCAL stop record correctly
    // (the write then binds to this panel's operator action).
    applySnapshot: (snapshot) => {
      // Cross-mode crosstalk tolerance: a Freestyle control sharing this
      // session also answers request_state, with a CountdownSnapshot — drop it.
      if (!isSpeedlineSnapshot(snapshot)) return false;
      const lane = (id: number) => {
        const t = snapshot.timers.find((timer) => timer.timerId === id);
        return { startTime: t?.startTime ?? null, stopTime: t?.stopTime ?? null };
      };
      setLaneTimers({ 1: lane(1), 2: lane(2) });
      setText(snapshot.text);
      // Static light recovery (no anchor in a snapshot): show the phase, don't
      // run a sequence. Cancel any mirror so the reactive value takes over.
      cancelPeerSignal();
      setReactivePeerPhase(snapshot.signalPhase);
      // A snapshot carries no abort flag (see `reactivePeerAborted`): a
      // recovered -1 reads as a spent sequence, the commoner ending.
      setReactivePeerAborted(false);
      const running = snapshot.timers.find((t) => t.startTime !== null && t.stopTime === null);
      if (running?.startTime != null) recorder.onRaceStart(running.startTime);
      return true;
    },
    applySelection: recorder.applySelection,
  });

  // The console's interlock table (`app/util/speedlineLocks`): which controls
  // are inert and, in the operator's words, why — one map read by the buttons,
  // the why-lines under them, their accessible descriptions and the handset
  // guard, so a screen press and a buzzer press can never be live at different
  // instants. Derived off the EFFECTIVE phase (ADR 0038): a peer panel's light
  // sequence gates this panel exactly like a local one.
  // The clock the time-bounded half of the map is graded against (the resume
  // grace). It advances on ONE timer, fired at the window's close, rather than
  // a ticker: a live race board must not re-render every second to expire a
  // button. Starting at 0 keeps a just-opened window open; a board that mounts
  // with an already-stale stop closes it in the same effect.
  const [resumeClock, setResumeClock] = useState<number>(0);
  useEffect(() => {
    const deadline = resumeWindowDeadline(laneState);
    if (deadline === null) return;
    const closeWindow = () => setResumeClock((clock) => Math.max(clock, deadline));
    const delay = deadline - Date.now();
    if (delay <= 0) {
      closeWindow();
      return;
    }
    const timeoutId = window.setTimeout(closeWindow, delay);
    return () => window.clearTimeout(timeoutId);
  }, [laneState]);

  const locks = useMemo(
    () =>
      speedlineLocks({
        connected: link === 'open',
        signalPhase: effectiveSignalPhase,
        aborted: effectiveAborted,
        now: resumeClock,
        laneState,
      }),
    [link, effectiveSignalPhase, effectiveAborted, resumeClock, laneState],
  );
  // One reserved slot for the race pair and Reset: at most one of them carries
  // a reason at a time — Start's lock outranks Abort's, and Reset is locked
  // only by the board-wide holds that already word Start.
  const raceWhy = locks.start ?? locks.abort;

  // What a handset press just did, for the card's readout — off the same lock
  // map the buttons read, and off the overlay standing at the instant of the
  // press (which is why this is called from the press effect, not a render).
  const describePress = useCallback(
    (button: number) =>
      handsetReadout(button, speedlineHandsetOutcome(button, { locks, overlay: advanceOverlay() })),
    [locks],
  );

  const startWithSignal = () => {
    reset();
    setTimeout(startSignal, 300);
  };

  // Apply a peer panel's timer messages into local state (ADR 0038 — the stream
  // is peer-only; the relay never echoes own sends). Mirror only: a peer-applied event
  // NEVER writes to the data plane — `onRaceStart`/`notePeerFinish` are local
  // bookkeeping (they arm a later LOCAL stop / record the result for the tally
  // derivation), and the Time POST stays on the panel whose operator stopped.
  useEffect(() => {
    if (!peerMessage) return;
    switch (peerMessage.type) {
      case 'start': {
        const { startTime, lanes } = peerMessage.data;
        setLaneTimers(startLaneTimers(startTime, lanes));
        setText('');
        recorder.onRaceStart(startTime);
        break;
      }
      case 'stop': {
        const { timerId, stopTime } = peerMessage.data;
        if (timerId !== 1 && timerId !== 2) break;
        const { startTime } = stateRef.current.laneTimers[timerId];
        setLaneTimers((t) => ({ ...t, [timerId]: { ...t[timerId], stopTime } }));
        if (startTime !== null) recorder.notePeerFinish(timerId, stopTime - startTime);
        break;
      }
      // A peer withdrew a lane's stop: the lane's own start epoch is untouched,
      // so dropping the stop resumes the clock exactly where it would have been.
      case 'resume': {
        const { timerId } = peerMessage.data;
        if (timerId !== 1 && timerId !== 2) break;
        setLaneTimers((t) => ({ ...t, [timerId]: { ...t[timerId], stopTime: null } }));
        recorder.notePeerResume(timerId);
        break;
      }
      case 'reset':
        setLaneTimers({
          1: { startTime: null, stopTime: null },
          2: { startTime: null, stopTime: null },
        });
        setText('');
        resetSignal();
        cancelPeerSignal();
        setReactivePeerPhase(0);
        setReactivePeerAborted(false);
        recorder.onReset();
        break;
      case 'updateText':
        setText(peerMessage.data.text);
        // A peer's abort callout sounds here too (preview parity — the local
        // abort path plays the same alert).
        playAudio('alert');
        break;
      case 'updateSignalPhase': {
        const { currentPhase: phase, anchorEpoch } = peerMessage.data;
        // SEED (armed + anchor): run the peer's sequence locally off the anchor.
        // set1/set2/GO and their beeps then fire on this machine's own timers
        // (the mirror-beep effect below), exact under any relay latency.
        if (phase === PRE_BEEP_PHASE && anchorEpoch != null) {
          peerAnchorRef.current = anchorEpoch;
          seedPeerSignal(anchorEpoch);
          break;
        }
        // Abort (-1) / reset echo (0): cancel the mirror + any LOCAL run — the
        // latter otherwise still fires the real `start` on GO.
        if (phase <= 0) {
          cancelPeerSignal(phase === -1 ? -1 : undefined);
          setReactivePeerPhase(phase);
          setReactivePeerAborted(phase === -1);
          if (stateRef.current.localSignalPhase > 0) resetSignal(phase);
        }
        break;
      }
    }
  }, [peerMessage]);

  const start = (goEpoch?: number) => {
    // Anchor the race clock on the SCHEDULED GO epoch — the same schedule the
    // lights/beeps fire from — never Date.now() (a throttled tab fires this
    // callback late and would smear the start off the light schedule). The
    // relayed `start` stays the authoritative confirmation/recovery truth; a
    // receiver that already ignited from the seed applies it as a same-epoch
    // no-op. Recorded times are `stop − goEpoch`, exact vs the GO the
    // athletes saw.
    const startTime = goEpoch ?? Date.now();
    // A solo run (exactly one lane with an athlete — quali) ignites only that
    // lane; the other stays dormant. Read the live single source: this fires
    // from the signal timer's GO edge, whose closure can be stale.
    const lanes = activeStartLanes(stateRef.current.laneAthletes);
    setLaneTimers(startLaneTimers(startTime, lanes));
    setText('');
    sendWSMessage({
      type: 'start',
      data: { startTime, lanes },
    });
    recorder.onRaceStart(startTime);
  };

  const stop = useCallback(
    (timer: 1 | 2) => {
      // Per-lane stops are valid only mid-race. The UI button is disabled outside
      // that window, but the gamepad path (buttons 10/15) fires unconditionally —
      // see app/util/stopGuard. Reads the live single source (the effect closures
      // can be stale). A false start no longer stops the lanes (rule S4) — the
      // former all-lanes stop(-1) is gone; the run always runs to a finish.
      const { 1: lane1, 2: lane2 } = stateRef.current.laneTimers;
      const stopTimes = { 1: lane1.stopTime, 2: lane2.stopTime };
      if (
        !canStopLane({ startTime: stateRef.current.laneTimers[timer].startTime, stopTimes }, timer)
      )
        return;
      const stopTime = Date.now();
      setLaneTimers((t) => ({ ...t, [timer]: { ...t[timer], stopTime } }));
      // Record the finishing lane's time (no-op unless an athlete is assigned).
      recorder.recordFinish(timer, stopTime);
      sendWSMessage({
        type: 'stop',
        data: { timerId: timer, stopTime },
      });
    },
    [sendWSMessage, recorder],
  );

  /**
   * Mark a lane DNF (`speedline-dnf-corrects-and-freezes-the-lane`). A fall
   * ends that lane's race, so the press freezes its clock as well as recording
   * the result — one press for one event, whether or not the operator already
   * stopped the lane (rejected: a "stop the lane first" toast, i.e. two presses
   * for a fall on a live board).
   *
   * Order is load-bearing: `recordDnf` locks the lane's result first, so the
   * stop that follows records nothing over it (`recordFinish`'s hard lock) and
   * only freezes the numeral — here, on the peers, the preview and
   * `/stream/timer`. A lane that is not running has nothing to stop, which
   * `canStopLane` inside `stop` already says.
   */
  const dnfLane = useCallback(
    (lane: 1 | 2) => {
      recorder.recordDnf(lane);
      stop(lane);
    },
    [recorder, stop],
  );

  /**
   * Undo a mis-pressed Stop (`speedline-resume-stopped-lane`): the athlete is
   * still crossing, so the lane's stop is dropped and its clock continues off
   * the ORIGINAL start epoch — no re-`start`, which would re-ignite both lanes
   * and move the GO epoch the lights, beeps and every overlay anchor on. The
   * recorder deletes what the stop recorded; the peers and the preview un-freeze
   * on the relayed frame. Screen-only, deliberately: the board's interlock table
   * gates it, and no handset key reaches it (a buzzer must never un-stop a lane).
   */
  const resumeLane = useCallback(
    (lane: 1 | 2) => {
      if (locks.resume[lane] !== null) return;
      setLaneTimers((t) => ({ ...t, [lane]: { ...t[lane], stopTime: null } }));
      recorder.resumeLane(lane);
      sendWSMessage({ type: 'resume', data: { timerId: lane } });
    },
    [locks, recorder, sendWSMessage],
  );

  // Abort the start sequence (a jump during the lights). Pre-GO only — the UI
  // button is disabled outside that window and the gamepad path is guarded here.
  // Unlike the former false-start handler it NO LONGER stops the lanes: a false
  // start never halts a live run (rule S4) — the run finishes and video review
  // decides. Post-GO emergencies use Reset (confirm-guarded). The per-lane FALSE
  // START attribution is a separate action (see `flagFs`).
  const abortStart = useCallback(() => {
    if (locks.abort !== null) return;
    setText('START ABORTED');
    sendWSMessage({
      type: 'updateText',
      data: { text: 'START ABORTED' },
    });
    // Abort is event-driven, not schedule-derivable: without this explicit
    // cancel a receiver's seed-driven mirror would run on to GO.
    sendWSMessage({
      type: 'updateSignalPhase',
      data: { currentPhase: -1 },
    });
    resetSignal(-1);
    playAudio('alert');
  }, [locks, sendWSMessage, playAudio, resetSignal]);

  // Flag a false start against one lane (rules S2–S4). Always armed — a jump may
  // be reviewed on video after the run, so it is not phase-gated; a mis-tap
  // undoes via the console chip's clear. Records nothing itself; the recorder's
  // counters drive whether a Time is recorded and what consequence is advised.
  const flagFs = useCallback(
    (lane: 1 | 2) => {
      recorder.flagFs(lane);
      playAudio('alert');
    },
    [recorder, playAudio],
  );
  const reset = () => {
    setLaneTimers({
      1: { startTime: null, stopTime: null },
      2: { startTime: null, stopTime: null },
    });
    setText('');
    sendWSMessage({
      type: 'reset',
      data: {},
    });
    resetSignal();
    setReactivePeerAborted(false);
    // The board this clears includes what a PEER put on it (ADR 0038): a
    // cross-panel abort latches the mirrored -1, and `effectiveSignalPhase`
    // keeps Start dead while it stands — so without this the panel that did not
    // abort can only be re-armed from the other one. The peer `reset` branch
    // drops the same latch.
    cancelPeerSignal();
    setReactivePeerPhase(0);
    recorder.onReset();
  };

  // Reset is destructive and fires from both the button and gamepad button 1.
  // Guard a mid-race wipe behind a confirmation; clear instantly when idle.
  // Reads the live single source (stateRef) so the stale-closure gamepad effect
  // still sees the current lanes.
  const requestReset = useCallback(() => {
    const { laneTimers, signalPhase } = stateRef.current;
    const liveLanes =
      (speedlineLaneState({ timerId: 1, ...laneTimers[1] }).kind === 'running' ? 1 : 0) +
      (speedlineLaneState({ timerId: 2, ...laneTimers[2] }).kind === 'running' ? 1 : 0);
    if (resetNeedsConfirm({ signalPhase, runningTimerCount: liveLanes })) {
      setResetConfirmOpen(true);
      return;
    }
    reset();
  }, []);

  const confirmReset = () => {
    setResetConfirmOpen(false);
    reset();
  };

  // The safe answer, issued by the guard that registers it: a handset press
  // behind this question answers it and nothing else, and the marker it carries
  // is what tells a press in MUI's exit transition that the question is gone.
  const keepTiming = useConfirmGuard(resetConfirmOpen, () => setResetConfirmOpen(false), {
    dialog: 'Reset',
    safeAction: 'Keep timing',
  });

  useEffect(() => {
    // A question owns the board while it stands (FREESTYLE_BOARD_UX §4.8): the
    // on-screen twins already sit behind the modal backdrop, so the handset is
    // the one path that would still reach the transport — from a board the
    // operator cannot see. Read at press time, before the confirm this press
    // might be answering has been unmounted.
    if (overlayOwnsBoard()) return;
    switch (lastPressedGamepadButton?.button) {
      case 0:
        if (locks.start === null) startWithSignal();
        break;
      case 1:
        requestReset();
        break;
      case 5:
        abortStart();
        break;
      // Per-lane buzzers (one Buzz! handset per lane): red stops that lane,
      // yellow flags a false start on the SAME lane. H3 = lane 1 (stop 10 /
      // fs 11), H4 = lane 2 (stop 15 / fs 16) — see doc/dev/buzzer-hardware.md.
      // Resume is NOT here and must not be: un-stopping a lane is a judgement
      // the operator makes at the screen, never a key a gloved hand can hit.
      case 10:
        stop(1);
        break;
      case 11:
        flagFs(1);
        break;
      case 15:
        stop(2);
        break;
      case 16:
        flagFs(2);
        break;
      default:
        break;
    }
  }, [lastPressedGamepadButton]);

  // The LOCAL driving sequence broadcasts ONLY the SEED (armed + anchor + the
  // lanes GO will ignite); receivers derive set1/set2/GO and the race-clock
  // ignition locally off the anchor, exact under any relay latency. The lanes
  // are stable for the sequence's life (athlete swaps are locked during the
  // lights), so the seed's list equals what GO's authoritative `start` carries.
  // Abort/reset are event-driven — sent from `abortStart` / the `reset` message.
  useEffect(() => {
    if (currentSignalPhase === PRE_BEEP_PHASE) {
      sendWSMessage({
        type: 'updateSignalPhase',
        data: {
          currentPhase: PRE_BEEP_PHASE,
          anchorEpoch: signalAnchor,
          lanes: activeStartLanes(stateRef.current.laneAthletes),
        },
      });
    }
    // Local audio for every phase. A throttled/backgrounded tab can fire this
    // effect long after the phase's instant — suppress a stale beep there just
    // as receivers do (a beep in the past is worse than none).
    const beep = signalPhaseBeep(currentSignalPhase);
    if (beep && beepIsLive(signalAnchor, currentSignalPhase, Date.now())) playAudio(beep);
  }, [currentSignalPhase]);

  // Beeps for a MIRRORED peer sequence, each firing on its own local timer off
  // the relayed anchor. Gated to still-live beeps (a late seed's passed
  // pre-beep stays silent) and to no LOCAL sequence driving the audio (its own
  // phases beep above).
  const mirrorPeerBeepInit = useRef(false);
  useEffect(() => {
    if (!mirrorPeerBeepInit.current) {
      mirrorPeerBeepInit.current = true;
      return;
    }
    const beep = signalPhaseBeep(mirrorPeerPhase);
    if (
      beep &&
      stateRef.current.localSignalPhase === 0 &&
      beepIsLive(peerAnchorRef.current, mirrorPeerPhase, Date.now())
    ) {
      playAudio(beep);
    }
  }, [mirrorPeerPhase]);

  const laneColumn = (lane: 1 | 2) => (
    <RaceLaneColumn
      lane={lane}
      recorder={recorder}
      athletes={athletes.data ?? []}
      laneState={laneState[lane]}
      isReady={link === 'open'}
      onStop={() => stop(lane)}
      stopLock={locks.stop[lane]}
      onResume={() => resumeLane(lane)}
      resumeLock={locks.resume[lane]}
      onFlagFs={() => flagFs(lane)}
      onDnf={() => dnfLane(lane)}
    />
  );

  return (
    <Stack spacing={1.5} sx={{ width: '100%', padding: { xs: 1, sm: 2 } }}>
      <ControlStatusHeader
        context={{
          mode: 'Speedline',
          round: roundLabel(recorder.round),
          gender: genderLabel(recorder.selectedGender),
        }}
        health={{
          link,
          audioBlocked,
          peer: peerState,
          recovered: selfRecovered,
        }}
        recording={{
          // A lane records a Time only with an athlete assigned; no lane assigned
          // means a stop saves nothing — surface that instead of failing silently.
          active: Boolean(recorder.laneAthletes[1] || recorder.laneAthletes[2]),
          detail: 'no athletes selected',
        }}
      />
      <Box sx={DESK_SX}>
        <Stack
          spacing={1.5}
          data-testid="desk-left"
          direction={wideDesk ? 'column' : 'row'}
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: wideDesk ? 'stretch' : 'center' }}
        >
          <PreviewControls
            enabled={enabledPreview}
            onToggle={togglePreview}
            links={[{ href: `/speedline/preview?sessionId=${sessionId}`, label: 'Preview' }]}
          />
          <HandsetCard
            title="Speedline"
            rows={SPEEDLINE_BUZZER_ROWS}
            describe={describePress}
            variant={wideDesk ? 'card' : 'strip'}
          />
        </Stack>

        <Box sx={LIVE_DECK_SX} data-testid="desk-live">
          {laneColumn(1)}
          <Stack spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <RaceStartSignal currentPhase={effectiveSignalPhase} size="small" />

            {/* One control dialect across both boards (FREESTYLE_BOARD_UX §6):
                Start and Abort Start are the race pair — the two are never live
                at the same time, so exactly one loud press exists per state —
                and Reset is neutral behind a dashed divider rather than flush
                under Abort (finding S03: it is the one press with no undo).
                RaceButton also blurs after a mouse press, so a clicked control
                never swallows the next handset press. Each press carries its
                lock reason as its accessible description (§4.7), so the words
                the why-line prints reach a screen reader on the button itself. */}
            <LockedControl reason={locks.start}>
              <RaceButton
                tone="go"
                size="race"
                disabled={locks.start !== null}
                onClick={() => {
                  startWithSignal();
                }}
              >
                Start
              </RaceButton>
            </LockedControl>
            <LockedControl reason={locks.abort}>
              <RaceButton
                tone="stop"
                size="race"
                disabled={locks.abort !== null}
                onClick={() => {
                  abortStart();
                }}
              >
                Abort Start
              </RaceButton>
            </LockedControl>
            <WhyLine reason={raceWhy} />
            <Stack direction="row" spacing={1.5} sx={{ width: '100%', alignItems: 'center' }}>
              <Divider sx={{ flexGrow: 1, borderStyle: 'dashed' }} />
              <LockedControl reason={locks.reset}>
                <RaceButton
                  tone="neutral"
                  startIcon={<RestartAltIcon />}
                  disabled={locks.reset !== null}
                  onClick={() => {
                    requestReset();
                  }}
                >
                  Reset
                </RaceButton>
              </LockedControl>
            </Stack>
          </Stack>
          {laneColumn(2)}
        </Box>

        <Stack spacing={1.5} data-testid="desk-right">
          <RaceRecorderControls
            recorder={recorder}
            athletes={athletes.data ?? []}
            // Between runs the swap is safe — the tally is athlete-keyed (ADR 0044)
            // — and is exactly the side-switch moment; under a live run it is the
            // interlock table's call, like every other press on this board.
            swapLock={locks.swap}
          />
        </Stack>
      </Box>
      {audioElement}
      <RecorderToast
        open={recorder.toast !== null}
        message={recorder.toast?.text ?? ''}
        severity={recorder.toast?.severity ?? 'success'}
        onClose={recorder.clearToast}
      />
      <Dialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        aria-labelledby="reset-confirm-title"
      >
        <DialogTitle id="reset-confirm-title">Reset this run?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            A lane is still running or the start sequence is active. Resetting now wipes the run —
            this cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button {...keepTiming} />
          <RaceButton tone="stop" onClick={confirmReset}>
            Reset run
          </RaceButton>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
