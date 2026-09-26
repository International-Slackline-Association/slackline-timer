import { useCallback, useEffect, useRef, useState } from 'react';
import { ReadyState } from 'react-use-websocket';

import { useLinkPhase } from 'app/hooks/useLinkPhase';
import { useQueryParams } from 'app/hooks/useQueryParams';
import { useRunGuard } from 'app/hooks/useRunGuard';
import {
  useWS,
  type CountdownSnapshot,
  type DistributiveOmit,
  type LiveSelection,
  type SpeedlineSnapshot,
  type WSMessage,
} from 'app/hooks/useWebSocket';
import { useSelectedCompetition } from 'app/state/selectedCompetition';
import {
  clearSelfSnapshot,
  readSelfSnapshot,
  storeSelfSnapshot,
} from 'app/state/selfSnapshotMemory';
import {
  INITIAL_SELECTION_STAMP,
  acceptSelectionStamp,
  selectionSignature,
  type SelectionStamp,
} from 'app/util/selectionLww';
import { snapshotHasRun } from 'app/util/timerSnapshot';

/**
 * Resolve the relay session id both control pages drive their timer on: an
 * explicit URL `sessionId` wins, else the selected competition's `compId`, else
 * `'default'`. Exposed on its own because the page needs the id up front (to key
 * its recorder/athlete queries) before it can hand the session hook the
 * recorder-derived lane names and selection.
 */
export const useSessionId = (): string => {
  const { sessionId: urlSessionId } = useQueryParams();
  const { compId } = useSelectedCompetition();
  return urlSessionId !== 'default' ? urlSessionId : (compId ?? 'default');
};

/**
 * The live timer truth-markers, shared with the preview's recovery rule: once
 * one of these has flowed (peer-received or locally sent) since the socket
 * (re)opened, any later `state_snapshot` is stale and must be dropped.
 * `updateSignalPhase` is deliberately absent (preview parity — phase changes
 * accompany these, and phase alone must not close the recovery window).
 */
const LIVE_TIMER_TYPES: ReadonlySet<WSMessage['type']> = new Set([
  'start',
  'stop',
  'resume',
  'reset',
  'updateText',
  'start_countdown',
  'stop_countdown',
  'reset_countdown',
  'start_break',
  'end_break',
]);

/**
 * What this panel knows about the OTHER control panels in the room (ADR 0038).
 * The relay carries no presence, so it is inferred from the answers to the
 * mirror-on-open `request_state`: `awaiting` until one arrives, `answered` once
 * a peer has spoken, `alone` when the grace passes in silence. The header
 * renders it because OPEN-with-no-peer and OPEN-with-a-mirrored-board are
 * different boards, and the operator cannot otherwise tell them apart
 * (FREESTYLE_BOARD_UX §3, rubric C09).
 */
export type PeerState = 'awaiting' | 'answered' | 'alone';

/** How long a joiner waits for a peer answer before calling itself alone. Long
 * enough for a relay round trip, short enough that a solo operator's board
 * stops hedging before the first press (brief §3 — nothing is disabled while
 * awaiting, so this bounds a caption, never a control). */
export const PEER_ANSWER_MS = 2_000;

/** How long the browser-local self-snapshot write is coalesced for (ADR 0047).
 * Trailing-edge only: the save reads the page's snapshot builder, and a save
 * fired inside the send that caused it would read the state of the render BEFORE
 * the operator's action. A crash inside the window falls back to the previous
 * save, which is the same run one action older. */
export const SELF_SAVE_DELAY_MS = 250;

/**
 * The last board change another panel made here — the token a surface flashes
 * its "by other panel" cue off (brief §3/§4.10). `seq` is monotonic so a repeat
 * of the same peer action re-fires a cue that an equal value would not;
 * `timerId` is the lane/channel a mirrored countdown message addressed, so a
 * lane card can claim only its own peer events.
 */
export interface PeerEvent {
  seq: number;
  kind: 'timer' | 'selection' | 'snapshot';
  timerId: number | null;
}

/** Which mirrored messages are a peer-visible board change; the rest (a
 * `request_state` ask, a preview toggle) move nothing the operator watches. */
const peerEventKind = (message: WSMessage): PeerEvent['kind'] | null => {
  if (LIVE_TIMER_TYPES.has(message.type)) return 'timer';
  if (message.type === 'updateSelection') return 'selection';
  if (message.type === 'state_snapshot') return 'snapshot';
  return null;
};

export interface UseControlSessionParams<T extends WSMessage> {
  /** The resolved relay session id (see `useSessionId`). */
  sessionId: string;
  /** Whether a live run (start sequence armed/running, or a lane still timing)
   * is in progress — drives the tab-close / nav-away guard. */
  runLive: boolean;
  /** The lane/player display names to re-push whenever they change or the socket
   * (re)opens, so a preview joining after a selection still gets them. */
  laneNames: { lane1: string; lane2: string };
  /** The board's live selection, re-pushed on the same cadence as the names. */
  selection: LiveSelection;
  /** Message factories that stamp the correct envelope onto each payload; the
   * page owns the union so both modes' sentinel differences stay put. */
  buildPreview: (enabled: boolean) => DistributiveOmit<T, 'sessionId'>;
  buildLaneNames: (data: { lane1: string; lane2: string }) => DistributiveOmit<T, 'sessionId'>;
  buildSelection: (data: LiveSelection) => DistributiveOmit<T, 'sessionId'>;
  /** Build the `state_snapshot` reply to a `request_state`. Called with the
   * mirrored preview-enabled flag; the page adds its own mode-specific timer
   * state. Refs mirror the live flag so the request_state effect isn't stale. */
  buildSnapshot: (isPreviewEnabled: boolean) => DistributiveOmit<T, 'sessionId'>;
  /** Peer mirroring (ADR 0038): apply a peer panel's `updateSelection` into the
   * board's own recorder, write-free. Application must be value-guarded — equal
   * values set nothing — which is what terminates the cross-panel echo. */
  applySelection?: (selection: LiveSelection) => void;
  /** Peer mirroring (ADR 0038): apply a peer's `state_snapshot` catch-up reply.
   * Must return whether the snapshot was this mode's (both modes share one relay
   * room, so a foreign-shape snapshot arrives too — guard with
   * `isSpeedlineSnapshot`/`isCountdownSnapshot` and return false to drop it);
   * only an applied snapshot mirrors its preview flag into the toggle. Never
   * called once a live timer message has been seen since (re)open
   * (live-beats-snapshot — the preview's proven recovery rule). */
  applySnapshot?: (snapshot: SpeedlineSnapshot | CountdownSnapshot) => boolean;
}

/**
 * The session chrome shared by the Speedline and Freestyle control pages: the
 * relay socket, the preview enable toggle, the run guard, the
 * lane-names + selection re-push-on-OPEN effects, and the peer-mirroring core
 * (ADR 0038) — control panels are mirroring peers, so this hook requests state
 * on open, answers every peer's `request_state` (converged panels agree), and
 * applies incoming snapshots/selections via the page-supplied callbacks — with
 * a browser-local copy of the panel's own state behind it (ADR 0047) for the
 * solo board that has no peer to ask. The pages keep only their mode-specific
 * timer orchestration; everything a realtime feature would otherwise have to
 * add twice lives here once.
 *
 * The two modes' protocol unions differ (`CountdownWSMessage` carries a `timerId`
 * on its lane variants, `StopwatchWSMessage` never does; the session variants are
 * timerId-less in both — ws-session-message-family), so the caller supplies
 * message *factories* that stamp the correct envelope onto each payload.
 */
export const useControlSession = <T extends WSMessage>(params: UseControlSessionParams<T>) => {
  const {
    sessionId,
    runLive,
    laneNames,
    selection,
    buildPreview,
    buildLaneNames,
    buildSelection,
    buildSnapshot,
    applySelection,
    applySnapshot,
  } = params;

  // One socket for both directions (ADR 0043): the relay excludes the sending
  // *connection* from its fan-out, so everything arriving here is peer traffic
  // by construction — no self-echo exists to discriminate. `senderId` stays on
  // the envelope as the selection LWW tiebreak (ADR 0038 §4).
  const {
    sendWSMessage: sendRaw,
    lastJsonMessage: peerMessage,
    readyState,
    senderId,
  } = useWS<T>({ sessionId });

  // The socket's owner grades its own link, once (ADR 0024 reconnects are
  // unbounded, so the link has five states, not two): every surface that
  // reports it reads this phase rather than re-grading `readyState` apart.
  const link = useLinkPhase(readyState);

  const [enabledPreview, setEnabledPreview] = useState<boolean>(true);
  const [peerState, setPeerState] = useState<PeerState>('awaiting');
  const [lastPeerEvent, setLastPeerEvent] = useState<PeerEvent | null>(null);
  const peerSeqRef = useRef<number>(0);
  // The peer-message handler runs in an effect keyed only on peerMessage, so
  // mirror the preview flag + the live selection into refs to avoid replying with
  // a stale snapshot / stale selection.
  const enabledPreviewRef = useRef<boolean>(true);
  const selectionRef = useRef<LiveSelection>(selection);
  selectionRef.current = selection;
  // The board's selection as a value (see `selectionSignature`): the re-push key
  // of the effect below, and the baseline the mirror forward's causality test
  // reads — both need the same digest, computed once per render.
  const signature = selectionSignature(selection);
  const signatureRef = useRef<string>(signature);
  signatureRef.current = signature;
  const laneNamesRef = useRef(laneNames);
  laneNamesRef.current = laneNames;

  // Live-beats-snapshot gate: true once any live timer message flowed (peer or
  // local) since the socket (re)opened; a snapshot arriving after that is stale.
  const liveSinceOpenRef = useRef<boolean>(false);

  // Browser-local self-snapshot (ADR 0047) — the solo panel's fallback for the
  // peer that isn't there. Everything the save needs is read through refs at
  // fire time, because it runs from a timeout a whole commit after the action
  // that queued it.
  const [selfRecovered, setSelfRecovered] = useState<boolean>(false);
  const buildSnapshotRef = useRef(buildSnapshot);
  buildSnapshotRef.current = buildSnapshot;
  const sessionIdRef = useRef<string>(sessionId);
  sessionIdRef.current = sessionId;
  const saveTimerRef = useRef<number | null>(null);
  // Whether a peer has spoken since this (re)open — the ref twin of `peerState`,
  // read from the grace timeout, which cannot see the state it just set.
  const peerAnsweredRef = useRef<boolean>(false);
  // The local copy is offered ONCE per mount: after a reconnect the panel already
  // holds its live state, and re-applying an older copy over it would be a
  // rollback, not a recovery.
  const selfRestoreDoneRef = useRef<boolean>(false);
  // The board as it stood the moment the socket opened (`boardFingerprint`). The
  // restore waits out the peer grace, and in those two seconds the operator can
  // already be setting the board up — picking athletes, re-arming a budget. Any
  // of that outranks a copy of an older run, and the live-frame gate does not
  // see it (setup moves no timer). So a board that moved at all since open is no
  // longer a candidate for recovery.
  const pristineRef = useRef<string | null>(null);

  // Last-writer-wins stamp for `updateSelection` (ADR 0038 §4). The value guard
  // alone does NOT bound concurrent edits: two selections crossing in flight
  // make each panel adopt (and re-push) the value it doesn't hold, every round
  // trip, forever — symmetric peers can't converge without a tiebreak. Every
  // outgoing selection carries a `seq` minted past everything seen (wall-clock
  // anchored, Lamport-bumped), and an incoming one at or below the last seen
  // stamp is dropped instead of applied (`acceptSelectionStamp`), so exactly
  // one side of a crossed pair yields and the survivor's value quiets the room
  // within two round trips (pinned by the concurrent-edit convergence test).
  const selectionStampRef = useRef<SelectionStamp>(INITIAL_SELECTION_STAMP);

  // Wall-clock anchoring gate for outgoing stamps (the joiner-defaults wipe,
  // caught by the peer-mirroring smoke): the one-shot mount-announce skip below
  // does not cover a push fired by a DERIVED dep flip during the join handshake
  // — e.g. a peer snapshot hydrating a running battle lane flips `nextUp`
  // 1→null before the peer's `updateSelection` answer is processed — and a
  // wall-clock stamp lets that default-selection push outstamp the live room's
  // answers (minted milliseconds earlier), converging every panel to the
  // joiner's defaults. Until this panel has SEEN the room's selection (accepted
  // an incoming stamp), its own selection is presumption, not information:
  // mints are Lamport-only (prev+1 from 0), which any live peer drops on sight
  // while a genuinely fresh room still converges on the seq+senderId tiebreak.
  // Now LOAD-BEARING for PEER_HINT (brief §4.11): the battle boards rebuild
  // `lastRan` from each other's relayed `nextUp`, so a joiner whose default
  // selection outstamped the room would not just show the wrong next lane — it
  // would teach the live panels the wrong alternation.
  const stampAnchoredRef = useRef<boolean>(false);

  // A mirrored re-push FORWARDS the stamp it adopted rather than minting a fresh
  // one (ADR 0038 §4): the value came from the acting panel, and a wall-clock
  // re-anchor here outstamps that panel's very NEXT edit — minted in the same
  // millisecond — so the whole room drops it. That is how a peer match change
  // left the mirror armed on the series it had just left: the retracting
  // `bestTrick: undefined` lost to the mirror's echo of the value before it.
  // A forward can only tie — and the frame says so on the wire (`echo`), so the
  // tie resolves against the re-statement instead of falling to whichever mount
  // UUID happens to sort higher.
  //
  // Every mirrored frame arms it, not only `updateSelection`: a board sends TWO
  // frames for one operator event — the selection and the drained countdown —
  // and a peer's countdown moves this panel's DERIVED selection too (a try clock
  // starting or resting flips `bestTrick.clockRunning`/`turn`). Minting fresh
  // authority for that reaction outstamped the acting panel's selection for the
  // SAME event, so the room dropped the real edit and a mid-try `Reset series`
  // left the mirror on the tally it had just cleared.
  //
  // `heldSignature` is what makes the forward CAUSAL rather than a commit
  // window. A peer frame reaches this panel's selection only through a state
  // write — `applySelection` here, the page's own peer-countdown dispatch one
  // hook down — so the adoption it causes can land no earlier than the NEXT
  // commit. A selection that had already moved when the frame arrived is
  // therefore the operator's, not the room's, and lending it the forward sent a
  // local edit out as a re-statement, which every peer then drops by design
  // (`fs best-trick: B's tally consumes the try`). The push compares the value
  // it is about to send against this baseline and mints its own authority when
  // they match.
  const mirroredStampRef = useRef<{ stamp: SelectionStamp; heldSignature: string } | null>(null);

  // Mount-time announce skip (ADR 0038, the phase-0 announce precedent): a
  // panel opening into a live session must not blast its DEFAULT names and
  // selection over the peers' converged board — the blast races the
  // request_state answers, and since a value-CHANGING peer application re-pushes
  // (the overlay-follow contract), the room can oscillate and converge to the
  // joiner's defaults, wiping the live selection. Mount state is always default
  // (nothing is persisted), so the first socket-OPEN fire of each push effect
  // carries no information and is consumed silently; every later change and
  // every re-open (reconnect) pushes as before.
  const namesAnnouncedRef = useRef<boolean>(false);
  const selectionAnnouncedRef = useRef<boolean>(false);

  // Arms the browser's native "leave site?" prompt while a run is live — the
  // only exit left, now that the control boards have no in-app back button.
  useRunGuard(runLive);

  /**
   * Write this panel's current state to the device. The snapshot is built the
   * same way a `request_state` answer is, so there is exactly one definition of
   * "this panel's state"; a board holding no run stores nothing and drops any
   * earlier copy, which is what makes a `reset` clear the record without the
   * save having to know what a reset is (`snapshotHasRun`).
   */
  const ownSnapshot = (): SpeedlineSnapshot | CountdownSnapshot =>
    // The factory's product is the `state_snapshot` variant by contract — the
    // same price the generic factories pay for a stamped selection.
    (buildSnapshotRef.current(enabledPreviewRef.current) as { data: SpeedlineSnapshot }).data;

  /**
   * Everything about this board an operator could have moved, as one value: its
   * whole snapshot (minus the build stamp, which moves on its own) plus its
   * selection. The restore below refuses to fire when this differs from what it
   * was at open — see `pristineRef`.
   */
  const boardFingerprint = (): string =>
    `${JSON.stringify(ownSnapshot(), (key, value) => (key === 'at' ? undefined : value))}|${signatureRef.current}`;

  const saveSelfSnapshot = () => {
    const data = ownSnapshot();
    const { discipline } = selectionRef.current;
    if (!snapshotHasRun(data)) {
      clearSelfSnapshot(sessionIdRef.current, discipline);
      return;
    }
    storeSelfSnapshot(sessionIdRef.current, discipline, {
      at: Date.now(),
      snapshot: data,
      selection: selectionRef.current,
    });
  };

  const queueSelfSave = () => {
    if (saveTimerRef.current !== null) return;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveSelfSnapshot();
    }, SELF_SAVE_DELAY_MS);
  };

  // Identity-stable (`sendRaw` is too): the Freestyle drains take it as an effect
  // dependency, so a fresh closure per render would re-run all three per render.
  const sendWSMessage = useCallback(
    (message: DistributiveOmit<T, 'sessionId'>) => {
      // A local operator action is live truth too — it closes the recovery window
      // just like an incoming peer message does.
      if (LIVE_TIMER_TYPES.has((message as { type: WSMessage['type'] }).type)) {
        liveSinceOpenRef.current = true;
        // The operator is driving this board again, so the recovery notice has
        // said what it had to say.
        setSelfRecovered(false);
        queueSelfSave();
      }
      sendRaw(message);
    },
    [sendRaw],
  );

  /**
   * Every selection leaves stamped, and says whether the stamp is a claim or a
   * re-statement (ADR 0038 §4 addendum). `restated` is the stamp this frame
   * re-states a value it merely holds under; null mints fresh authority. `echo`
   * is derived from that one fact rather than passed in, so the flag cannot
   * drift from the stamp it describes — and a frame that claims nothing new
   * leaves `selectionStampRef` alone: overwriting it with this panel's own id
   * downgraded its stored authority to an echo's and re-opened the tie against a
   * third panel's re-push.
   *
   * The cast is the price of adding the stamp to a generic factory product (the
   * variant carries `seq?`/`echo?` in both unions).
   */
  const sendSelection = (data: LiveSelection, restated: SelectionStamp | null) => {
    if (restated) {
      sendWSMessage({
        ...buildSelection(data),
        seq: restated.seq,
        echo: true,
      } as DistributiveOmit<T, 'sessionId'>);
      return;
    }
    const seq = stampAnchoredRef.current
      ? Math.max(selectionStampRef.current.seq + 1, Date.now())
      : selectionStampRef.current.seq + 1;
    selectionStampRef.current = { seq, by: senderId, echo: false };
    sendWSMessage({ ...buildSelection(data), seq } as DistributiveOmit<T, 'sessionId'>);
  };

  /**
   * The push effect's one-shot read of the pending mirror forward: the stamp to
   * re-state `produced` under, or null when this push is the operator's own
   * intent (see `mirroredStampRef`). Either answer ends the forward — a local
   * claim supersedes it, and the adoption still to land then re-pushes the
   * MERGED value under authority of its own, which is what carries the operator's
   * edit to the room.
   */
  const forwardFor = (produced: string): SelectionStamp | null => {
    const pending = mirroredStampRef.current;
    mirroredStampRef.current = null;
    return pending && pending.heldSignature !== produced ? pending.stamp : null;
  };

  /**
   * The only writer of the preview ref+state pair — the ref exists solely so the
   * peer effect can answer a `request_state` without a stale flag, and a site
   * that set one without the other would answer for a preview nobody is
   * showing. Write-free by design: mirroring a peer's flag must not re-broadcast
   * it, so the toggle adds its own `updatePreview` rather than this doing it.
   */
  const applyPreviewEnabled = (next: boolean) => {
    enabledPreviewRef.current = next;
    setEnabledPreview(next);
  };

  const togglePreview = () => {
    const next = !enabledPreviewRef.current;
    applyPreviewEnabled(next);
    sendWSMessage(buildPreview(next));
  };

  /**
   * The solo panel's catch-up, offered when the mirror-on-open ask went
   * unanswered (ADR 0047). Deliberately the LAST resort: a peer answer or any
   * live frame since open means the room is speaking for itself, and the stored
   * copy is not applied at all. Selection first, then the snapshot — the same
   * order a peer answers in (`request_state` below), so the board's derived
   * selection deps hydrate against the room's values in either path.
   */
  const restoreSelfSnapshot = () => {
    if (selfRestoreDoneRef.current) return;
    selfRestoreDoneRef.current = true;
    if (peerAnsweredRef.current || liveSinceOpenRef.current || !applySnapshot) return;
    if (pristineRef.current !== boardFingerprint()) return;
    const stored = readSelfSnapshot(
      sessionIdRef.current,
      selectionRef.current.discipline,
      Date.now(),
    );
    if (!stored || !snapshotHasRun(stored.snapshot)) return;
    applySelection?.(stored.selection);
    if (!applySnapshot(stored.snapshot)) return;
    applyPreviewEnabled(stored.snapshot.isPreviewEnabled);
    setSelfRecovered(true);
  };

  // Mirror-on-open (ADR 0038): a control panel joining a session where a peer
  // panel is already live must catch up, so it requests state exactly like a
  // preview does. Re-arms the snapshot gate per (re)open so a reconnect can
  // recover again. The shape is mode-invariant (session variant, no timerId),
  // hence the cast past the generic union.
  // Every (re)open re-asks, so peer presence is re-inferred with it: a room that
  // emptied while the link was down must not keep reading `answered`.
  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;
    liveSinceOpenRef.current = false;
    peerAnsweredRef.current = false;
    pristineRef.current = boardFingerprint();
    sendRaw({ type: 'request_state', data: {} } as DistributiveOmit<T, 'sessionId'>);
    setPeerState('awaiting');
    const timeoutId = window.setTimeout(() => {
      setPeerState((state) => (state === 'awaiting' ? 'alone' : state));
      restoreSelfSnapshot();
    }, PEER_ANSWER_MS);
    return () => window.clearTimeout(timeoutId);
  }, [readyState]);

  // Peer traffic (the relay never echoes our own sends back — single socket).
  // Answer a request_state with the current selection AND the snapshot AND the
  // lane names: each carries state a snapshot doesn't (the selection's best-of-3
  // runWins / best-trick tally, the lane names' resolved athlete labels), and
  // all three are otherwise only pushed on selection-change or socket OPEN.
  // Every control panel answers — converged panels agree, last writer wins at
  // the consumer.
  // Selection is answered BEFORE the snapshot on purpose (defense-in-depth): the
  // snapshot hydrates the joiner's derived-selection deps and can flip a default
  // push in the gap before the room's selection re-applies; leading with the
  // selection closes that window at the source (the stampAnchoredRef Lamport
  // stamp already makes any such push harmless, so this is belt-and-braces).
  // Peer `updateSelection` mirrors into the recorder; `updateLaneNames` does NOT
  // (names re-derive locally from the mirrored athlete ids — mirroring the
  // derived copy would fight the local derivation).
  useEffect(() => {
    if (!peerMessage) return;
    const message: WSMessage = peerMessage;
    if (LIVE_TIMER_TYPES.has(message.type)) {
      liveSinceOpenRef.current = true;
      // A mirrored peer action is this board's state too (ADR 0038), so it is
      // saved like a local one — and it ends the recovery notice the same way.
      setSelfRecovered(false);
      queueSelfSave();
    }
    // Presence and the cue token come off the same test: the frames only a
    // panel sends are exactly the frames worth flashing. `request_state` is
    // deliberately not one — a preview asks it too, so it cannot prove a peer
    // *panel*; the cost is that a silent late joiner stays invisible until it
    // acts, which is when its cue would fire anyway.
    const kind = peerEventKind(message);
    if (kind !== null) {
      peerSeqRef.current += 1;
      setLastPeerEvent({
        seq: peerSeqRef.current,
        kind,
        timerId: 'timerId' in message ? message.timerId : null,
      });
      setPeerState('answered');
      peerAnsweredRef.current = true;
      // A re-push this frame CAUSES is an echo of the room, not an edit here
      // (see mirroredStampRef) — `signature` is the board as it stands before
      // the frame is applied, so the push can tell the two apart. An
      // `updateSelection` refines the stamp to the one it just accepted.
      mirroredStampRef.current = { stamp: selectionStampRef.current, heldSignature: signature };
    }
    switch (message.type) {
      case 'request_state': {
        // The answer RE-STATES a value this panel merely holds, so it forwards
        // the stamp it holds rather than minting fresh authority for it: a
        // mirror answering a joiner mid-event otherwise put its pre-adoption
        // tally above the acting panel's live edit, at every consumer, until
        // the next edit. A panel holding nothing yet (seq 0) still mints under
        // the `stampAnchoredRef` rule, so the joiner-defaults guard is intact.
        const held = selectionStampRef.current;
        sendSelection(selectionRef.current, held.seq > 0 ? held : null);
        sendWSMessage(buildSnapshot(enabledPreviewRef.current));
        sendWSMessage(buildLaneNames(laneNamesRef.current));
        break;
      }
      case 'updateSelection': {
        // LWW drop (see selectionStampRef); unstamped pre-feature messages pass.
        const stamp = acceptSelectionStamp(selectionStampRef.current, message);
        if (!stamp) break;
        selectionStampRef.current = stamp;
        // The room's selection has been seen — from here on this panel's own
        // pushes carry real information and mint wall-clock stamps.
        stampAnchoredRef.current = true;
        mirroredStampRef.current = { stamp, heldSignature: signature };
        applySelection?.(message.data);
        break;
      }
      case 'updatePreview':
        // Mirror a peer panel's live show/hide-preview toggle (ADR 0038 didn't
        // enumerate it — a `state_snapshot` only converges the flag on join, so
        // a later peer toggle otherwise drifts until the next request_state).
        // Write-free like the snapshot path: setting the ref+state never
        // re-broadcasts, so there is no cross-panel echo to terminate.
        applyPreviewEnabled(message.data.enabled);
        break;
      case 'state_snapshot':
        if (liveSinceOpenRef.current || !applySnapshot) break;
        if (applySnapshot(message.data)) applyPreviewEnabled(message.data.isPreviewEnabled);
        break;
    }
  }, [peerMessage]);

  // Push the lane/player names on every selection change and once the socket
  // reaches OPEN, so a preview/overlay that connects after a selection still
  // gets the names. Names are derived purely from the recorder's existing
  // athleteId selection; there is no second source.
  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;
    if (!namesAnnouncedRef.current) {
      namesAnnouncedRef.current = true; // the mount announce — defaults, skip
      return;
    }
    sendWSMessage(buildLaneNames(laneNames));
  }, [laneNames.lane1, laneNames.lane2, readyState]);

  // Distribute the board's current selection so overlays can follow it live (the
  // live VS match + the live SVO card). Same re-push pattern as the names: on
  // every selection change and on socket OPEN. The structural signature carries
  // both halves of the contract: it follows a field nobody thought to enumerate
  // (the dep array it replaced did not), and a mirrored — value-equal — peer
  // application leaves it unchanged, so the cross-panel echo dies out.
  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;
    if (!selectionAnnouncedRef.current) {
      selectionAnnouncedRef.current = true; // the mount announce — defaults, skip
      return;
    }
    sendSelection(selectionRef.current, forwardFor(signature));
    // A run is only recoverable with the athletes/round/match it belongs to, so
    // the local copy follows the selection as well as the clocks.
    queueSelfSave();
  }, [signature, readyState]);

  // Flush a coalesced save on unmount (a nav-away inside the window), and never
  // leave a timeout to fire into a torn-down panel.
  useEffect(
    () => () => {
      if (saveTimerRef.current === null) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      saveSelfSnapshot();
    },
    [],
  );

  // Drop an unconsumed forward, and the reason it can't leak into a later local
  // edit: every peer frame bumps `lastPeerEvent`, so this runs exactly once in
  // the commit the adoption produced — after the push effect above has had its
  // chance at it. An adoption that moved nothing (an equal re-push, a
  // foreign-discipline selection the page ignores) therefore leaves no stamp
  // armed.
  useEffect(() => {
    mirroredStampRef.current = null;
  }, [lastPeerEvent]);

  return {
    sendWSMessage,
    /** The incoming stream — pure peer traffic (the relay excludes the sending
     * connection, so a page never receives its own sends). What a control page
     * applies peer timer messages from. */
    peerMessage,
    readyState,
    /** The graded link the health surfaces report (see `useLinkPhase`). */
    link,
    enabledPreview,
    togglePreview,
    /** Whether another control panel is known to be in the room (see `PeerState`). */
    peerState,
    /** The last board change a peer panel made here — a surface's cue token. */
    lastPeerEvent,
    /** Whether this panel came back on its own browser-local copy (ADR 0047) —
     * the header says so until the operator acts again. */
    selfRecovered,
  };
};
