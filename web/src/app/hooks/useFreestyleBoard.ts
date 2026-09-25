import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { useAthletes } from 'app/api/athletes';
import { useCompetitions } from 'app/api/competitions';
import { useAdvanceInput } from 'app/hooks/useAdvanceInput';
import { useControlSession } from 'app/hooks/useControlSession';
import { useDocumentTitle } from 'app/hooks/useDocumentTitle';
import { useEffectDrain } from 'app/hooks/useEffectDrain';
import { useLaneExpiry } from 'app/hooks/useLaneExpiry';
import { useScoreRecorder } from 'app/hooks/useScoreRecorder';
import { useSignalAudio } from 'app/hooks/useSignalAudio';
import { useTryExpiry } from 'app/hooks/useTryExpiry';
import { useWarmupChannel } from 'app/hooks/useWarmupChannel';
import { useWarmupExpiry } from 'app/hooks/useWarmupExpiry';
import type { CountdownWSMessage } from 'app/hooks/useWebSocket';
import {
  readStoredFreestyleMode,
  storeFreestyleMode,
  type FreestyleMode,
} from 'app/state/freestyleModeMemory';
import { readPanelSound, storePanelSound } from 'app/state/panelSoundMemory';
import { DEFAULT_FREESTYLE_BREAK_MS, FREESTYLE_FORMAT_PRESETS, isMatchRound } from 'app/types';
import {
  advanceRoute,
  battleAdvanceEvent,
  tryAdvanceEvent,
  type AdvanceNames,
} from 'app/util/advanceRoute';
import {
  advanceTarget,
  battleReducer,
  initialBattleStore,
  laneSnapshot,
  peerBattleEvent,
  runningLane,
  sameLaneAgain,
} from 'app/util/battleMachine';
import {
  BEST_TRICK_TIMER_ID,
  DEFAULT_CAP,
  FINAL_CAP,
  bestTrickWire,
  initialTrySeriesStore,
  peerTryAction,
  trySeriesReducer,
} from 'app/util/bestTrickSeries';
import {
  athleteHold,
  boardHold,
  boardHoldsState,
  boardLive,
  holdReason,
} from 'app/util/boardState';
import { MAX_BREAKS, type PlayerId } from 'app/util/breakState';
import { lockReason, type Lock } from 'app/util/lockReason';
import { laneNamesInput } from 'app/util/raceNames';
import type { RaceSound } from 'app/util/raceSound';
import { defaultRoundForMode, roundsForMode } from 'app/util/rounds';
import { buildCountdownSnapshot, isCountdownSnapshot } from 'app/util/timerSnapshot';

/**
 * The board's answer to a press that could do nothing (§3): a monotonic token
 * the plate flashes on, plus the words to flash. `reason: null` leaves the
 * plate its own — the route already prints why an ADVANCE was a no-op.
 */
export interface NoopPress {
  token: number;
  reason: string | null;
}

/**
 * Everything the Freestyle **control board** is and does, in one owner: the
 * three timer machines (battle lanes, best-trick series, warm-up channel), the
 * relay session that mirrors them to peers and previews, the effect drains and
 * expiry timeouts at the edge, the ADVANCE routing, and the format/mode input
 * they all read. `ControlPage` is then layout over this hook's return —
 * a change to the board's behaviour is a change here, a change to its shape is
 * a change there (FREESTYLE_BOARD_UX Round 2).
 *
 * The HSM discipline is unchanged (ADR 0032): the reducers stay the single
 * owners of truth, effects run at the edge *because* state changed, and nothing
 * below re-derives state a machine already holds. The hook mounts the score
 * recorder too — the board's mode picks its default recording round, so the
 * recorder cannot be mounted above it.
 */
export const useFreestyleBoard = (sessionId: string) => {
  // Name the tab: an operator runs this board beside a preview and the admin,
  // and `index.html`'s one static title makes all three look alike.
  useDocumentTitle('Freestyle Timer');

  // Quali vs battle is an EXPLICIT operator toggle (ADR 0036) — not inferred
  // from the athlete selection. Quali renders one athlete selection + one timer;
  // battle renders the two-lane board with the pause count-up.
  // The last-chosen mode is remembered per competition (localStorage, keyed off
  // sessionId = compId), so reopening the same comp's board restores it — and,
  // since format = mode, the initial budgets and recording round below follow it.
  const [mode, setMode] = useState<FreestyleMode>(
    () => readStoredFreestyleMode(sessionId) ?? 'quali',
  );

  // Score recording (additive over the live timer; sessionId === compId).
  const recorder = useScoreRecorder(sessionId, defaultRoundForMode(mode));
  const athletes = useAthletes(sessionId);
  const athleteList = useMemo(() => athletes.data ?? [], [athletes.data]);
  const competitions = useCompetitions();
  const selectedComp = competitions.data?.find((c) => c.compId === sessionId);
  // Quali break length is per-competition config (ADR 0019 §6), default 30 s.
  const breakMs = selectedComp?.config?.freestyle?.breakMs ?? DEFAULT_FREESTYLE_BREAK_MS;

  // The QUALI next-up athlete (`freestyle-quali-next-up`): quali runs one
  // athlete at a time, so — unlike battle's `nextUp`, which is a slot the
  // `advanceTarget` rule derives — nothing on the board knows who follows. The
  // operator names it, it rides `updateSelection` (so a peer panel mirrors it
  // and the audience surfaces render it), and nothing persists it: a reload
  // clears a hint the operator re-states each heat. Page state rather than
  // recorder state, like `mode` — it records nothing and cascades nothing.
  const [qualiNextUp, setQualiNextUpState] = useState<string | null>(null);
  const setQualiNextUp = useCallback((athleteId: string) => {
    setQualiNextUpState(athleteId || null);
  }, []);

  // The Run (s) field: a DRAFT budget (brief §4.5), applied to the lanes only by
  // `Set both lanes` / a mode switch. What a lane currently holds is its own
  // `armedMs`, so typing here re-arms nothing and locks nothing.
  const [runSeconds, setRunSeconds] = useState<number>(
    () => FREESTYLE_FORMAT_PRESETS[mode].runSeconds,
  );

  // The single owner of the two lanes' battle state (ADR 0032): a pure reducer
  // over the breakState.ts helpers. The buttons, the relay sends, and the
  // request_state snapshot all derive from here.
  const [store, dispatch] = useReducer(battleReducer, runSeconds * 1000, (budgetMs) =>
    initialBattleStore(budgetMs, MAX_BREAKS),
  );
  const { battle } = store;
  const runningId = runningLane(battle);
  // The changeover pause is battle information only (ADR 0036): the anchor is
  // mode-free in the reducer, but it is rendered — and holds the run "live" —
  // only on the battle board.
  const pauseStartedAt = mode === 'battle' ? battle.pauseStartedAt : null;
  // …and whether that gap is a handover at all: with the partner spent nobody
  // changes over, and the gutter has to say so in the plate's word.
  const goesAgain = mode === 'battle' && sameLaneAgain(battle);

  // Battle part 2 (rule F6) is a SECOND small reducer (two machines, two charts):
  // an additive best-trick-try series that owns its own `timerId 3` clock and is
  // `null` while disarmed. It never touches the battle machine above — during best
  // trick both lanes are already finished/idle. The default cap is round-driven
  // (5 in the final, else 3); the operator arms it explicitly.
  const [trySeriesStore, dispatchTry] = useReducer(trySeriesReducer, initialTrySeriesStore);
  const trySeries = trySeriesStore.series;
  const defaultCap = recorder.round === 'final' ? FINAL_CAP : DEFAULT_CAP;
  // Relayed on the selection: overlays render the BEST TRICK hero off it
  // (absent = no hero), and peer panels mirror the phase from it.
  const bestTrickSelection = bestTrickWire(trySeries);

  // The buzzer-blind hint (ADR 0037): whom the next battle ADVANCE press would
  // start — rendered beside the pause clock so the operator can trust the
  // buzzer without hunting lane buttons. Meaningful only while nothing runs
  // (a press on a live run stops it) and best trick is not armed (the press
  // routes to the try series then).
  const nextUp = runningId === null && trySeries === null ? advanceTarget(battle) : null;

  // breakMs is a page input that rides on the TAKE_BREAK event (and ADVANCE,
  // which can open the quali advisory break); mirror it into a ref so the
  // dispatcher callbacks stay identity-stable across config loads. Same reason
  // for the lanes: the Reset dispatcher reads the acting lane's `armedMs`.
  const breakMsRef = useRef(breakMs);
  breakMsRef.current = breakMs;
  const battleRef = useRef(battle);
  battleRef.current = battle;

  // Warm-up is a third, shared countdown channel (timerId 0) — independent of
  // the two performance lanes' mutual exclusion (ADR 0015 §1). Its state
  // lives in the pure `warmupChannel` machine behind this hook (the third
  // reducer beside the battle lanes and the try series); the strip renders
  // controlled off `warmup.display`, and the drain below performs its relay
  // sends/beeps.
  const warmup = useWarmupChannel(FREESTYLE_FORMAT_PRESETS[mode].warmupSeconds);

  // Audio plays on BOTH surfaces (ADR 0015 §3). Here on the control page:
  // short beep on break open, long beep on run/break expiry; the reducers emit
  // these as effects and the drains below play them. FreestyleTimerDisplay
  // mounts its own useSignalAudio for the preview.
  const { audioElement, playAudio, audioBlocked } = useSignalAudio();

  // Which panel carries the horn (see `panelSoundMemory`): a per-device switch
  // over this board's tones ONLY, so a silenced panel keeps every clock, every
  // relay send and every rendered answer it had — it just stops making noise.
  // Everything audible on this page goes through it, the press cue included: a
  // half-silent panel would be a worse thing to explain at a desk than a mute
  // one, and the plate answers every press in words regardless. The ref keeps
  // `playPanelAudio` identity-stable, so flipping it never re-runs a drain (and
  // so never replays a queued tone).
  const [soundOn, setSoundOn] = useState(readPanelSound);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const playPanelAudio = useCallback(
    (tone: RaceSound) => {
      if (soundOnRef.current) playAudio(tone);
    },
    [playAudio],
  );
  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      storePanelSound(!on);
      return !on;
    });
  }, []);

  // What the board is holding, asked once (brief §4.5). `boardLive` (a clock is
  // ticking) arms the leave guard and locks the two second DRAFTS; while
  // `boardHoldsState` (anything a re-arm would discard) locks the two format
  // controls, which say `blocker` instead of asking a question. One answer, so
  // the controls cannot disagree.
  const boardNow = { mode, battle, trySeries, warmupRunning: warmup.running };
  const hold = boardHold(boardNow);
  const live = boardLive(boardNow);
  const holdsState = boardHoldsState(boardNow);
  const blocker = hold === null ? null : holdReason(hold);
  // `boardLive ⇒ boardHoldsState` is strict, so the drafts take the reading
  // gated on the narrower predicate: a held lane locks the format controls but
  // leaves a draft editable, and an editable field must print no blocker.
  const liveBlocker = live ? blocker : null;
  // `Swap athletes` asks it of the athlete slots alone, so a warm-up — the window the
  // next pair is set up in — leaves the swap live (§4.5/§4.7).
  const swapHold = athleteHold(boardNow);
  const swapLock = swapHold === null ? null : holdReason(swapHold);

  const laneNames = useMemo(
    () => laneNamesInput(recorder.athletes, athleteList),
    [recorder.athletes, athleteList],
  );
  // The same two names keyed by SIDE — the shape every panel, the router and
  // the readout read them in. Derived once here rather than converted per
  // panel: four hand-written `{1: lane1, 2: lane2}` records is four places for
  // a side to be wired to the wrong athlete. `laneNames` stays the wire shape
  // the relay sends.
  const athleteNames: AdvanceNames = useMemo(
    () => ({ 1: laneNames.lane1, 2: laneNames.lane2 }),
    [laneNames],
  );

  // The format a mode carries (rules F4/F5): the board shape, the Run (s) draft
  // and the warm-up default. Shared by the local switch — which then re-arms the
  // lanes with SET_BUDGETS — and by the peer path, which must NOT dispatch: the
  // acting panel's own `reset_countdown`s arrive on the wire (S24 was this half
  // being missing, leaving a mirrored panel on the old format's budgets).
  // It deliberately touches no lane state, `armedMs` included: a re-arm is the
  // only thing that may, and it always reaches this panel as one — PEER_RESET on
  // a live flip, the snapshot's own `armedMs` on a join — so a mirrored panel
  // never keeps the old preset's armed budget and re-arms the room to it
  // (ADR 0046 §2).
  const applyFormat = (next: FreestyleMode) => {
    const format = FREESTYLE_FORMAT_PRESETS[next];
    setMode(next);
    storeFreestyleMode(sessionId, next);
    setRunSeconds(format.runSeconds);
    warmup.setDefaultSeconds(format.warmupSeconds);
  };

  const {
    sendWSMessage,
    peerMessage,
    link,
    enabledPreview,
    togglePreview,
    peerState,
    lastPeerEvent,
    selfRecovered,
  } = useControlSession<CountdownWSMessage>({
    sessionId,
    // A live countdown must not be torn down by an accidental tab close /
    // reload / nav-away — timer state is browser-local (see `useRunGuard`).
    // Everything that ticks counts, including the control-local ones a reload
    // cannot recover: a quali break, the battle changeover pause, an open try.
    runLive: live,
    laneNames,
    selection: {
      discipline: 'freestyle',
      round: recorder.round,
      gender: recorder.selectedGender,
      matchId: recorder.selectedMatchId || null,
      athlete1Id: recorder.athletes[1] || null,
      athlete2Id: recorder.athletes[2] || null,
      // Explicit board mode (ADR 0036): the preview collapses to a single
      // centred hero in quali. Rides the selection so late joiners recover it.
      freestyleMode: mode,
      bestTrick: bestTrickSelection,
      // Relay the battle next-up so the audience athlete display warns the next
      // rider. It IS the board's own "Next:" hint (`nextUp` above) —
      // battle-only, and null the moment a lane runs, so
      // the display never re-derives it from replayed timer messages.
      nextUp: mode === 'battle' ? nextUp : null,
      // …and its quali twin, the operator-named athlete. Mode-scoped the same
      // way, so a board that flipped to battle never leaves a stale quali name
      // on the wire.
      qualiNextUp: mode === 'quali' ? qualiNextUp : null,
    },
    // Session-scoped messages address the whole session, not a lane, so they
    // carry no timerId (ws-session-message-family) — a lane consumer filters
    // them out on the missing key just as it did the old timerId:-1 sentinel.
    buildPreview: (enabled) => ({ type: 'updatePreview', data: { enabled } }),
    buildLaneNames: (data) => ({
      type: 'updateLaneNames',
      data: { ...data, discipline: 'freestyle' },
    }),
    buildSelection: (data) => ({ type: 'updateSelection', data }),
    // The reducer state IS the snapshot source (ADR 0032), replacing laneStateRef.
    buildSnapshot: (isPreviewEnabled) => ({
      type: 'state_snapshot',
      data: buildCountdownSnapshot({
        isPreviewEnabled,
        now: Date.now(),
        timers: [
          warmup.snapshotRow,
          laneSnapshot(1, battle[1]),
          laneSnapshot(2, battle[2]),
          // The best-trick try clock (timerId 3) rides the snapshot too, so a
          // reconnecting preview recovers a running window. Absent while disarmed.
          ...(trySeries
            ? [
                {
                  timerId: BEST_TRICK_TIMER_ID,
                  lastRemainingMs: trySeries.clock.running
                    ? trySeries.clock.tryMs
                    : trySeries.tryMs,
                  isRunning: trySeries.clock.running,
                  startedAt: trySeries.clock.running ? trySeries.clock.startedAt : null,
                },
              ]
            : []),
        ],
      }),
    }),
    // Peer mirroring (ADR 0038): apply a peer panel's board selection,
    // write-free — the recorder mirrors athletes/round/gender/match (never a
    // Score POST / Match PUT), the page mirrors the explicit board mode, and
    // the best-trick tally mirrors into the series store. The peer's context
    // goes in FIRST (PEER_CONTEXT): a match/mode change drops the mirrored
    // series there and then — silently, so nothing is broadcast back — and the
    // `bestTrick` on the same frame re-arms it when the peer carried its phase
    // into the new context. Tying the drop to the context rather than to that
    // one field is what survives the frame order (ADR 0038, the 2026-09-25
    // addendum); the local CONTEXT observation below then reads as a no-op.
    applySelection: (sel) => {
      if (sel.discipline !== 'freestyle' || !isMatchRound(sel.round)) return;
      // Only a real flip applies the format: every selection push carries the
      // peer's mode, and re-applying it would overwrite an operator's manual
      // second-field edits on this panel.
      const flippedTo =
        sel.freestyleMode !== undefined && sel.freestyleMode !== mode ? sel.freestyleMode : null;
      dispatchTry({
        type: 'PEER_CONTEXT',
        context: { matchId: sel.matchId ?? '', mode: flippedTo ?? mode },
      });
      // The mirrored board flipped: take its format with it, and remember the
      // mode here too, so THIS panel reopens in the mode it last showed
      // (device-local memory, not a data-plane write — ADR 0038's
      // local-actions-only rule is untouched).
      if (flippedTo !== null) applyFormat(flippedTo);
      recorder.applySelection(sel);
      dispatchTry({ type: 'PEER_SELECTION', bestTrick: sel.bestTrick });
      // Alternation off the wire (brief §4.11): `lastRan` is control-local, so
      // a panel that joined mid-match has none — but the room's `nextUp` names
      // the lane that has NOT run, which is the same information inverted. The
      // reducer holds the three guards; this edge just forwards the hint.
      dispatch({ type: 'PEER_HINT', nextUp: sel.nextUp ?? null, mode: flippedTo ?? mode });
      // The quali hint has no rule to mirror through — it is the operator's
      // word — so the wire value simply IS this panel's value (ADR 0038: wire
      // values are the truth). After `applyFormat`, so a mirrored flip cannot
      // then clear what the same message just carried.
      setQualiNextUpState(sel.qualiNextUp ?? null);
    },
    // Peer mirroring catch-up (ADR 0038): hydrate every channel off a peer's
    // state_snapshot — the lanes into the battle reducer, the warm-up into its
    // page-local channel, a try clock into the series store. The Countdown
    // displays run controlled off those owners, so hydrating them IS the
    // display catch-up — there is no separate recovery side channel. A
    // foreign-mode snapshot (a Speedline control sharing the session) is dropped.
    applySnapshot: (snapshot) => {
      if (!isCountdownSnapshot(snapshot)) return false;
      const at = Date.now();
      warmup.hydrate(snapshot.timers, at);
      dispatch({ type: 'PEER_SNAPSHOT', at, timers: snapshot.timers });
      const tryClock = snapshot.timers.find((t) => t.timerId === BEST_TRICK_TIMER_ID);
      if (tryClock?.isRunning) {
        // A live try window: arm/anchor the mirrored clock to the snapshot's
        // shared epoch (receipt fallback); the tally/cap arrive via the peer's
        // updateSelection in the same answer batch.
        dispatchTry({
          type: 'PEER_TRY_START',
          at,
          startedAt: tryClock.startedAt ?? at,
          remainingMs: Math.max(0, tryClock.remainingMs),
        });
      } else if (tryClock) {
        // A resting try clock: adopt the peer's window when this store is
        // already armed (a reconnect mid-series); a disarmed store no-ops and
        // arms via the PEER_SELECTION riding the same answer batch.
        dispatchTry({ type: 'PEER_TRY_RESET', remainingMs: Math.max(0, tryClock.remainingMs) });
      }
      return true;
    },
  });

  // Which surface wears the newest peer-panel action (ADR 0038 / brief §4.10):
  // the lane a mirrored countdown message addressed, or the selection row.
  // `useControlSession` reports ONE event, so the routing is a single decision
  // and lives here — the page reads a token per surface and cannot invent a
  // second changed thing.
  const peerToken = useMemo(() => {
    const onLane = (lane: PlayerId) =>
      lastPeerEvent?.kind === 'timer' && lastPeerEvent.timerId === lane ? lastPeerEvent.seq : null;
    return {
      lanes: { 1: onLane(1), 2: onLane(2) } as Record<PlayerId, number | null>,
      selection: lastPeerEvent?.kind === 'selection' ? lastPeerEvent.seq : null,
    };
  }, [lastPeerEvent]);

  // Drain each reducer's effects at the edge (rule 4: effects run because state
  // changed) — relay sends (unchanged contract) + control-surface beeps. All
  // three deps are identity-stable, so an idle render re-runs none of them.
  useEffectDrain(store.effects, sendWSMessage, playPanelAudio, dispatch);
  useEffectDrain(trySeriesStore.effects, sendWSMessage, playPanelAudio, dispatchTry);
  useEffectDrain(warmup.effects, sendWSMessage, playPanelAudio, warmup.dispatch);

  // Schedule the run/break zero-crossing as a wall-clock timeout keyed on the
  // lane's phase + anchor, and the try and warm-up windows' the same way.
  useLaneExpiry(1, battle[1], dispatch);
  useLaneExpiry(2, battle[2], dispatch);
  useTryExpiry(trySeries, dispatchTry);
  useWarmupExpiry(warmup.display, warmup.dispatch);

  // Report the board context to the try-series machine after every change: the
  // machine holds the reset rule (a match or mode change disarms best trick —
  // ADR 0017 §3, ADR 0036), and a peer-driven change has already been recorded
  // by `applySelection` above, so this observation is a no-op for it.
  useEffect(() => {
    dispatchTry({ type: 'CONTEXT', context: { matchId: recorder.selectedMatchId, mode } });
  }, [recorder.selectedMatchId, mode]);

  // Apply a peer panel's countdown messages (ADR 0038 — the stream is peer-only;
  // the relay never echoes own sends): the lanes into the battle reducer, the try
  // clock into the series store, the warm-up into its machine — all via PEER_*
  // transitions that emit no `ws` effect, so the drains above can never
  // re-broadcast a mirrored event (the short start beep rides the drain: every
  // surface beeps, ADR 0015 §3). Write-free by construction: nothing here
  // touches the recorder's POST paths.
  useEffect(() => {
    if (!peerMessage || !('timerId' in peerMessage)) return;
    const at = Date.now();
    const battleEvent = peerBattleEvent(peerMessage, at);
    if (battleEvent) {
      dispatch(battleEvent);
      return;
    }
    const tryAction = peerTryAction(peerMessage, at);
    if (tryAction) {
      dispatchTry(tryAction);
      return;
    }
    warmup.applyPeerMessage(peerMessage, at);
  }, [peerMessage]);

  // ---- Lane action dispatchers (passed to the presentational controls) -------
  const laneActions = useMemo(
    () => ({
      start: (lane: PlayerId) => dispatch({ type: 'START', lane, at: Date.now() }),
      stop: (lane: PlayerId) => dispatch({ type: 'STOP', lane, at: Date.now() }),
      // A single-lane Reset re-arms that lane to what it was last armed to — never
      // to the Run (s) draft (brief §4.5): clearing one lane after a fall must not
      // silently re-format it behind the operator's back.
      reset: (lane: PlayerId) =>
        dispatch({ type: 'RESET', lane, budgetMs: battleRef.current[lane].armedMs }),
      // The rail-foot "next match" re-arm (§4.9) — the same per-lane RESET run
      // over both lanes, so each comes back to what IT was armed to.
      resetBoth: () =>
        ([1, 2] as const).forEach((lane) =>
          dispatch({ type: 'RESET', lane, budgetMs: battleRef.current[lane].armedMs }),
        ),
      takeBreak: (lane: PlayerId) =>
        dispatch({ type: 'TAKE_BREAK', lane, at: Date.now(), breakMs: breakMsRef.current }),
    }),
    [],
  );

  // ---- Best-trick action dispatchers (passed to the presentational panel) -----
  const tryActions = useMemo(
    () => ({
      arm: (cap: number) => dispatchTry({ type: 'ARM', cap }),
      disarm: () => dispatchTry({ type: 'DISARM' }),
      setCap: (cap: number) => dispatchTry({ type: 'SET_CAP', cap }),
      setTryMs: (tryMs: number) => dispatchTry({ type: 'SET_TRY_MS', tryMs }),
      startTry: (side: PlayerId) => dispatchTry({ type: 'START_TRY', side, at: Date.now() }),
      skipTry: (side: PlayerId) => dispatchTry({ type: 'SKIP_TRY', side }),
      endTry: () => dispatchTry({ type: 'END_TRY', at: Date.now() }),
      reset: () => dispatchTry({ type: 'RESET' }),
    }),
    [],
  );

  // Presses that had nothing to do, counted — the plate flashes its reason for
  // a second on each one (§3), so a dead end is seen as well as heard.
  const [noopPress, setNoopPress] = useState<NoopPress>({ token: 0, reason: null });

  // The one answer to a press that could do nothing, wherever the press came
  // from. A blocked lane/try key rides in with its own `reason`: the ADVANCE
  // route is live in those states, so the plate's own words would answer a
  // different press than the one the operator made.
  const answerNoop = useCallback(
    (reason: string | null) => {
      playPanelAudio('alert');
      setNoopPress((prev) => ({ token: prev.token + 1, reason }));
    },
    [playPanelAudio],
  );

  // A handset key the interlock table made inert (§4.7). The words are the
  // lock's own — the one map the buttons, tooltips and why-lines already read,
  // so a blocked press is answered in the sentence the screen is showing.
  const answerBlocked = useCallback((lock: Lock) => answerNoop(lockReason(lock)), [answerNoop]);

  // The one-button ADVANCE (ADR 0037): buzzer/Space/pad-10/the plate step the
  // whole sequence. `advanceRoute` (the pure router, FREESTYLE_BOARD_UX §4.1)
  // decides WHICH machine and which event — the two reducers stay independent
  // and the board renders its promise from the same route — and this edge only
  // stamps the wall clock and dispatches.
  const route = advanceRoute(mode, battle, trySeries);
  // Whose Start the next press would fire, or null when it does anything else
  // — the one lane Start that paints the contained `go` fill (§6). Taken off
  // the route rather than `nextUp` so the loud button and the plate's promise
  // are the same decision in every mode.
  const advanceStartLane =
    route.kind === 'battle' && route.event.type === 'START' ? route.event.lane : null;

  const advance = () => {
    // Cue AFTER the decision (§4.2): a press with nothing to advance answers
    // with the distinct `alert` tone instead of the `short` go-cue, so the
    // operator never hears a start that did not happen. Audio stays
    // control-local — never a `ws` effect, so it is not mirrored to the
    // preview/overlay (see useEffectDrain) — and through the panel switch, so
    // a silenced panel is silent for everything (the plate still answers the
    // press in words either way).
    if (route.kind === 'noop') {
      answerNoop(null);
      return;
    }
    playPanelAudio('short');
    const at = Date.now();
    if (route.kind === 'try') {
      dispatchTry(tryAdvanceEvent(route.event, at));
      return;
    }
    dispatch(battleAdvanceEvent(route.event, at, breakMsRef.current));
  };

  // The keyboard/pad triggers. The hook holds the closure in a ref, so it always
  // reads this render's fresh state, and hands back the guarded press the plate
  // (the third trigger) clicks — one seam, so none of the three can diverge.
  const advancePress = useAdvanceInput(advance);

  // Applying the Run (s) draft. SET_BUDGETS re-arms and re-broadcasts per lane
  // (pristine-only — see `battleMachine`), and `boardHoldsState` has already
  // taken the button off the board while anything would be discarded.
  const applyRunBudget = () => {
    if (holdsState) return;
    dispatch({ type: 'SET_BUDGETS', budgetMs: runSeconds * 1000 });
  };

  // The single Quali/Battle control (format = mode — the ADR 0036 respec):
  // picking a mode selects the board shape AND applies its championship timings
  // (rules F4/F5) — run + warm-up budgets, both lanes re-armed to the run budget
  // (the manual second-fields stay as the fine-tune escape hatch) — and
  // normalizes an out-of-mode recording round via requestRound, which rides the
  // existing ADR 0033 "Change the round?" confirm when a match is selected.
  // Nothing to confirm: the toggle is inert while the board holds anything, so
  // by the time it can be pressed the re-arm destroys nothing (brief §4.5).
  const applyMode = (next: FreestyleMode) => {
    if (holdsState || next === mode) {
      return;
    }
    applyFormat(next);
    dispatch({ type: 'SET_BUDGETS', budgetMs: FREESTYLE_FORMAT_PRESETS[next].runSeconds * 1000 });
    if (!roundsForMode(next).includes(recorder.round)) {
      recorder.requestRound(defaultRoundForMode(next));
    }
  };

  // Named slices, not a flat surface: the board's return IS the page's whole
  // API, so a round that adds a plate/chip/flag adds it INSIDE the slice that
  // owns it (the shape is pinned in `test/app/hooks/useFreestyleBoard.test.tsx`).
  return {
    // Session identity + health, and the audio element the page must mount.
    chrome: {
      // The board's one link reading, graded in the session (`useLinkPhase`):
      // the header chip and the plate's sub-line both speak from it, so the
      // loudest object here cannot claim a fault the slot above it does not.
      link,
      peerState,
      selfRecovered,
      enabledPreview,
      togglePreview,
      audioElement,
      audioBlocked,
      sound: { on: soundOn, onToggle: toggleSound },
    },
    // The selection/scoring owner, the athlete pool both panels read, and the
    // lane names resolved from the two.
    selection: {
      recorder,
      athletes: athleteList,
      athleteNames,
      peerToken: peerToken.selection,
      swapLock,
      qualiNextUp,
      setQualiNextUp,
    },
    // Format = mode (ADR 0036): the board shape and the setup strip's drafts.
    format: {
      mode,
      applyMode,
      runSeconds,
      setRunSeconds,
      applyRunBudget,
      holdsState,
      blocker,
      liveBlocker,
    },
    // Passed through as its machine hands it over: a third clock beside the
    // lanes (ADR 0015 §1), not part of the format it takes a default from.
    warmup,
    lanes: {
      battle,
      running: runningId,
      pauseStartedAt,
      goesAgain,
      nextUp,
      actions: laneActions,
      peerToken: peerToken.lanes,
    },
    // Its own slice because the route spans BOTH machines (ADR 0037) — filing it
    // under `lanes` would name the wrong owner. `press` is the screen twin of
    // the buzzer, guard included (a click behind a confirm answers it, never
    // advances).
    advance: {
      press: advancePress,
      startLane: advanceStartLane,
      noopPress,
      blocked: answerBlocked,
    },
    // Best trick (battle part 2).
    bestTrick: { series: trySeries, defaultCap, actions: tryActions },
  };
};

export type FreestyleBoard = ReturnType<typeof useFreestyleBoard>;
