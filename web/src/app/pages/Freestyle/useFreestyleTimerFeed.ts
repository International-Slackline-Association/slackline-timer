import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReadyState } from 'react-use-websocket';

import { useRelaySessionId } from 'app/hooks/useQueryParams';
import { useReadToken } from 'app/hooks/useReadToken';
import { useSignalAudio } from 'app/hooks/useSignalAudio';
import {
  CountdownWSMessage,
  DbUpdateWSMessage,
  useWS,
  type CountdownTimerRow,
  type FreestyleSelection,
} from 'app/hooks/useWebSocket';
import { BEST_TRICK_TIMER_ID } from 'app/util/bestTrickSeries';
import type { CountdownLaneMessage } from 'app/util/countdownClock';
import { WARMUP_TIMER_ID } from 'app/util/warmupChannel';
import { nextWarmupSurface, type WarmupSurface } from 'app/util/warmupSurface';
import { countdownLaneState, isCountdownSnapshot } from 'app/util/timerSnapshot';
import { dbUpdateQueryKeys } from 'app/pages/Stream/dbUpdateInvalidation';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  type SelectionStamp,
} from 'app/util/selectionLww';

/** A recovered countdown lane, applied once per snapshot (peer-to-peer
 * recovery). The canonical wire row minus `timerId` (the lane is the
 * `RecoveredLanes` key); mirrors countdownLaneState's output (break fields ride
 * through). See `CountdownTimerRow` for the per-field epoch/break notes. */
export type RecoveredLane = Omit<CountdownTimerRow, 'timerId'>;

export type RecoveredLanes = {
  0?: RecoveredLane;
  1?: RecoveredLane;
  2?: RecoveredLane;
  3?: RecoveredLane;
};

/** The four channels a display can hold a recovered row for — warm-up, the two
 * performance lanes, the best-trick try clock. A snapshot row on any other
 * timerId has no surface to seed, so it is ignored rather than stored. */
const isRecoveredChannel = (timerId: number): timerId is keyof RecoveredLanes =>
  timerId === WARMUP_TIMER_ID || timerId === 1 || timerId === 2 || timerId === BEST_TRICK_TIMER_ID;

/**
 * The competition channels — the two performance lanes and the best-trick try
 * clock — whose row is REFRESHED from every live message instead of dropped
 * (see `nextRecovery`). Warm-up is not one of them: its hero is only ever
 * mounted BY a warm-up message (`nextWarmupSurface` re-claims the surface on a
 * warm-up start alone), so it has nothing to replay on mount.
 */
const isRefreshedChannel = (timerId: number): timerId is 1 | 2 | typeof BEST_TRICK_TIMER_ID =>
  timerId === 1 || timerId === 2 || timerId === BEST_TRICK_TIMER_ID;

/**
 * Drop one lane's recovered row: a live lane message is newer truth than the
 * join-time snapshot, and the row must not outlive it. A reconnect clears the
 * spoken-channel set, so the next snapshot re-seeds every channel again.
 */
const dropRecoveredLane = (lanes: RecoveredLanes, timerId: number): RecoveredLanes => {
  const key = timerId as keyof RecoveredLanes;
  if (lanes[key] === undefined) return lanes;
  const next = { ...lanes };
  delete next[key];
  return next;
};

/**
 * One live message → that channel's recovery row. `at` is the receipt wall
 * clock, the anchor fallback for a pre-feature sender that omits the shared
 * wire epoch — the same fallback `clockFromMessage` applies, resolved HERE so
 * the row stays a self-contained face: a later remount re-anchoring to its own
 * mount time would replay the window from full.
 */
const rowFromMessage = (message: CountdownLaneMessage, at: number): RecoveredLane | null => {
  switch (message.type) {
    case 'start_countdown':
      return {
        remainingMs: message.data.remainingMs,
        isRunning: true,
        startedAt: message.data.startedAt ?? at,
      };
    case 'stop_countdown':
      return { remainingMs: message.data.remainingMs, isRunning: false };
    case 'reset_countdown':
      // A DISARM rides a reset-to-0 (bestTrickSeries): drop the row (null)
      // rather than hold a face for a clock that unmounts with the phase. A
      // real re-arm always carries the window (> 0).
      return message.data.remainingMs > 0
        ? { remainingMs: message.data.remainingMs, isRunning: false }
        : null;
    case 'start_break':
      return {
        remainingMs: message.data.runRemainingMs,
        isRunning: false,
        onBreak: true,
        breakRemainingMs: message.data.breakMs,
        breakStartedAt: message.data.startedAt ?? at,
        breaksLeft: message.data.breaksLeft,
      };
    case 'end_break':
      return { remainingMs: message.data.runRemainingMs, isRunning: false };
    default:
      return ((_exhaustive: never): RecoveredLane | null => null)(message);
  }
};

/**
 * Fold one live message into the recovery rows.
 *
 * A competition channel keeps its row REFRESHED from its own last message: its
 * clock can mount long after the message that revealed it (the lane clocks are
 * unmounted behind the warm-up hero and swapped out for the try clock in best
 * trick; the try clock remounts on the other side at every turn flip), and a
 * fresh mount can never replay what preceded it — the kept-current row is its
 * only seed, else it rests at the UNSEEDED 00:00
 * (fsux-preview-lane-remount-seed). Being message-derived, the row is
 * idempotent when re-applied over the very message it came from — a mount
 * applies both, live message first, recovery last — so it cannot freeze a live
 * start at the armed budget the way a STALE row would (the realtime-recovery
 * frozen-02:00 regression).
 *
 * Warm-up drops its row instead (see `isRefreshedChannel`), as does any channel
 * whose message carries no face to hold (a best-trick disarm).
 */
export const nextRecovery = (
  lanes: RecoveredLanes,
  message: CountdownLaneMessage,
  at: number,
): RecoveredLanes => {
  const timerId = message.timerId;
  if (isRefreshedChannel(timerId)) {
    const row = rowFromMessage(message, at);
    if (row) {
      return { ...lanes, [timerId]: row };
    }
  }
  return dropRecoveredLane(lanes, timerId);
};

/**
 * What a clock on this feed is allowed to see, as a pure `frame → frame | none`
 * (tested off the untestable hook, like `nextRecovery` above).
 *
 * `db_update` is consumed by the hook itself (cache invalidation) and is not a
 * countdown frame at all. A FOREIGN `state_snapshot` is dropped on the SAME
 * test the recovery path uses (`isCountdownSnapshot`): `compId` doubles as both
 * modes' relay session, so a Speedline control answering this display's
 * `request_state` puts a payload on the wire that is structurally none of the
 * declared `CountdownWSMessage` shapes. Keeping the discipline guard here means
 * it is stated once, for every surface behind the feed, instead of each clock
 * re-deriving whose mode a frame belongs to.
 */
export const clockFeedMessage = (
  message: CountdownWSMessage | DbUpdateWSMessage | null | undefined,
): CountdownWSMessage | undefined => {
  if (!message || message.type === 'db_update') {
    return undefined;
  }
  return message.type === 'state_snapshot' && !isCountdownSnapshot(message.data)
    ? undefined
    : message;
};

/**
 * The shared Freestyle receiver feed: one WS consumption (countdown + names +
 * selection + snapshot recovery + db_update invalidation + the PA-feed audio
 * rules) mounted behind every audience-facing Freestyle surface — the
 * bottom-anchored broadcast band (`FreestyleTimerDisplay`) and the full-screen
 * athlete display (`FreestyleAthleteDisplay`). Extracted as a hook so the render
 * trees can differ without forking the data surface (a copied feed is a drift
 * liability — the stream-best-trick-standalone-overlay precedent).
 *
 * The clocks behind it are wall-clock-anchored and never decremented: each tick
 * re-derives the numeral off the epoch the message carried (`countdownClock`),
 * so a late joiner and a projector that has been up all evening land on the same
 * second. No clock-skew correction anywhere (ADR 0021).
 */
export const useFreestyleTimerFeed = () => {
  // Broadcast overlays are addressed by ?compId=, projectors by ?sessionId= — the
  // read-token WS $connect authorizer is scoped to compId, so resolve it here.
  // sessionId doubles as the compId for the standings query / db_update keys.
  const sessionId = useRelaySessionId();
  const queryClient = useQueryClient();
  // When mounted as a /stream/* overlay the URL carries a read token instead of
  // a Cognito session; on the Cognito-gated routes it is undefined (no-op).
  const readToken = useReadToken();

  const [isPreviewEnabled, setIsPreviewEnabled] = useState<boolean>(true);
  // Which clock surface the session is showing. A display that has heard
  // nothing yet is `unseeded` and draws NO clock — the defaults would paint a
  // confident `WARM-UP 00:00` over the air. From the first message or snapshot
  // on, both the live stream and the late joiner's snapshot recovery apply the
  // ONE shared rule, `nextWarmupSurface` (util/warmupSurface — the
  // seed/hand-off/take-over semantics are documented there, once).
  const [warmupSurface, setWarmupSurface] = useState<WarmupSurface>('unseeded');
  const [laneNames, setLaneNames] = useState<{ lane1: string; lane2: string }>({
    lane1: '',
    lane2: '',
  });
  // The live best-trick tally (battle part 2, rule F6), tracked off updateSelection
  // — present only while that phase is armed. Drives the BEST TRICK surfaces (the
  // athlete display's hero, the broadcast band's in-band layout); absent clears it.
  const [bestTrick, setBestTrick] = useState<NonNullable<FreestyleSelection['bestTrick']> | null>(
    null,
  );
  // The board's explicit Quali/Battle mode (ADR 0036), also off updateSelection:
  // quali collapses to a single hero (lane 1). Absent (a pre-0036 control page /
  // speed board) renders the two-lane battle default.
  const [freestyleMode, setFreestyleMode] = useState<'quali' | 'battle' | null>(null);
  // The battle next-up player (ADR 0037 `advanceTarget`, relayed on the
  // selection). The display warns the next rider off it;
  // absent (a live run / quali / speed board) clears it. Recovered for late
  // joiners by the selection re-push on OPEN, like freestyleMode/bestTrick.
  const [nextUp, setNextUp] = useState<1 | 2 | null>(null);
  // The QUALI next-up athlete, by id (`freestyle-quali-next-up`): quali has one
  // clock, so the board names WHO comes after it rather than which slot. Same
  // channel and same recovery as `nextUp`; the surface resolves the id to a name
  // the way the board's own pickers do.
  const [qualiNextUp, setQualiNextUp] = useState<string | null>(null);
  // The lane athletes off the board's live selection (re-pushed on every socket
  // OPEN, so this recovers on reconnect), resolved to full athletes for the
  // flag+name banner (AthleteNameStrip) — the Speedline display twin. The board
  // also relays `updateLaneNames` (plain strings, kept above for the hero
  // tallies), but the banner needs the athlete record for the flag.
  const [laneAthleteIds, setLaneAthleteIds] = useState<{ 1: string | null; 2: string | null }>({
    1: null,
    2: null,
  });

  // Audio plays on BOTH surfaces (DECISIONS 0015 §3): short beep when a warm-up
  // start_countdown / lane break arrives, long beep on any local Countdown's
  // onExpire — the warm-up hero and both performance lanes at run-zero (rule F7),
  // plus onBreakExpire — so the venue PA feed sounds every period end.
  const { audioElement, playAudio, audioBlocked } = useSignalAudio();

  const [recovery, setRecovery] = useState<RecoveredLanes>({});
  // Snapshot-vs-live precedence, PER CHANNEL (ADR 0011 newer-wins, made
  // stricter): the channels that have spoken since this socket opened. A
  // board-wide flag let one lane's `reset_countdown` discard the whole
  // snapshot — including the warm-up row that was the only thing standing
  // between the projector and a fabricated hero (fsux-preview-warmup-seed).
  const liveChannelsRef = useRef<Set<number>>(new Set());
  // The SURFACE is seeded once per socket, by the first evidence to arrive, and
  // only live messages move it thereafter (fsux-preview-surface-peer-snapshot).
  // `request_state` is answered to the whole room, so most snapshots a long-lived
  // projector receives answer somebody ELSE's join — and between matches, with
  // the lanes pristine, re-deriving off one would resurrect the warm-up hero over
  // the lane clocks on every screen in the venue until the next message, which
  // can be minutes away. Invariant, per socket:
  // `surfaceSeededRef.current === (warmupSurface !== 'unseeded')` — except across
  // a reconnect, where the on-air surface deliberately stands (no mid-outage
  // blanking) while the flag resets, so exactly one fresh seed is taken per OPEN.
  const surfaceSeededRef = useRef(false);
  // LWW seq (ADR 0038 §4), one hop out from the panels: drop the losing
  // (stale-stamped) side of a crossed concurrent panel edit, whatever the
  // arrival order — exactly like the control panels do.
  const selectionStampRef = useRef<SelectionStamp>(INITIAL_SELECTION_STAMP);

  const { lastJsonMessage, readyState, sendWSMessage } = useWS<
    CountdownWSMessage | DbUpdateWSMessage
  >({
    sessionId,
    readToken,
  });

  useEffect(() => {
    if (readyState === ReadyState.OPEN) {
      liveChannelsRef.current = new Set();
      surfaceSeededRef.current = false;
      // Pull the operator's current countdown state so a fresh / reconnected
      // preview is not blank until the next operator action. `request_state` is
      // session-scoped (no timerId, ws-session-message-family).
      sendWSMessage({ type: 'request_state', data: {} });
    }
  }, [readyState]);

  useEffect(() => {
    if (!lastJsonMessage) {
      return;
    }
    const { data, type } = lastJsonMessage;
    if (
      type === 'start_countdown' ||
      type === 'stop_countdown' ||
      type === 'reset_countdown' ||
      type === 'start_break' ||
      type === 'end_break'
    ) {
      // The warm-up-surface rule, applied incrementally (the same predicate the
      // snapshot path below re-derives with — one home, util/warmupSurface).
      const timerId = lastJsonMessage.timerId;
      liveChannelsRef.current.add(timerId);
      // A live fold always returns a seeded surface, so this message IS the seed
      // when nothing preceded it.
      surfaceSeededRef.current = true;
      // This message supersedes the channel's recovered snapshot row — refresh
      // or drop it per `nextRecovery`.
      const at = Date.now();
      setRecovery((lanes) => nextRecovery(lanes, lastJsonMessage, at));
      setWarmupSurface((current) =>
        nextWarmupSurface({ kind: 'live', current, action: { type, timerId } }),
      );
      // The beeps are effects, not the surface rule: a warm-up start (timerId 0)
      // and a best-trick try start (timerId 3) beep short on the preview surface
      // too, as does a lane break opening (DECISIONS 0015 §3).
      if (
        type === 'start_break' ||
        (type === 'start_countdown' &&
          (timerId === WARMUP_TIMER_ID || timerId === BEST_TRICK_TIMER_ID))
      ) {
        playAudio('short');
      }
    }
    switch (type) {
      case 'updatePreview':
        setIsPreviewEnabled(lastJsonMessage.data.enabled);
        break;
      // The board's best-trick tally: reveal/clear the hero and update the turn.
      // The explicit mode rides the same message (ADR 0036).
      case 'updateSelection': {
        // Both disciplines share one relay room (compId = sessionId); a Speedline
        // board's selection must never drive the freestyle athlete display. Drop
        // it BEFORE the LWW stamp so a foreign seq can't shadow a real freestyle
        // push (this display's stamp ref then tracks only freestyle selections).
        if (lastJsonMessage.data.discipline !== 'freestyle') break;
        const stamp = acceptSelectionStamp(selectionStampRef.current, lastJsonMessage);
        if (!stamp) break;
        selectionStampRef.current = stamp;
        setBestTrick(lastJsonMessage.data.bestTrick ?? null);
        setFreestyleMode(lastJsonMessage.data.freestyleMode ?? null);
        setNextUp(lastJsonMessage.data.nextUp ?? null);
        setQualiNextUp(lastJsonMessage.data.qualiNextUp ?? null);
        setLaneAthleteIds({
          1: lastJsonMessage.data.athlete1Id,
          2: lastJsonMessage.data.athlete2Id,
        });
        break;
      }
      case 'db_update':
        // A competition write landed in this room — re-fetch just that entity's
        // branch (scores/times also feed rankings) rather than every active query.
        for (const queryKey of dbUpdateQueryKeys(sessionId, lastJsonMessage.data.entity)) {
          void queryClient.invalidateQueries({ queryKey });
        }
        break;
      // Names persist across runs of the same run (the recorder selection is not
      // cleared on reset), so they are intentionally NOT cleared on reset_countdown.
      case 'updateLaneNames':
        // Same discipline crosstalk guard as updateSelection: the speed board's
        // lane names have no legitimate consumer here (only the freestyle hero
        // band reads them). A pre-feature message omits `discipline` and applies
        // unconditionally (the field is additive — see useWebSocket.tsx).
        if (data.discipline && data.discipline !== 'freestyle') break;
        setLaneNames(data);
        break;
      case 'state_snapshot': {
        // Cross-mode crosstalk tolerance: a Speedline control sharing this
        // session also answers request_state, with a SpeedlineSnapshot (no
        // remainingMs); drop it rather than drive the countdown lanes to NaN.
        if (!isCountdownSnapshot(data)) {
          break;
        }
        // Ungated on purpose: a board-wide flag every panel converges on, not
        // folded state — whoever the snapshot answers, its value is current.
        setIsPreviewEnabled(data.isPreviewEnabled);
        // Re-derive the surface for a late joiner — the same one rule the live
        // path above applies incrementally (util/warmupSurface) — but only while
        // this socket is still unseeded: a snapshot answering a peer's join says
        // nothing this display does not already know better.
        if (!surfaceSeededRef.current) {
          surfaceSeededRef.current = true;
          setWarmupSurface(nextWarmupSurface({ kind: 'snapshot', timers: data.timers }));
        }
        // Seed only the channels that are still silent (see liveChannelsRef): a
        // live message is newer truth for ITS lane and nothing else. Rows the
        // snapshot omits are left unseeded rather than defaulted to a dead
        // 00:00 — an absent clock beats an invented one. Deliberately NOT joined
        // to the surface gate above: refreshing a still-silent channel's row off
        // a peer's snapshot is free, and now invisible too, since the surface no
        // longer moves under it.
        setRecovery((lanes) => {
          const next = { ...lanes };
          for (const row of data.timers) {
            if (!isRecoveredChannel(row.timerId) || liveChannelsRef.current.has(row.timerId)) {
              continue;
            }
            next[row.timerId] = countdownLaneState(row);
          }
          return next;
        });
        break;
      }
    }
  }, [lastJsonMessage, queryClient]);

  // The warm-up ran out on a display surface (its hero's Countdown crossed zero):
  // hand off to the armed lanes, exactly as an operator stop does
  // (post-warmup-handoff). Stable so the surfaces wire it straight into the
  // WarmupHero onExpire beside the long beep. It deliberately does NOT set
  // `surfaceSeededRef`: a locally-derived expiry is not evidence about the room,
  // so after a reconnect the room's snapshot must still win.
  const endWarmup = useCallback(() => setWarmupSurface('lanes'), []);

  // The try window crossed zero on THIS surface (no wire message rides a
  // TRY_TIMEOUT — bestTrickSeries): rest the try row at zero so a turn-flip
  // remount seeds the spent window instead of replaying the running anchor
  // (which would re-fire the long beep ~1s after the remount). A spent row
  // recovers as `expired` (clockFromRecovery), so the refresh landing on the
  // still-mounted clock keeps the TIME face rather than clobbering it.
  const endTryWindow = useCallback(
    () =>
      setRecovery((lanes) => ({
        ...lanes,
        [BEST_TRICK_TIMER_ID]: { remainingMs: 0, isRunning: false },
      })),
    [],
  );

  const countdownMessage = clockFeedMessage(lastJsonMessage);

  return {
    sessionId,
    readToken,
    readyState,
    isPreviewEnabled,
    warmupSurface,
    endWarmup,
    endTryWindow,
    laneNames,
    laneAthleteIds,
    bestTrick,
    freestyleMode,
    nextUp,
    qualiNextUp,
    recovery,
    countdownMessage,
    audioElement,
    playAudio,
    audioBlocked,
  };
};

export type FreestyleTimerFeed = ReturnType<typeof useFreestyleTimerFeed>;
