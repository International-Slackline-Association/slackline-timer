import { useEffect, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadyState } from 'react-use-websocket';

import type {
  CountdownSnapshot,
  DistributiveOmit,
  FreestyleSelection,
  LiveSelection,
  SpeedlineSnapshot,
  StopwatchWSMessage,
  WSMessage,
} from 'app/hooks/useWebSocket';

// One useWS call — the session's single relay socket (ADR 0043). The mock
// controls its readyState and the incoming (peer-only) lastJsonMessage.
const { useWSMock } = vi.hoisted(() => ({ useWSMock: vi.fn() }));
vi.mock('app/hooks/useWebSocket', () => ({ useWS: useWSMock }));

const { useQueryParamsMock } = vi.hoisted(() => ({ useQueryParamsMock: vi.fn() }));
vi.mock('app/hooks/useQueryParams', () => ({ useQueryParams: useQueryParamsMock }));

const { useSelectedCompetitionMock } = vi.hoisted(() => ({ useSelectedCompetitionMock: vi.fn() }));
vi.mock('app/state/selectedCompetition', () => ({
  useSelectedCompetition: useSelectedCompetitionMock,
}));

import {
  PEER_ANSWER_MS,
  SELF_SAVE_DELAY_MS,
  useControlSession,
  useSessionId,
} from 'app/hooks/useControlSession';
import {
  SELF_SNAPSHOT_MAX_AGE_MS,
  readSelfSnapshot,
  storeSelfSnapshot,
} from 'app/state/selfSnapshotMemory';

// The suite's board is the FREESTYLE one: the stamp/echo cases below all ride
// `bestTrick`, which lives on that arm of the selection union alone.
const selection: FreestyleSelection = {
  discipline: 'freestyle',
  round: 'final',
  gender: 'male',
  matchId: null,
  athlete1Id: null,
  athlete2Id: null,
};

const baseParams = () => ({
  sessionId: 'comp-1',
  runLive: false,
  laneNames: { lane1: '', lane2: '' },
  selection,
  buildPreview: (enabled: boolean): DistributiveOmit<StopwatchWSMessage, 'sessionId'> => ({
    type: 'updatePreview',
    data: { enabled },
  }),
  buildLaneNames: (data: {
    lane1: string;
    lane2: string;
  }): DistributiveOmit<StopwatchWSMessage, 'sessionId'> => ({
    type: 'updateLaneNames',
    data,
  }),
  buildSelection: (data: LiveSelection): DistributiveOmit<StopwatchWSMessage, 'sessionId'> => ({
    type: 'updateSelection',
    data,
  }),
  buildSnapshot: (
    isPreviewEnabled: boolean,
  ): DistributiveOmit<StopwatchWSMessage, 'sessionId'> => ({
    type: 'state_snapshot',
    data: { isPreviewEnabled, signalPhase: 0, text: '', timers: [] },
  }),
});

let senderSend: ReturnType<typeof vi.fn>;
let socketState: { readyState: ReadyState; lastJsonMessage: unknown };

// This page's per-mount id — stamped on outgoing selections as the LWW tiebreak.
const OWN_SENDER_ID = 'own-sender-id';

const configureSocket = () => {
  senderSend = vi.fn();
  useWSMock.mockImplementation(() => ({
    sendWSMessage: senderSend,
    readyState: socketState.readyState,
    lastJsonMessage: socketState.lastJsonMessage,
    senderId: OWN_SENDER_ID,
  }));
};

/** The selection payloads pushed so far, in order. */
const selectionPushes = (): LiveSelection[] =>
  senderSend.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === 'updateSelection')
    .map((message) => message.data);

/** The selection frames pushed so far, stamps and authority flag included. */
const selectionFrames = (): { seq?: number; echo?: true }[] =>
  senderSend.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === 'updateSelection');

/** The LWW stamps carried by those pushes, in the same order. */
const selectionStamps = (): number[] => selectionFrames().map((message) => message.seq as number);

beforeEach(() => {
  socketState = { readyState: ReadyState.OPEN, lastJsonMessage: null };
  useQueryParamsMock.mockReturnValue({ sessionId: 'default' });
  useSelectedCompetitionMock.mockReturnValue({ compId: 'comp-1' });
  configureSocket();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSessionId', () => {
  it('prefers an explicit URL sessionId over the selected competition', () => {
    useQueryParamsMock.mockReturnValue({ sessionId: 'url-session' });
    const { result } = renderHook(() => useSessionId());
    expect(result.current).toBe('url-session');
  });

  it("falls back to the selected competition's compId when the URL is default", () => {
    const { result } = renderHook(() => useSessionId());
    expect(result.current).toBe('comp-1');
  });

  it("falls back to 'default' with no URL session and no competition", () => {
    useSelectedCompetitionMock.mockReturnValue({ compId: undefined });
    const { result } = renderHook(() => useSessionId());
    expect(result.current).toBe('default');
  });
});

describe('useControlSession', () => {
  it('skips the mount-time names/selection announce (a joiner must not blast defaults)', () => {
    // ADR 0038: a panel opening into a live session would otherwise race its
    // DEFAULT selection/names against the peers' request_state answers and can
    // wipe the converged board (the phase-0 announce precedent). The first
    // sender-OPEN fire is consumed silently.
    renderHook(() => useControlSession(baseParams()));
    expect(senderSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'updateLaneNames' }),
    );
    expect(senderSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'updateSelection' }),
    );
  });

  it('pushes lane names and selection once they change after the mount announce', () => {
    const params = baseParams();
    const { rerender } = renderHook((p) => useControlSession(p), { initialProps: params });

    const laneNames = { lane1: 'Alice', lane2: 'Bob' };
    const changed: LiveSelection = { ...selection, round: 'quarter' };
    rerender({ ...params, laneNames, selection: changed });

    expect(senderSend).toHaveBeenCalledWith({ type: 'updateLaneNames', data: laneNames });
    expect(senderSend).toHaveBeenCalledWith({
      type: 'updateSelection',
      data: changed,
      seq: expect.any(Number),
    });
  });

  it('re-pushes names + selection on a socket re-open (reconnect recovery)', () => {
    const { rerender } = renderHook(() => useControlSession(baseParams()));

    socketState = { readyState: ReadyState.CLOSED, lastJsonMessage: null };
    configureSocket();
    rerender();
    senderSend.mockClear();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: null };
    configureSocket();
    rerender();

    expect(senderSend).toHaveBeenCalledWith({
      type: 'updateLaneNames',
      data: { lane1: '', lane2: '' },
    });
    expect(senderSend).toHaveBeenCalledWith({
      type: 'updateSelection',
      data: selection,
      seq: expect.any(Number),
    });
  });

  it('re-pushes once when a nested tally member changes (structural signature)', () => {
    const params = baseParams();
    const bestTrick = { cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: false } as const;
    const armed: LiveSelection = { ...selection, bestTrick: { ...bestTrick } };
    const { rerender } = renderHook((p) => useControlSession(p), {
      initialProps: { ...params, selection: armed },
    });
    senderSend.mockClear(); // past the mount announce

    const tried: LiveSelection = { ...armed, bestTrick: { ...bestTrick, tries: { 1: 1, 2: 0 } } };
    rerender({ ...params, selection: tried });

    expect(selectionPushes()).toEqual([tried]);
  });

  it('does not re-push a value-equal selection (the cross-panel echo terminates)', () => {
    // A mirrored peer application rebuilds the selection object; only its
    // identity changed, so the re-push key must not move — otherwise the two
    // panels push each other's value back and forth forever.
    const params = baseParams();
    const bestTrick = { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: true } as const;
    const armed: LiveSelection = { ...selection, bestTrick: { ...bestTrick } };
    const { rerender } = renderHook((p) => useControlSession(p), {
      initialProps: { ...params, selection: armed },
    });
    senderSend.mockClear();

    rerender({ ...params, selection: { ...selection, bestTrick: { ...bestTrick } } });

    expect(selectionPushes()).toEqual([]);
  });

  it('does not push while the socket is not OPEN', () => {
    socketState = { readyState: ReadyState.CONNECTING, lastJsonMessage: null };
    configureSocket();
    renderHook(() => useControlSession(baseParams()));
    expect(senderSend).not.toHaveBeenCalled();
  });

  it('toggles the preview and broadcasts the new enabled flag', () => {
    const { result } = renderHook(() => useControlSession(baseParams()));
    expect(result.current.enabledPreview).toBe(true);

    act(() => result.current.togglePreview());

    expect(result.current.enabledPreview).toBe(false);
    expect(senderSend).toHaveBeenCalledWith({ type: 'updatePreview', data: { enabled: false } });
  });

  it('answers a request_state with a snapshot carrying the live preview flag', () => {
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));
    act(() => result.current.togglePreview()); // preview now disabled

    senderSend.mockClear();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: { type: 'request_state' } };
    configureSocket();
    rerender();

    expect(senderSend).toHaveBeenCalledWith({
      type: 'state_snapshot',
      data: { isPreviewEnabled: false, signalPhase: 0, text: '', timers: [] },
    });
  });

  it('also re-sends the live selection on request_state (recovers runWins / best-trick)', () => {
    const { rerender } = renderHook(() => useControlSession(baseParams()));

    senderSend.mockClear();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: { type: 'request_state' } };
    configureSocket();
    rerender();

    expect(senderSend).toHaveBeenCalledWith({
      type: 'updateSelection',
      data: selection,
      seq: expect.any(Number),
    });
  });

  it('also re-sends the lane names on request_state (recovers athlete names)', () => {
    const laneNames = { lane1: 'Alice', lane2: 'Bob' };
    const { rerender } = renderHook(() => useControlSession({ ...baseParams(), laneNames }));

    senderSend.mockClear();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: { type: 'request_state' } };
    configureSocket();
    rerender();

    expect(senderSend).toHaveBeenCalledWith({ type: 'updateLaneNames', data: laneNames });
  });

  it('answers with updateSelection before state_snapshot (poisoned-push defense)', () => {
    // Defense-in-depth: the joiner hydrates the snapshot into its derived-selection
    // deps, which can flip a default push in the window before the room's own
    // selection re-applies. Sending updateSelection first means the room's
    // selection lands ahead of the snapshot, so that window never opens (the
    // round-12 Lamport stamp keeps it harmless regardless).
    const { rerender } = renderHook(() => useControlSession(baseParams()));

    senderSend.mockClear();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: { type: 'request_state' } };
    configureSocket();
    rerender();

    const types = senderSend.mock.calls.map(([m]) => m.type);
    expect(types.indexOf('updateSelection')).toBeLessThan(types.indexOf('state_snapshot'));
  });
});

describe('useControlSession peer mirroring (ADR 0038)', () => {
  const snapshot = (isPreviewEnabled: boolean) => ({
    isPreviewEnabled,
    signalPhase: 0,
    text: '',
    timers: [],
  });

  /** Deliver an incoming peer message and rerender so the hook sees it. */
  const deliver = (rerender: () => void, message: unknown) => {
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: message };
    configureSocket();
    rerender();
  };

  it('sends request_state once the socket is OPEN (mirror-on-open)', () => {
    renderHook(() => useControlSession(baseParams()));
    expect(senderSend).toHaveBeenCalledWith({ type: 'request_state', data: {} });
  });

  it('does not request state while the socket is not OPEN', () => {
    socketState = { readyState: ReadyState.CONNECTING, lastJsonMessage: null };
    configureSocket();
    renderHook(() => useControlSession(baseParams()));
    expect(senderSend).not.toHaveBeenCalledWith({ type: 'request_state', data: {} });
  });

  it('applies a peer state_snapshot and mirrors its preview flag', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    const { result, rerender } = renderHook(() =>
      useControlSession({ ...baseParams(), applySnapshot }),
    );

    deliver(rerender, {
      type: 'state_snapshot',
      senderId: 'peer-panel',
      data: snapshot(false),
    });

    expect(applySnapshot).toHaveBeenCalledWith(snapshot(false));
    expect(result.current.enabledPreview).toBe(false);
  });

  it("does not re-broadcast a snapshot's mirrored preview flag (write-free)", () => {
    // All three writers of the preview ref+state pair go through one helper, and
    // only the operator's own toggle broadcasts — a mirrored flag that re-sent
    // `updatePreview` would put the two panels in an echo.
    const applySnapshot = vi.fn().mockReturnValue(true);
    const { rerender } = renderHook(() => useControlSession({ ...baseParams(), applySnapshot }));

    senderSend.mockClear();
    deliver(rerender, { type: 'state_snapshot', senderId: 'peer-panel', data: snapshot(false) });

    expect(senderSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'updatePreview' }));
  });

  it('keeps its own preview flag when applySnapshot rejects a foreign-mode snapshot', () => {
    const applySnapshot = vi.fn().mockReturnValue(false);
    const { result, rerender } = renderHook(() =>
      useControlSession({ ...baseParams(), applySnapshot }),
    );

    deliver(rerender, { type: 'state_snapshot', senderId: 'peer-panel', data: snapshot(false) });

    expect(applySnapshot).toHaveBeenCalled();
    expect(result.current.enabledPreview).toBe(true);
  });

  it('drops a snapshot once a live peer timer message arrived (live-beats-snapshot)', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    const { rerender } = renderHook(() => useControlSession({ ...baseParams(), applySnapshot }));

    deliver(rerender, { type: 'start', senderId: 'peer-panel', data: { startTime: 1000 } });
    deliver(rerender, { type: 'state_snapshot', senderId: 'peer-panel', data: snapshot(false) });

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('drops a snapshot once a local live timer message was sent', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    const { result, rerender } = renderHook(() =>
      useControlSession({ ...baseParams(), applySnapshot }),
    );

    act(() =>
      result.current.sendWSMessage({ type: 'start', data: { startTime: 1000 } } as Parameters<
        typeof result.current.sendWSMessage
      >[0]),
    );
    deliver(rerender, { type: 'state_snapshot', senderId: 'peer-panel', data: snapshot(false) });

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('mirrors a peer updatePreview toggle live into the local flag', () => {
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));
    expect(result.current.enabledPreview).toBe(true);

    deliver(rerender, { type: 'updatePreview', senderId: 'peer-panel', data: { enabled: false } });
    expect(result.current.enabledPreview).toBe(false);

    deliver(rerender, { type: 'updatePreview', senderId: 'peer-panel', data: { enabled: true } });
    expect(result.current.enabledPreview).toBe(true);
  });

  it('does not re-broadcast a mirrored peer updatePreview (no echo)', () => {
    const { rerender } = renderHook(() => useControlSession(baseParams()));

    senderSend.mockClear();
    deliver(rerender, { type: 'updatePreview', senderId: 'peer-panel', data: { enabled: false } });

    expect(senderSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'updatePreview' }));
  });

  it('answers a later request_state with the peer-mirrored preview flag', () => {
    const { rerender } = renderHook(() => useControlSession(baseParams()));

    deliver(rerender, { type: 'updatePreview', senderId: 'peer-panel', data: { enabled: false } });

    senderSend.mockClear();
    deliver(rerender, { type: 'request_state', senderId: 'peer-panel', data: {} });

    expect(senderSend).toHaveBeenCalledWith({
      type: 'state_snapshot',
      data: { isPreviewEnabled: false, signalPhase: 0, text: '', timers: [] },
    });
  });

  it('mirrors a peer updateSelection via applySelection', () => {
    const applySelection = vi.fn();
    const { rerender } = renderHook(() => useControlSession({ ...baseParams(), applySelection }));
    const peerSelection: LiveSelection = { ...selection, round: 'quarter' };

    deliver(rerender, { type: 'updateSelection', senderId: 'peer-panel', data: peerSelection });

    expect(applySelection).toHaveBeenCalledWith(peerSelection);
  });

  it('drops a stale-stamped peer selection (last-writer-wins by seq)', () => {
    const applySelection = vi.fn();
    const { rerender } = renderHook(() => useControlSession({ ...baseParams(), applySelection }));

    deliver(rerender, {
      type: 'updateSelection',
      senderId: 'peer-b',
      seq: 100,
      data: { ...selection, round: 'half' },
    });
    expect(applySelection).toHaveBeenCalledTimes(1);

    // An older concurrent edit arriving late (crossed in flight) must not roll
    // the board back — applying it would re-open the ping-pong.
    deliver(rerender, {
      type: 'updateSelection',
      senderId: 'peer-c',
      seq: 99,
      data: { ...selection, round: 'quarter' },
    });
    expect(applySelection).toHaveBeenCalledTimes(1);
  });

  it('mints Lamport-low stamps until a peer selection was seen (joiner-defaults guard)', () => {
    // The peer-mirroring smoke's wipe regression: a joiner's snapshot hydration
    // flips a derived selection dep (battle nextUp 1→null) AFTER the one-shot
    // mount-announce skip was consumed, so the panel pushes its DEFAULT
    // selection. Wall-clock stamping made that push outstamp the live room's
    // request_state answers (minted milliseconds earlier), converging every
    // panel to the joiner's defaults. Until the panel has SEEN the room's
    // stamp, its pushes must be Lamport-low so any live peer drops them.
    const applySelection = vi.fn();
    let props = { ...baseParams(), applySelection };
    const { rerender } = renderHook(() => useControlSession(props));

    // The derived dep flip during the join handshake — before any peer message.
    props = { ...props, selection: { ...selection, round: 'quarter' } };
    rerender();
    const early = senderSend.mock.calls.map(([m]) => m).find((m) => m.type === 'updateSelection');
    expect(early.seq).toBe(1); // Lamport, NOT Date.now() — a live room drops it

    // The room's real selection arrives (wall-clock stamped) → applied.
    const roomStamp = 5_000_000;
    deliver(rerender, {
      type: 'updateSelection',
      senderId: 'peer-panel',
      seq: roomStamp,
      data: { ...selection, round: 'half' },
    });
    expect(applySelection).toHaveBeenCalled();

    // Anchored now: a later local change outstamps the room (wall-clock).
    senderSend.mockClear();
    props = { ...props, selection: { ...selection, round: 'small_final' } };
    rerender();
    const late = senderSend.mock.calls.map(([m]) => m).find((m) => m.type === 'updateSelection');
    expect(late.seq).toBeGreaterThan(roomStamp);
    expect(late.seq).toBeGreaterThanOrEqual(Date.now() - 60_000);
  });

  /**
   * A panel whose page ADOPTS a peer selection the way the real board does: the
   * adoption is a state write inside the peer effect, so React commits it in the
   * SAME render as the hook's own peer bookkeeping. Hence the live-reading
   * `selection` prop — a fresh props object could only land a commit later, which
   * no page does. `adopt` returns the value the mirror ends up holding, so a
   * partial/reconstructed adoption (the divergent-echo case) is expressible.
   */
  const mirroringPanel = (adopt: (sel: FreestyleSelection) => FreestyleSelection) => {
    let board: FreestyleSelection = selection;
    const base = baseParams();
    return {
      params: {
        ...base,
        get selection() {
          return board;
        },
        applySelection: (sel: LiveSelection) => {
          if (sel.discipline !== 'freestyle') return;
          board = adopt(sel);
        },
      },
      edit: (patch: Partial<FreestyleSelection>) => {
        board = { ...board, ...patch };
      },
    };
  };

  const roomStamp = 5_000_000;
  const peerSelection = {
    type: 'updateSelection' as const,
    senderId: 'peer-panel',
    seq: roomStamp,
    data: { ...selection, round: 'half' },
  };

  it('forwards the stamp a mirrored re-push adopted, never re-anchoring it', () => {
    // The mirror's re-push re-states a value it ADOPTED, so it may not claim
    // authority newer than the edit it came from: a wall-clock re-anchor here
    // outstamps the acting panel's very next edit (minted in the same
    // millisecond), and the room drops it — the peer match change whose
    // retracting `bestTrick: undefined` never lands.
    const panel = mirroringPanel((sel) => ({
      ...sel,
      bestTrick: { cap: 3, tries: { 1: 0, 2: 0 }, turn: 2, clockRunning: false },
    }));
    const { rerender } = renderHook(() => useControlSession(panel.params));
    senderSend.mockClear(); // past the mount announce

    deliver(rerender, peerSelection);

    expect(selectionStamps()).toEqual([roomStamp]);
  });

  /**
   * A panel whose page REACTS to a peer timer frame the way the real board does:
   * the reaction is a state write in an effect declared after the session hook
   * (`useFreestyleBoard`'s peer-countdown effect), so the derived selection it
   * produces can only land in the NEXT commit — batched with the hook's own
   * `setLastPeerEvent`, which is the commit the forward is consumed in. That
   * one-commit gap is the whole causal signal: a change already present in the
   * render the peer frame arrived in cannot have come from it.
   */
  const reactingPanel = (react: (message: WSMessage) => Partial<FreestyleSelection> | null) => {
    let board: FreestyleSelection = selection;
    const params = {
      ...baseParams(),
      get selection() {
        return board;
      },
      applySelection: (sel: LiveSelection) => {
        if (sel.discipline === 'freestyle') board = sel;
      },
    };
    const { rerender } = renderHook(() => {
      const [, bump] = useState(0);
      const session = useControlSession(params);
      useEffect(() => {
        const patch = session.peerMessage ? react(session.peerMessage) : null;
        if (!patch) return;
        board = { ...board, ...patch };
        bump((n) => n + 1);
      }, [session.peerMessage]);
      return session;
    });
    return { rerender };
  };

  it('forwards the room stamp when a peer TIMER frame moves this mirror', () => {
    // A board sends TWO frames for one operator event — the selection and the
    // drained countdown — and a peer's countdown moves this panel's DERIVED
    // selection too (a try clock resting flips `bestTrick.clockRunning`/`turn`).
    // The re-push that follows is still an echo of that panel's event, so it
    // forwards the room's stamp for the same reason a mirrored selection does:
    // minting fresh wall-clock authority here outstamped the acting panel's
    // selection for the SAME event, the room dropped the real edit, and a
    // mid-try `Reset series` left the mirror on the tally it had just cleared
    // (the `fs series-reset` peer-mirroring leg).
    const panel = reactingPanel((message) =>
      message.type === 'reset_countdown'
        ? { bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false } }
        : null,
    );
    deliver(panel.rerender, peerSelection); // anchors this panel on the room's stamp

    deliver(panel.rerender, {
      type: 'reset_countdown',
      timerId: 3,
      data: { remainingMs: 30_000 },
    });

    expect(selectionFrames()).toEqual([
      { type: 'updateSelection', data: expect.anything(), seq: roomStamp, echo: true },
    ]);
  });

  it('re-states the room stamp after adopting a peer DISARM, never a fresh mint', () => {
    // The `peer-match-disarm-reorder-race` shape: a panel mirroring an armed
    // best-trick series adopts the peer's match change, whose selection carries
    // no `bestTrick` at all. The re-push that adoption causes retracts the
    // phase — and must leave as a RE-STATEMENT of the peer's stamp. A fresh
    // wall-clock mint here outstamps the acting panel's own next frame and
    // re-arms it on the series it has just left.
    const panel = mirroringPanel((sel) => sel);
    panel.edit({
      matchId: 'm1',
      bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 1, clockRunning: true },
    });
    const { rerender } = renderHook(() => useControlSession(panel.params));
    senderSend.mockClear(); // past the mount announce

    deliver(rerender, { ...peerSelection, data: { ...selection, matchId: 'm2' } });

    expect(selectionFrames()).toEqual([
      {
        type: 'updateSelection',
        data: { ...selection, matchId: 'm2' },
        seq: roomStamp,
        echo: true,
      },
    ]);
  });

  it('claims fresh authority for a local edit committed alongside a peer selection', () => {
    // The commit window is not intent: a peer frame landing in the render the
    // operator acted in used to consume the forward, so the LOCAL edit went out
    // as a re-statement — and a re-statement loses every tie by design, so every
    // peer dropped it (`fs best-trick: B's tally consumes the try`). The
    // adoption can only land a commit later, so a change already on screen when
    // the frame arrives is this operator's, and mints its own authority.
    const panel = mirroringPanel((sel) => ({ ...sel, round: 'quarter' }));
    const { rerender } = renderHook(() => useControlSession(panel.params));
    panel.edit({ round: 'quarter' });

    deliver(rerender, peerSelection);

    expect(selectionFrames()).toEqual([
      {
        type: 'updateSelection',
        data: { ...selection, round: 'quarter' },
        seq: expect.any(Number),
      },
    ]);
    expect(selectionStamps()[0]).toBeGreaterThan(roomStamp);
  });

  it('claims fresh authority for a local edit committed alongside a peer timer frame', () => {
    // The drain order is why the forward cannot be ended by the local live-timer
    // send instead: the board pushes its SELECTION before it drains the
    // countdown that belongs to the same operator event, so a clear hung on the
    // send would arrive one frame too late. The causal test sits on the
    // selection push itself.
    const panel = mirroringPanel((sel) => sel);
    const { rerender } = renderHook(() => useControlSession(panel.params));
    deliver(rerender, peerSelection); // anchored on the room's stamp
    panel.edit({ bestTrick: { cap: 3, tries: { 1: 1, 2: 0 }, turn: 2, clockRunning: false } });

    deliver(rerender, { type: 'reset_countdown', timerId: 3, data: { remainingMs: 30_000 } });

    const [frame] = selectionFrames();
    expect(frame.echo).toBeUndefined();
    expect(frame.seq).toBeGreaterThan(roomStamp);
  });

  it('mints fresh authority for the local edit after a mirrored re-push', () => {
    // One-shot: only the adoption's own echo forwards. The operator's next edit
    // is this panel's information and must outstamp the room.
    const panel = mirroringPanel((sel) => ({ ...sel, matchId: 'mirrored' }));
    const { rerender } = renderHook(() => useControlSession(panel.params));
    deliver(rerender, peerSelection);
    senderSend.mockClear();

    panel.edit({ round: 'quarter' });
    rerender();

    const [seq] = selectionStamps();
    expect(seq).toBeGreaterThan(roomStamp);
    expect(seq).toBeGreaterThanOrEqual(Date.now() - 60_000);
  });

  it('marks a mirrored re-push as an echo — a re-statement loses every tie', () => {
    // The stamp forward can only TIE the panel that authored the value, so the
    // wire has to say which of the two a frame is: otherwise the tie falls to
    // `senderId`, a per-mount UUID, and whether a mirror outranks its own author
    // is decided once per room by a coin flip (`fsux-peer-series-stamp-race`).
    const panel = mirroringPanel((sel) => ({ ...sel, matchId: 'mirrored' }));
    const { rerender } = renderHook(() => useControlSession(panel.params));
    senderSend.mockClear();

    deliver(rerender, peerSelection);

    expect(selectionFrames()).toEqual([
      { type: 'updateSelection', data: expect.anything(), seq: roomStamp, echo: true },
    ]);
  });

  it('restates the stamp it holds on a request_state answer, minting nothing', () => {
    // The second instance of the same class: the answer re-states a value this
    // panel merely HOLDS. Minting fresh wall-clock authority for it put a
    // mirror's pre-adoption tally above the acting panel's live edit at every
    // consumer, until the next edit.
    const { rerender } = renderHook(() =>
      useControlSession({ ...baseParams(), applySelection: vi.fn() }),
    );
    deliver(rerender, peerSelection); // the room's stamp is now the one this panel holds
    senderSend.mockClear();

    deliver(rerender, { type: 'request_state', senderId: 'joiner', data: {} });

    expect(selectionFrames()).toEqual([
      { type: 'updateSelection', data: selection, seq: roomStamp, echo: true },
    ]);
  });

  it('lends no stamp to a later local edit when the adoption changed nothing', () => {
    // The common case — an equal (or cross-discipline, ignored) peer selection
    // re-push moves nothing here, so no echo consumes the forward. It must not
    // sit armed until the operator's next edit, which would then be pushed at
    // the peer's stamp and dropped by half the room on the senderId tiebreak.
    const panel = mirroringPanel((sel) => sel);
    const { rerender } = renderHook(() => useControlSession(panel.params));
    deliver(rerender, { ...peerSelection, data: selection });
    senderSend.mockClear();

    panel.edit({ round: 'quarter' });
    rerender();

    const [seq] = selectionStamps();
    expect(seq).toBeGreaterThan(roomStamp);
    expect(seq).toBeGreaterThanOrEqual(Date.now() - 60_000);
  });
});

/**
 * Both sender-id orders, because the equal-`seq` tiebreak used to END here: a
 * mirror's echo can only tie the panel that authored the value, and the tie fell
 * to `senderId` — two `crypto.randomUUID()`s minted per mount. Which panel won
 * was a coin flip fixed for the life of the room, so every case below had a
 * 50 % chance of being asserted in its passing order. The order is a test
 * dimension now, and no case may depend on which id sorts higher.
 */
describe.each([
  { order: 'actor id low', idA: 'panel-a', idB: 'panel-z' },
  { order: 'actor id high', idA: 'panel-z', idB: 'panel-a' },
])('useControlSession concurrent selection edits (convergence bound, $order)', ({ idA, idB }) => {
  /**
   * A full two-panel simulation: each panel is a real `useControlSession` mount
   * whose `applySelection` mirrors the peer value into its own selection prop
   * (the recorder adoption), and whose `updateSelection` sends are routed to the
   * other panel over lossless per-channel FIFO queues — the WS relay's delivery
   * model. The pump below delivers in crossed round-trips (both panels' in-flight
   * messages swap each round), the worst case for the value-guard terminator.
   */
  interface PanelSim {
    id: string;
    send: ReturnType<typeof vi.fn>;
    inbox: unknown;
    selection: FreestyleSelection;
    /** What this panel's page ends up holding after adopting a peer selection —
     * identity for a faithful mirror, a rebuilt value for one whose adoption
     * diverges (the board reconstructs its own `bestTrick` wire view). */
    adopt: (sel: FreestyleSelection) => FreestyleSelection;
    /** In-flight updateSelection messages toward the other panel. */
    outbox: { type: 'updateSelection'; data: LiveSelection; seq?: number; senderId: string }[];
    rerender: (props: ReturnType<typeof panelParams>) => void;
  }

  let active: PanelSim;

  const panelParams = (panel: PanelSim) => ({
    ...baseParams(),
    // Live-reading, because the recorder's adoption is a state write inside the
    // peer effect: React commits it in the SAME render as the hook's own peer
    // bookkeeping, where a fresh props object could only land a commit later.
    get selection() {
      return panel.selection;
    },
    applySelection: (sel: LiveSelection) => {
      if (sel.discipline !== 'freestyle') return;
      panel.selection = panel.adopt(sel);
    },
  });

  const renderPanel = (panel: PanelSim) => {
    active = panel;
    panel.rerender(panelParams(panel));
  };

  const makePanel = (
    id: string,
    adopt = (sel: FreestyleSelection): FreestyleSelection => sel,
  ): PanelSim => {
    const panel: PanelSim = {
      id,
      send: vi.fn(),
      inbox: null,
      selection,
      adopt,
      outbox: [],
      rerender: () => {},
    };
    panel.send.mockImplementation(
      (message: { type: 'updateSelection'; data: LiveSelection; seq?: number }) => {
        if (message.type === 'updateSelection') {
          // useWS stamps the envelope senderId on every send.
          panel.outbox.push({ ...message, senderId: panel.id });
        }
      },
    );
    return panel;
  };

  const wireSockets = () => {
    useWSMock.mockImplementation(() => ({
      sendWSMessage: active.send,
      readyState: ReadyState.OPEN,
      lastJsonMessage: active.inbox,
      senderId: active.id,
    }));
  };

  const mountPanel = (panel: PanelSim) => {
    active = panel;
    const { rerender } = renderHook((p) => useControlSession(p), {
      initialProps: panelParams(panel),
    });
    panel.rerender = rerender;
  };

  const deliver = (panel: PanelSim, message: unknown) => {
    panel.inbox = message;
    renderPanel(panel);
  };

  const localEdit = (panel: PanelSim, patch: Partial<FreestyleSelection>) => {
    panel.selection = { ...panel.selection, ...patch };
    renderPanel(panel);
  };

  /** An operator edit and a peer frame landing in the SAME render — the commit
   * window the stamp forward used to be armed by, regardless of intent. */
  const collide = (panel: PanelSim, patch: Partial<FreestyleSelection>, message: unknown) => {
    panel.selection = { ...panel.selection, ...patch };
    panel.inbox = message;
    renderPanel(panel);
  };

  it('two panels editing simultaneously converge within a bounded number of round trips', () => {
    const a = makePanel(idA);
    const b = makePanel(idB);
    wireSockets();
    mountPanel(a);
    mountPanel(b);
    // Both panels are mid-session and converged; the join handshake
    // (request_state / snapshot answers) is pinned by the suites above.
    a.outbox.length = 0;
    b.outbox.length = 0;

    // The concurrent edit: both operators change the round inside one RTT, so
    // the two pushes cross in flight.
    localEdit(a, { round: 'quarter' });
    localEdit(b, { round: 'half' });

    const MAX_ROUND_TRIPS = 6;
    let roundTrips = 0;
    while (a.outbox.length + b.outbox.length > 0 && roundTrips <= MAX_ROUND_TRIPS) {
      const fromA = a.outbox.splice(0);
      const fromB = b.outbox.splice(0);
      fromA.forEach((message) => deliver(b, message));
      fromB.forEach((message) => deliver(a, message));
      roundTrips += 1;
    }

    // Bounded: the room must go quiet within the cap...
    expect(a.outbox.length + b.outbox.length).toBe(0);
    expect(roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    // ...and converged: both boards show the same round.
    expect(a.selection.round).toBe(b.selection.round);
  });

  it("a mirror's divergent echo cannot outstamp the acting panel's follow-up", () => {
    // The `fs peer-match` driver leg: panel A leaves match m1, and its board
    // retracts the best-trick series that belonged to it a beat later — two
    // pushes inside one round trip. B mirrors the match but rebuilds its own
    // `bestTrick` view, so its adoption diverges and re-pushes; that echo used
    // to carry a fresher wall-clock stamp than A's retraction, which B then
    // dropped — leaving the mirror armed on the series of the match it had just
    // left, and re-arming A off the echo.
    const tally = { cap: 3, tries: { 1: 1, 2: 0 }, clockRunning: false };
    const a = makePanel(idA);
    const b = makePanel(idB, (sel) => ({
      ...sel,
      bestTrick: sel.bestTrick ? { ...sel.bestTrick, turn: 1 } : undefined,
    }));
    wireSockets();
    a.selection = { ...selection, matchId: 'm1', bestTrick: { ...tally, turn: 2 } };
    b.selection = { ...selection, matchId: 'm1', bestTrick: { ...tally, turn: 1 } };
    mountPanel(a);
    mountPanel(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    localEdit(a, { matchId: 'm2' });
    a.outbox.splice(0).forEach((message) => deliver(b, message));
    localEdit(a, { bestTrick: undefined });

    const MAX_ROUND_TRIPS = 4;
    let roundTrips = 0;
    while (a.outbox.length + b.outbox.length > 0 && roundTrips <= MAX_ROUND_TRIPS) {
      const fromA = a.outbox.splice(0);
      const fromB = b.outbox.splice(0);
      fromA.forEach((message) => deliver(b, message));
      fromB.forEach((message) => deliver(a, message));
      roundTrips += 1;
    }

    expect(roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    expect(b.selection.matchId).toBe('m2');
    expect(b.selection.bestTrick).toBeUndefined();
    expect(a.selection.bestTrick).toBeUndefined();
  });

  it('a mid-try series reset survives the mirror whose clock still runs', () => {
    // The `fs series-reset` peer-mirroring leg. A clears the best-trick series
    // while B's own try clock is still running, so B's adoption REBUILDS
    // `clockRunning` and its re-push diverges permanently from the value it
    // adopted — an echo crossing A's follow-up, once per frame. The echo can
    // only tie A, and whether a tie outranked A's own authorship used to be the
    // coin flip: this leg is red in the order where B's id sorts higher.
    const running = { cap: 3, tries: { 1: 2, 2: 1 }, turn: 1, clockRunning: true } as const;
    const cleared = { cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: false } as const;
    const a = makePanel(idA);
    const b = makePanel(idB, (sel) => ({
      ...sel,
      bestTrick: sel.bestTrick ? { ...sel.bestTrick, clockRunning: true } : undefined,
    }));
    wireSockets();
    a.selection = { ...selection, bestTrick: { ...running } };
    b.selection = { ...selection, bestTrick: { ...running } };
    mountPanel(a);
    mountPanel(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    localEdit(a, { bestTrick: { ...cleared } }); // Reset series
    a.outbox.splice(0).forEach((message) => deliver(b, message)); // B mirrors, diverges, echoes
    localEdit(a, { bestTrick: { ...cleared, turn: 2 } }); // A's follow-up, same round trip

    const MAX_ROUND_TRIPS = 4;
    let roundTrips = 0;
    while (a.outbox.length + b.outbox.length > 0 && roundTrips <= MAX_ROUND_TRIPS) {
      const fromA = a.outbox.splice(0);
      const fromB = b.outbox.splice(0);
      fromA.forEach((message) => deliver(b, message));
      fromB.forEach((message) => deliver(a, message));
      roundTrips += 1;
    }

    expect(roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    // The tally the operator produced stands on the panel that produced it...
    expect(a.selection.bestTrick).toEqual({ ...cleared, turn: 2 });
    // ...and reaches the mirror, which keeps only its own clock flag.
    expect(b.selection.bestTrick).toMatchObject({ tries: { 1: 0, 2: 0 }, turn: 2 });
  });

  it('an edit colliding with a peer frame that moves nothing still reaches the room', () => {
    // The lost-edit end of the commit window, and why the forward has to be
    // causal rather than one-shot: the peer frame the edit collides with moves
    // NOTHING here (a re-push of a value this panel already holds, dropped by
    // the LWW stamp), so no adoption follows to re-push the edit under its own
    // authority. Sent as a re-statement, the edit loses the tie against the
    // panel that authored the stamp — and is gone for good.
    const a = makePanel(idA);
    const b = makePanel(idB);
    wireSockets();
    mountPanel(a);
    mountPanel(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    localEdit(a, { round: 'quarter' });
    const [fromA] = a.outbox.splice(0);
    deliver(b, fromA);
    a.outbox.length = 0;
    b.outbox.length = 0;

    // A distinct frame carrying the value B already holds — the relay's
    // overlay-follow re-push, or a request_state answer.
    collide(b, { gender: 'female' }, { ...fromA });

    const MAX_ROUND_TRIPS = 3;
    let roundTrips = 0;
    while (a.outbox.length + b.outbox.length > 0 && roundTrips <= MAX_ROUND_TRIPS) {
      const fromAOut = a.outbox.splice(0);
      const fromBOut = b.outbox.splice(0);
      fromAOut.forEach((message) => deliver(b, message));
      fromBOut.forEach((message) => deliver(a, message));
      roundTrips += 1;
    }

    expect(roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    expect(b.selection.gender).toBe('female');
    expect(a.selection.gender).toBe('female');
  });

  it('a single edit against a quiet peer settles without an endless echo', () => {
    const a = makePanel(idA);
    const b = makePanel(idB);
    wireSockets();
    mountPanel(a);
    mountPanel(b);
    a.outbox.length = 0;
    b.outbox.length = 0;

    localEdit(a, { round: 'quarter' });

    const MAX_ROUND_TRIPS = 3;
    let roundTrips = 0;
    while (a.outbox.length + b.outbox.length > 0 && roundTrips <= MAX_ROUND_TRIPS) {
      const fromA = a.outbox.splice(0);
      const fromB = b.outbox.splice(0);
      fromA.forEach((message) => deliver(b, message));
      fromB.forEach((message) => deliver(a, message));
      roundTrips += 1;
    }

    expect(a.outbox.length + b.outbox.length).toBe(0);
    expect(roundTrips).toBeLessThanOrEqual(MAX_ROUND_TRIPS);
    expect(a.selection.round).toBe('quarter');
    expect(b.selection.round).toBe('quarter');
  });
});

describe('useControlSession peer presence (FREESTYLE_BOARD_UX §3/§4.10)', () => {
  /** Deliver an incoming peer message and rerender so the hook sees it. */
  const deliver = (rerender: () => void, message: unknown) => {
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: message };
    configureSocket();
    rerender();
  };

  const reopen = (rerender: () => void) => {
    socketState = { readyState: ReadyState.CLOSED, lastJsonMessage: null };
    configureSocket();
    rerender();
    socketState = { readyState: ReadyState.OPEN, lastJsonMessage: null };
    configureSocket();
    rerender();
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for an answer, then reports the panel alone (the relay has no presence)', () => {
    const { result } = renderHook(() => useControlSession(baseParams()));
    expect(result.current.peerState).toBe('awaiting');

    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(result.current.peerState).toBe('alone');
  });

  it('reports answered on a peer snapshot and stays answered past the grace', () => {
    // The distinction the header owes (rubric C09): OPEN-with-no-peer must not
    // read the same as OPEN-with-a-mirrored-board.
    const { result, rerender } = renderHook(() =>
      useControlSession({ ...baseParams(), applySnapshot: () => true }),
    );

    deliver(rerender, {
      type: 'state_snapshot',
      senderId: 'peer-panel',
      data: { isPreviewEnabled: true, signalPhase: 0, text: '', timers: [] },
    });
    expect(result.current.peerState).toBe('answered');

    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));
    expect(result.current.peerState).toBe('answered');
  });

  it('reports answered on a peer selection, even one the LWW stamp drops', () => {
    // Presence, not hydration: a peer that lost the last-writer tiebreak is
    // still a peer, and the operator needs to know a second panel is acting.
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));

    deliver(rerender, {
      type: 'updateSelection',
      senderId: 'peer-panel',
      seq: -1,
      data: selection,
    });

    expect(result.current.peerState).toBe('answered');
  });

  it('re-asks on a reconnect (the room may have emptied while the link was down)', () => {
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));
    deliver(rerender, { type: 'updateSelection', senderId: 'peer-panel', data: selection });
    expect(result.current.peerState).toBe('answered');

    reopen(rerender);

    expect(result.current.peerState).toBe('awaiting');
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));
    expect(result.current.peerState).toBe('alone');
  });

  it('mints a peer-event token per mirrored message, naming the lane a timer addressed', () => {
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));
    expect(result.current.lastPeerEvent).toBeNull();

    deliver(rerender, {
      type: 'start_countdown',
      senderId: 'peer-panel',
      timerId: 2,
      data: { remainingMs: 90_000, startedAt: 1000 },
    });
    const started = result.current.lastPeerEvent;
    expect(started).toMatchObject({ kind: 'timer', timerId: 2 });

    deliver(rerender, { type: 'updateSelection', senderId: 'peer-panel', data: selection });
    expect(result.current.lastPeerEvent).toMatchObject({ kind: 'selection', timerId: null });
    // A monotonic token, so a consumer's 2 s cue re-fires on a repeat of the
    // same peer action rather than sitting on a stale equal value.
    expect(result.current.lastPeerEvent?.seq).toBeGreaterThan(started?.seq ?? 0);
  });

  it('mints no token for a peer request_state (a joiner asking is not a board change)', () => {
    const { result, rerender } = renderHook(() => useControlSession(baseParams()));

    deliver(rerender, { type: 'request_state', senderId: 'peer-panel', data: {} });

    expect(result.current.lastPeerEvent).toBeNull();
  });
});

describe('useControlSession self-snapshot (solo panel recovery)', () => {
  /** A live Speedline-shaped snapshot the panel would answer request_state with. */
  const runningTimers = [{ timerId: 1, startTime: 1_000, stopTime: null }];
  let timers: { timerId: number; startTime: number | null; stopTime: number | null }[];

  const selfParams = (
    overrides: {
      applySnapshot?: (snapshot: SpeedlineSnapshot | CountdownSnapshot) => boolean;
      applySelection?: (selection: LiveSelection) => void;
    } = {},
  ) => ({
    ...baseParams(),
    buildSnapshot: (
      isPreviewEnabled: boolean,
    ): DistributiveOmit<StopwatchWSMessage, 'sessionId'> => ({
      type: 'state_snapshot',
      data: { isPreviewEnabled, at: Date.now(), signalPhase: 0, text: '', timers },
    }),
    ...overrides,
  });

  const sendStart = (send: (message: DistributiveOmit<StopwatchWSMessage, 'sessionId'>) => void) =>
    act(() => send({ type: 'start', data: { startTime: 1_000, lanes: [1, 2] } }));

  const stored = () => readSelfSnapshot('comp-1', 'freestyle', Date.now());

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    timers = runningTimers;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('persists this panel’s own snapshot and selection after a live timer send', () => {
    const { result } = renderHook(() => useControlSession(selfParams()));

    sendStart(result.current.sendWSMessage);
    act(() => vi.advanceTimersByTime(SELF_SAVE_DELAY_MS));

    expect(stored()).toMatchObject({
      snapshot: { timers: runningTimers },
      selection,
    });
  });

  it('drops the stored record once the board holds no run (the reset/void clear)', () => {
    const { result } = renderHook(() => useControlSession(selfParams()));
    sendStart(result.current.sendWSMessage);
    act(() => vi.advanceTimersByTime(SELF_SAVE_DELAY_MS));
    expect(stored()).not.toBeNull();

    timers = [{ timerId: 1, startTime: null, stopTime: null }];
    act(() =>
      result.current.sendWSMessage({ type: 'reset', data: {} } as Parameters<
        typeof result.current.sendWSMessage
      >[0]),
    );
    act(() => vi.advanceTimersByTime(SELF_SAVE_DELAY_MS));

    expect(stored()).toBeNull();
  });

  it('recovers the stored run when no peer answers the mirror-on-open ask', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    const applySelection = vi.fn();
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection: { ...selection, round: 'quarter' },
    });

    const { result } = renderHook(() =>
      useControlSession(selfParams({ applySnapshot, applySelection })),
    );
    expect(applySnapshot).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySelection).toHaveBeenCalledWith({ ...selection, round: 'quarter' });
    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({ timers }));
    expect(result.current.selfRecovered).toBe(true);
  });

  it('leaves the stored copy alone when a peer answers within the grace (live beats it)', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection,
    });

    const { result, rerender } = renderHook(() => useControlSession(selfParams({ applySnapshot })));
    socketState = {
      readyState: ReadyState.OPEN,
      lastJsonMessage: {
        type: 'state_snapshot',
        senderId: 'peer-panel',
        data: { isPreviewEnabled: true, signalPhase: 0, text: '', timers: [] },
      },
    };
    configureSocket();
    rerender();
    expect(applySnapshot).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(result.current.selfRecovered).toBe(false);
  });

  it('ignores a stored copy older than the recovery bound', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now() - SELF_SNAPSHOT_MAX_AGE_MS - 1,
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection,
    });

    renderHook(() => useControlSession(selfParams({ applySnapshot })));
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('ignores a stored copy holding no run', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: {
        isPreviewEnabled: true,
        at: Date.now(),
        signalPhase: 0,
        text: '',
        timers: [{ timerId: 1, startTime: null, stopTime: null }],
      },
      selection,
    });

    renderHook(() => useControlSession(selfParams({ applySnapshot })));
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('does not recover into a board the operator has already moved since open', () => {
    // Setup is not a timer frame, so the live-frame gate cannot see it: an
    // operator re-arming a budget or picking athletes inside the peer grace must
    // still outrank a copy of an older run.
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection,
    });

    const { rerender } = renderHook(() => useControlSession(selfParams({ applySnapshot })));
    timers = [{ timerId: 1, startTime: null, stopTime: null }];
    rerender();
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('does not recover over a run this panel already drove since open', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection,
    });

    const { result } = renderHook(() => useControlSession(selfParams({ applySnapshot })));
    sendStart(result.current.sendWSMessage);
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('clears the recovered notice as soon as the operator acts again', () => {
    const applySnapshot = vi.fn().mockReturnValue(true);
    storeSelfSnapshot('comp-1', 'freestyle', {
      at: Date.now(),
      snapshot: { isPreviewEnabled: true, at: Date.now(), signalPhase: 0, text: '', timers },
      selection,
    });

    const { result } = renderHook(() => useControlSession(selfParams({ applySnapshot })));
    act(() => vi.advanceTimersByTime(PEER_ANSWER_MS));
    expect(result.current.selfRecovered).toBe(true);

    sendStart(result.current.sendWSMessage);

    expect(result.current.selfRecovered).toBe(false);
  });
});
