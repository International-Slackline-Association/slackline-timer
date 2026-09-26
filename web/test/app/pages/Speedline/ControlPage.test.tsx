import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';

import { px } from '../../../util/computedUnits';
import {
  COMPACT_HEIGHT_PX,
  COMPACT_PX,
  DESK_HEIGHT_PX,
  DESK_MIN_PX,
  pinLayoutWidth,
} from '../../../util/deskGeometry';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

// The page's single relay socket (ADR 0043). `receiverMessage` is the incoming
// peer message a rerender delivers.
const { sockets } = vi.hoisted(() => ({
  sockets: {
    senderSend: vi.fn(),
    receiverMessage: null as StopwatchWSMessage | null,
  },
}));
vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  return {
    ...actual,
    useWS: () => ({
      sendWSMessage: sockets.senderSend,
      readyState: 1,
      lastJsonMessage: sockets.receiverMessage,
      senderId: 'own-sender-id',
    }),
  };
});

// The handset, as the page sees it: one press token per press, so pressing the
// same button twice still fires (the `seq` the real hook mints).
const { gamepad } = vi.hoisted(() => ({
  gamepad: { press: undefined as { button: number; seq: number } | undefined, seq: 0 },
}));
vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton: gamepad.press }),
}));
// The pad registry the handset card reads for presence; the press itself comes
// through the `useGamepads` mock above.
vi.mock('app/state/gamepadSelection', () => ({
  useGamepadSelection: () => ({
    connectedPads: [],
    selectedPadId: null,
    setSelectedPadId: vi.fn(),
    selectedIndex: undefined,
  }),
}));
const { playAudioMock, audio } = vi.hoisted(() => ({
  playAudioMock: vi.fn(),
  audio: { blocked: false },
}));
vi.mock('app/hooks/useSignalAudio', () => ({
  useSignalAudio: () => ({
    audioElement: null,
    playAudio: playAudioMock,
    audioBlocked: audio.blocked,
  }),
}));
vi.mock('app/state/selectedCompetition', () => ({
  useSelectedCompetition: () => ({ compId: 'c1' }),
}));

import { SpeedlineControlPage } from 'app/pages/Speedline/ControlPage';

import { ATHLETES } from './recorderStub';

const pageTree = () => (
  <MemoryRouter>
    <SpeedlineControlPage />
  </MemoryRouter>
);

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={queryClient}>{pageTree()}</QueryClientProvider>,
  );
  const refresh = () =>
    rendered.rerender(<QueryClientProvider client={queryClient}>{pageTree()}</QueryClientProvider>);
  const deliver = (message: StopwatchWSMessage) => {
    act(() => {
      sockets.receiverMessage = message;
      refresh();
    });
  };
  /** A physical handset press (doc/dev/buzzer-hardware.md indices). */
  const pressPad = (button: number) => {
    act(() => {
      gamepad.seq += 1;
      gamepad.press = { button, seq: gamepad.seq };
      refresh();
    });
  };
  return { ...rendered, deliver, pressPad };
};

const startButton = () => screen.getByRole('button', { name: 'Start' });
const stopButton = (lane: 1 | 2) => screen.getByRole('button', { name: `Stop Lane ${lane}` });
const stopButtons = () => [stopButton(1), stopButton(2)];
const abortButton = () => screen.getByRole('button', { name: 'Abort Start' });
const resetButton = () => screen.getByRole('button', { name: 'Reset' });
const fsButton = (lane: 1 | 2) =>
  screen.getByRole('button', { name: `False start · Lane ${lane}` });

/** apiFetch calls that would write to the data plane (Time POST / Match PUT…). */
const writeCalls = () =>
  (apiFetchMock.mock.calls as [string, { method?: string } | undefined][]).filter(
    ([, opts]) => (opts?.method ?? 'GET') !== 'GET',
  );

describe('SpeedlineControlPage peer mirroring (ADR 0038)', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    // Reads resolve empty; any write would be caught by writeCalls().
    apiFetchMock.mockReset().mockResolvedValue([]);
  });

  describe('schedule-anchored start', () => {
    it('anchors the broadcast start on the scheduled GO epoch (anchor + 5000)', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(2_000_000);
        renderPage();
        fireEvent.click(startButton());
        // reset, sequence opens at +300ms, GO fires at anchor +5s.
        act(() => vi.advanceTimersByTime(5300));

        const startSend = (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
          .map(([m]) => m)
          .find((m): m is Extract<StopwatchWSMessage, { type: 'start' }> => m.type === 'start');
        // The clock anchors on the SCHEDULE (anchor 2_000_300 + GO offset 5000),
        // the same epoch the green light and long beep derive from — light,
        // beep and stopwatch leave together on every surface.
        expect(startSend?.data.startTime).toBe(2_005_300);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('applies a peer start/stop into the lane timers without any data-plane write', () => {
    const { deliver } = renderPage();
    expect(startButton()).toBeEnabled();
    for (const stop of stopButtons()) expect(stop).toBeDisabled();

    // A race started on ANOTHER panel: this panel's buttons must tell the truth.
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });
    expect(startButton()).toBeDisabled();
    for (const stop of stopButtons()) expect(stop).toBeEnabled();

    // The peer stops lane 1: the lane freezes here; lane 2 keeps running.
    deliver({
      type: 'stop',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { timerId: 1, stopTime: Date.now() },
    });
    expect(stopButton(1)).toBeDisabled();
    expect(stopButton(2)).toBeEnabled();

    // Writes bind to local operator actions: peer-applied events never POST a
    // Time or PUT a Match from this panel.
    expect(writeCalls()).toHaveLength(0);
  });

  it('re-arms after a peer reset', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });
    expect(startButton()).toBeDisabled();

    deliver({ type: 'reset', sessionId: 'c1', senderId: 'peer-panel', data: {} });

    expect(startButton()).toBeEnabled();
    for (const stop of stopButtons()) expect(stop).toBeDisabled();
    expect(writeCalls()).toHaveLength(0);
  });

  it('mirrors a peer signal phase into the lights and button gating', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const { deliver } = renderPage();

      // The peer's seed arms its light sequence here (derived locally off the
      // anchor): Start must gate while the mirror runs.
      deliver({
        type: 'updateSignalPhase',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: { currentPhase: PRE_BEEP_PHASE, anchorEpoch: 1_000_000, lanes: [1, 2] },
      });
      act(() => vi.advanceTimersByTime(4000)); // through set2, mid-sequence
      expect(startButton()).toBeDisabled();

      // The peer aborts (phase -1): Start stays gated until a reset re-arms it.
      deliver({
        type: 'updateSignalPhase',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: { currentPhase: -1 },
      });
      expect(startButton()).toBeDisabled();

      deliver({ type: 'reset', sessionId: 'c1', senderId: 'peer-panel', data: {} });
      expect(startButton()).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  // The other half of that rule, and the one the operator reaches for: the panel
  // that did NOT abort clears the board from its own Reset. Without it this
  // panel's Start stays dead until someone resets the OTHER one — which is where
  // the `peer-mirroring` driver leg stranded panel A.
  it('clears a mirrored abort latch on its own Reset', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'updateSignalPhase',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { currentPhase: -1 },
    });
    expect(startButton()).toBeDisabled();

    fireEvent.click(resetButton());

    expect(startButton()).toBeEnabled();
  });

  describe('solo start (quali: exactly one athlete selected)', () => {
    it('starts only the assigned lane and broadcasts the ignited lanes', () => {
      vi.useFakeTimers();
      try {
        const { deliver } = renderPage();
        // Mirror a peer selection assigning lane 1 only — the quali pattern.
        deliver({
          type: 'updateSelection',
          sessionId: 'c1',
          senderId: 'peer-panel',
          data: {
            discipline: 'speed',
            round: 'qualification',
            gender: 'male',
            matchId: null,
            athlete1Id: 'a1',
            athlete2Id: null,
          },
        });

        fireEvent.click(startButton());
        // Start resets, opens the sequence 300ms later, GO fires at T+5s.
        act(() => vi.advanceTimersByTime(5300));

        const startSend = (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
          .map(([m]) => m)
          .find((m): m is Extract<StopwatchWSMessage, { type: 'start' }> => m.type === 'start');
        expect(startSend?.data.lanes).toEqual([1]);

        // Lane 1 runs; lane 2 stays dormant, so its Stop never arms.
        expect(stopButton(1)).toBeEnabled();
        expect(stopButton(2)).toBeDisabled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies a peer solo start to only its listed lane', () => {
      const { deliver } = renderPage();
      deliver({
        type: 'start',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: { startTime: Date.now() - 1000, lanes: [2] },
      });

      expect(startButton()).toBeDisabled();
      expect(stopButton(1)).toBeDisabled();
      expect(stopButton(2)).toBeEnabled();
      expect(writeCalls()).toHaveLength(0);
    });
  });

  describe('peer light-sequence audio', () => {
    const seed = (anchorEpoch: number): StopwatchWSMessage => ({
      type: 'updateSignalPhase',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { currentPhase: PRE_BEEP_PHASE, anchorEpoch, lanes: [1, 2] },
    });

    it('stays silent on a peer abort/reset echo (no beep phase)', () => {
      const { deliver } = renderPage();
      const echo = (currentPhase: number): StopwatchWSMessage => ({
        type: 'updateSignalPhase',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: { currentPhase },
      });

      deliver(echo(-1)); // abort echo
      deliver(echo(0)); // reset echo
      expect(playAudioMock).not.toHaveBeenCalled();
    });

    it('sounds the abort alert when a peer aborts the start', () => {
      const { deliver } = renderPage();

      deliver({
        type: 'updateText',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: { text: 'START ABORTED' },
      });
      expect(playAudioMock).toHaveBeenCalledWith('alert');
    });

    it('does not let a concurrent peer seed beep over the LOCAL sequence', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000_000);
        const { deliver } = renderPage();

        fireEvent.click(startButton());
        act(() => vi.advanceTimersByTime(300)); // local pre-beep
        expect(playAudioMock.mock.calls).toEqual([['short']]);

        // A peer seed arriving while the LOCAL sequence drives must not sound
        // its own pre-beep on top (the mirror-beep is gated on no local run).
        deliver(seed(1_000_300));
        expect(playAudioMock.mock.calls).toEqual([['short']]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('anchor-derived start signal (seed-only protocol)', () => {
    const signalSends = () =>
      (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
        .map(([m]) => m)
        .filter(
          (m): m is Extract<StopwatchWSMessage, { type: 'updateSignalPhase' }> =>
            m.type === 'updateSignalPhase',
        );

    it('broadcasts ONLY the seed (armed + anchor + lanes), never per-phase set1/set2/GO', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000_000);
        renderPage();
        fireEvent.click(startButton());
        // Run the whole sequence in steps so each phase transition is its own
        // render (a single collapsed advance would batch them, hiding whether
        // set1/set2/GO emit): arm at +300, then set1/set2/GO/clear 1s apart.
        act(() => vi.advanceTimersByTime(300));
        act(() => vi.advanceTimersByTime(3000));
        act(() => vi.advanceTimersByTime(1000));
        act(() => vi.advanceTimersByTime(1000));
        act(() => vi.advanceTimersByTime(1000));

        const sends = signalSends();
        expect(sends).toHaveLength(1);
        expect(sends[0].data.currentPhase).toBe(PRE_BEEP_PHASE);
        // Anchor = the epoch the sequence armed (click + the 300ms open delay).
        expect(sends[0].data.anchorEpoch).toBe(1_000_300);
        // The seed carries the lanes GO will ignite (no athletes → both), so a
        // receiver can start the lane clocks at its locally-derived GO edge.
        expect(sends[0].data.lanes).toEqual([1, 2]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('broadcasts an explicit cancel (-1) on abort so receivers stop their mirror', () => {
      vi.useFakeTimers();
      try {
        renderPage();
        fireEvent.click(startButton());
        act(() => vi.advanceTimersByTime(300)); // armed — Abort is now live
        fireEvent.click(screen.getByRole('button', { name: 'Abort Start' }));

        expect(signalSends().map((m) => m.data.currentPhase)).toEqual([PRE_BEEP_PHASE, -1]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('runs a mirrored peer sequence off the seed anchor, beeping on local timers', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000_000);
        const { deliver } = renderPage();

        // Seed only: armed now, anchor now. set1/set2/GO are NOT sent — the panel
        // derives them locally off the anchor.
        deliver({
          type: 'updateSignalPhase',
          sessionId: 'c1',
          senderId: 'peer-panel',
          data: { currentPhase: PRE_BEEP_PHASE, anchorEpoch: 1_000_000 },
        });
        expect(playAudioMock.mock.calls).toEqual([['short']]); // pre-beep, live
        expect(startButton()).toBeDisabled(); // gated while the mirror runs

        act(() => vi.advanceTimersByTime(3000)); // set1
        act(() => vi.advanceTimersByTime(1000)); // set2
        act(() => vi.advanceTimersByTime(1000)); // GO
        expect(playAudioMock.mock.calls).toEqual([['short'], ['short'], ['short'], ['long']]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// The Speedline console shares the Freestyle board's health slot: one dialect
// across the two desks (FREESTYLE_BOARD_UX §2, the P3 sibling note).
describe('SpeedlineControlPage health chips', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    apiFetchMock.mockReset().mockResolvedValue([]);
    audio.blocked = false;
  });

  it('shows AUDIO LOCKED while the browser still blocks the start beeps', () => {
    // The start-light sequence IS audio here — a silent console mistimes a race.
    audio.blocked = true;
    renderPage();

    expect(screen.getByText('AUDIO LOCKED — click anywhere')).toBeInTheDocument();
  });

  it('reports the audio armed once a gesture has unblocked it', () => {
    renderPage();

    expect(screen.getByText('Audio armed')).toBeInTheDocument();
  });
});

// The live-path control contract the Freestyle board taught the operator
// (FREESTYLE_BOARD_UX §6 + the §7 P3 sibling note): one dialect across both
// desks, so a hand trained on one finds Start/Stop/Reset on the other.
describe('SpeedlineControlPage live-control contract (FREESTYLE_BOARD_UX §6)', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    apiFetchMock.mockReset().mockResolvedValue([]);
    audio.blocked = false;
  });

  const minHeight = (control: HTMLElement): number =>
    px(window.getComputedStyle(control).minHeight);

  it('sizes the race pair at 56 px and every other live control at 44', () => {
    renderPage();

    for (const race of [startButton(), abortButton(), stopButton(1), stopButton(2)]) {
      expect(minHeight(race)).toBeGreaterThanOrEqual(56);
    }
    for (const aux of [resetButton(), fsButton(1), fsButton(2)]) {
      expect(minHeight(aux)).toBeGreaterThanOrEqual(44);
    }
  });

  it('paints Start contained and Reset neutral-outlined', () => {
    renderPage();

    expect(startButton()).toHaveClass('MuiButton-contained');
    expect(resetButton()).toHaveClass('MuiButton-outlined');
  });

  it('offsets Reset behind a dashed divider rather than flush under Abort', () => {
    renderPage();

    // Reset rides a `LockedControl` span, so the divider is its row's, not its
    // immediate parent's.
    const row = resetButton().closest('.MuiStack-root') as HTMLElement;
    const divider = row.querySelector('.MuiDivider-root');
    expect(divider).not.toBeNull();
    expect(window.getComputedStyle(divider as Element).borderTopStyle).toBe('dashed');
  });

  it('leaves the keyboard where it found it after a mouse press', async () => {
    const user = userEvent.setup();
    renderPage();

    // A control that keeps focus after a click answers the operator's next
    // Space/Enter with a second press of itself — on a race board that is a
    // re-Start, so a mouse press leaves the keyboard where it found it.
    await user.click(fsButton(1));

    expect(document.activeElement).toBe(document.body);
  });

  it('renders the peer slot the Freestyle header carries', () => {
    renderPage();

    expect(screen.getByText('peer: awaiting')).toBeInTheDocument();
  });

  // The projector slot is the same object on both desks (`PreviewControls`):
  // the switch is named by the word beside it and the state is a word, where
  // this board used to hang an unnamed switch off an `Enabled`/`Disabled`
  // caption of its own.
  it('carries the shared preview slot, named and stated', () => {
    renderPage();

    const toggle = screen.getByRole('switch', { name: 'Preview' });
    expect(toggle).toBeChecked();
    expect(screen.getByText('ON')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preview' })).toHaveAttribute(
      'href',
      '/speedline/preview?sessionId=c1',
    );
  });
});

// C06 on the second desk: a dead control says what it is waiting for, printed
// on the board rather than left to the operator to guess (FREESTYLE_BOARD_UX
// §4.7 + §7's P3 sibling note).
describe('SpeedlineControlPage lock why-lines (FREESTYLE_BOARD_UX §4.7)', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    apiFetchMock.mockReset().mockResolvedValue([]);
    audio.blocked = false;
  });

  it('says why Abort is dead on a resting board', () => {
    renderPage();

    expect(abortButton()).toBeDisabled();
    expect(screen.getByText('why: no start sequence to abort')).toBeInTheDocument();
  });

  it('names the running lane while the clocks are away', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });

    expect(screen.getAllByText('why: locked while a lane runs')).not.toHaveLength(0);
  });

  // The rail's swap is interlocked by the race like any lane button, so it
  // reads the same map and prints in the same slot — it used to go dark on a
  // boolean of the page's own, in the one place the manual sends an operator
  // who has the athletes on the wrong sides.
  it('says why the lane swap is dead while a run is live', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });

    const swap = screen.getByRole('button', { name: /swap lanes/i });
    expect(swap).toBeDisabled();
    expect(within(swap.parentElement as HTMLElement).getByTestId('why-line')).toHaveTextContent(
      'why: locked while a lane runs',
    );
  });

  /**
   * `speedline-lock-says-aborted-after-a-clean-run`: the schedule's terminal
   * phase and the abort latch are the SAME wire value (-1), so the board used to
   * blame a start abort after every clean run. The two endings now read as what
   * they are — both still waiting on the same Reset.
   */
  it('words a clean, finished sequence as spent — never as an abort', () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.click(startButton());
      // Reset, sequence opens at +300, GO at +5300, cleared at +6300.
      act(() => vi.advanceTimersByTime(6300));
      // Both lanes home: nothing is running, so the terminal phase is the only
      // thing still holding Start.
      fireEvent.click(stopButton(1));
      fireEvent.click(stopButton(2));

      expect(startButton()).toBeDisabled();
      expect(screen.getByText('why: sequence finished — Reset to re-arm')).toBeInTheDocument();
      expect(screen.queryByText('why: start aborted — Reset to re-arm')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // The one lock with no clock behind it: after an abort the board looks idle
  // and Start is dead, which reads as a broken console until it says otherwise.
  it('explains the dead Start after an abort', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'updateSignalPhase',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { currentPhase: -1 },
    });

    expect(startButton()).toBeDisabled();
    expect(screen.getByText('why: start aborted — Reset to re-arm')).toBeInTheDocument();
  });
});

// §4.8 on the second desk: while a question stands it owns the board, and the
// handset — the one path that reaches the transport from behind a modal
// backdrop — waits with everything else.
describe('SpeedlineControlPage handset behind a question (FREESTYLE_BOARD_UX §4.8)', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    apiFetchMock.mockReset().mockResolvedValue([]);
    audio.blocked = false;
  });

  const stopSends = () =>
    (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
      .map(([m]) => m)
      .filter((m) => m.type === 'stop');

  const startRace = (deliver: (message: StopwatchWSMessage) => void) =>
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });

  it('stops a lane from the handset while nothing is asking', () => {
    const { deliver, pressPad } = renderPage();
    startRace(deliver);

    pressPad(10);

    expect(stopSends()).toHaveLength(1);
  });

  it('waits while the Reset question stands, then stops once it is answered', async () => {
    const user = userEvent.setup();
    const { deliver, pressPad } = renderPage();
    startRace(deliver);

    // Handset 1's yellow asks before wiping a live run (resetGuard).
    pressPad(1);
    expect(screen.getByText('Reset this run?')).toBeInTheDocument();

    // A stray lane press from behind the backdrop must not reach the transport:
    // the operator cannot see the board it would act on.
    pressPad(10);
    expect(stopSends()).toHaveLength(0);

    // ...and the lane it would have stopped is still running once the question
    // is out of the way, so the press was refused, not swallowed.
    await user.click(screen.getByRole('button', { name: 'Keep timing' }));
    await waitForElementToBeRemoved(() => screen.queryByText('Reset this run?'));
    expect(stopButton(1)).toBeEnabled();

    pressPad(10);
    expect(stopSends()).toHaveLength(1);
  });
});

/**
 * The desk (`speedline-desk-layout`): the lane's athlete and its Saved chip
 * stand IN the lane column beside that lane's clock, and the cross-lane rail
 * sits to the side — not in a panel under the whole board.
 */
describe('SpeedlineControlPage desk', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    apiFetchMock.mockReset().mockResolvedValue([]);
  });

  it('puts each lane’s recording controls in that lane’s own column', () => {
    renderPage();

    const live = screen.getByTestId('desk-live');
    for (const lane of [1, 2] as const) {
      expect(within(live).getByLabelText(`Lane ${lane} athlete`)).toBeInTheDocument();
      expect(within(live).getByRole('button', { name: `Stop Lane ${lane}` })).toBeInTheDocument();
      expect(
        within(live).getByRole('button', { name: `False start · Lane ${lane}` }),
      ).toBeInTheDocument();
      expect(within(live).getByRole('button', { name: `Lane ${lane} DNF` })).toBeInTheDocument();
    }
    // The cross-lane rail keeps the selection context and the destructive undo.
    const rail = screen.getByRole('region', { name: 'Result recording' });
    expect(within(rail).getByLabelText('Match (speed)')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Swap lanes' })).toBeInTheDocument();
  });

  /**
   * `speedline-locked-control-parity`: the board printed its lock reasons in the
   * why-lines and nowhere else, so a reader pointed at a dead control was told
   * only that it was dead. Each press now carries the SAME sentence as its
   * accessible description — one map, three surfaces.
   */
  it('gives every locked race control its reason as an accessible description', () => {
    renderPage();

    // A resting board: Abort has no sequence to stop and neither lane is away.
    expect(abortButton()).toHaveAccessibleDescription('no start sequence to abort');
    expect(stopButton(1)).toHaveAccessibleDescription('Lane 1 is not running');
    expect(stopButton(2)).toHaveAccessibleDescription('Lane 2 is not running');
    // A live control describes nothing — there is no reason to give.
    expect(startButton()).toHaveAccessibleDescription('');
  });

  it('describes the lock the printed why-line names, in the same words', () => {
    const { deliver } = renderPage();
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now(), lanes: [1, 2] },
    });

    expect(startButton()).toHaveAccessibleDescription('locked while a lane runs');
    // The two surfaces the run holds: the race pair's reserved line and the
    // rail's Swap — one map, so both print the sentence the button describes.
    expect(screen.getAllByText('why: locked while a lane runs')).toHaveLength(2);
  });

  /**
   * `speedline-handset-card`: the button map used to be checkable only by
   * opening the reference sheet — which owns the board while it stands, so the
   * check cost the presses being checked. The card reports the last press
   * inline instead, in the same words the interlock table gives the buttons.
   */
  it('reports the last handset press inline, verdict included', () => {
    const { pressPad } = renderPage();
    expect(screen.getByTestId('handset-readout')).toHaveTextContent('last: —');

    pressPad(10);

    expect(screen.getByTestId('handset-readout')).toHaveTextContent(
      'handset 3 · red → locked: Lane 1 is not running (0:00 ago)',
    );
  });

  it('names an unbound key rather than going silent on it', () => {
    const { pressPad } = renderPage();

    pressPad(4);

    expect(screen.getByTestId('handset-readout')).toHaveTextContent('nothing on this board');
  });
});

/**
 * `speedline-compact-setup-strip`: below the desk gate the three columns stack,
 * and desk-left went first as a full column — the Preview switch over a ~220 px
 * handset card — which at 1024x768 pushed `False start` (bottom 789) and `DNF`
 * (839) under the fold, against both the responsive contract ("setup chrome
 * collapses before the live path") and the manual's promise that the clocks
 * come first. The order stays (setup -> race -> rail, nothing moves between
 * widths); what changes is that setup collapses to ONE wrapping row there.
 *
 * The card owns a gamepad listener and a once-a-second ticker, so the variant is
 * ONE render chosen by the same `(min-width:1280px)` the desk grid gates on —
 * never both behind a CSS display toggle.
 */
describe('SpeedlineControlPage setup strip', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    apiFetchMock.mockReset().mockResolvedValue([]);
  });

  it('collapses setup to one wrapping row below the desk gate', () => {
    pinLayoutWidth(COMPACT_PX, COMPACT_HEIGHT_PX);
    renderPage();

    const left = screen.getByTestId('desk-left');
    const style = window.getComputedStyle(left);
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap).toBe('wrap');

    expect(screen.getByTestId('handset-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('handset-card')).not.toBeInTheDocument();
  });

  it('keeps every setup control reachable in the strip, and the readout single', () => {
    pinLayoutWidth(COMPACT_PX, COMPACT_HEIGHT_PX);
    const { pressPad } = renderPage();

    expect(screen.getByRole('switch', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open handset map/i })).toBeInTheDocument();

    // One mount, so one pad listener and one ticker — and one line to read.
    pressPad(10);
    expect(screen.getAllByTestId('handset-readout')).toHaveLength(1);
    expect(screen.getByTestId('handset-readout')).toHaveTextContent(
      'handset 3 · red → locked: Lane 1 is not running',
    );
  });

  it('keeps the full card, in a column, once the desk gate is met', () => {
    pinLayoutWidth(DESK_MIN_PX, DESK_HEIGHT_PX);
    renderPage();

    const left = screen.getByTestId('desk-left');
    expect(window.getComputedStyle(left).flexDirection).toBe('column');
    expect(screen.getByTestId('handset-card')).toBeInTheDocument();
    expect(screen.queryByTestId('handset-strip')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('handset-readout')).toHaveLength(1);
  });
});

/**
 * `speedline-resume-stopped-lane`: a mis-pressed Stop froze a lane and POSTed
 * its Time while the athlete was still crossing, and the only way back was Void
 * (which discards BOTH lanes). The lane clock is epoch-anchored, so the undo is
 * exact — drop the stop, keep the GO epoch, and the clock continues.
 */
describe('SpeedlineControlPage lane resume', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    apiFetchMock.mockReset().mockResolvedValue([]);
  });

  const resumeButton = (lane: 1 | 2) => screen.getByRole('button', { name: `Resume Lane ${lane}` });

  const sends = <T extends StopwatchWSMessage['type']>(type: T) =>
    (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
      .map(([m]) => m)
      .filter((m): m is Extract<StopwatchWSMessage, { type: T }> => m.type === type);

  const startRace = (deliver: (message: StopwatchWSMessage) => void) =>
    deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });

  // A reserved slot, not a control that appears on the stop
  // (`speedline-lane-post-stop-layout-shift`) — so it says why it is dead
  // instead of vanishing, and nothing under it moves when a lane freezes.
  it('stands in every state, live only for a lane that has actually stopped', () => {
    const { deliver } = renderPage();
    expect(resumeButton(1)).toBeDisabled();
    expect(resumeButton(1)).toHaveAccessibleDescription('Lane 1 is not stopped');

    startRace(deliver);
    expect(resumeButton(1)).toBeDisabled();

    fireEvent.click(stopButton(1));
    expect(resumeButton(1)).toBeEnabled();
    // The lane still away has nothing to resume.
    expect(resumeButton(2)).toBeDisabled();
    expect(resumeButton(2)).toHaveAccessibleDescription('Lane 2 is not stopped');
  });

  it('un-freezes the lane on the same GO epoch and tells the room', () => {
    const { deliver } = renderPage();
    startRace(deliver);
    fireEvent.click(stopButton(1));
    expect(stopButton(1)).toBeDisabled();

    fireEvent.click(resumeButton(1));

    expect(sends('resume').map((m) => m.data)).toEqual([{ timerId: 1 }]);
    // The lane is running again — Stop is live and there is nothing left to
    // resume. No second `start` is sent: that would re-ignite BOTH lanes and
    // move the GO epoch every surface anchors on.
    expect(stopButton(1)).toBeEnabled();
    expect(resumeButton(1)).toBeDisabled();
    expect(sends('start')).toHaveLength(0);
  });

  it('applies a peer resume without any data-plane write (ADR 0038)', () => {
    const { deliver } = renderPage();
    startRace(deliver);
    deliver({
      type: 'stop',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { timerId: 1, stopTime: Date.now() },
    });
    expect(stopButton(1)).toBeDisabled();

    deliver({
      type: 'resume',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { timerId: 1 },
    });

    expect(stopButton(1)).toBeEnabled();
    expect(writeCalls()).toHaveLength(0);
  });

  // The snapshot needs no new field: a resumed lane IS a running lane, so the
  // existing start/stop encoding carries it (`timerSnapshot.speedlineLaneState`).
  it('answers a mid-run request_state with the resumed lane running', () => {
    const { deliver } = renderPage();
    startRace(deliver);
    fireEvent.click(stopButton(1));
    fireEvent.click(resumeButton(1));

    deliver({ type: 'request_state', sessionId: 'c1', senderId: 'peer-panel', data: {} });

    const snapshot = sends('state_snapshot').at(-1)?.data;
    const lane1 = (
      snapshot as {
        timers: { timerId: number; startTime: number | null; stopTime: number | null }[];
      }
    ).timers.find((t) => t.timerId === 1);
    expect(lane1?.stopTime).toBeNull();
    expect(lane1?.startTime).not.toBeNull();
  });

  it('goes inert, with its reason, once the run has resolved', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3_000_000);
      const { deliver } = renderPage();
      startRace(deliver);
      fireEvent.click(stopButton(1));
      fireEvent.click(stopButton(2));
      // Both lanes home, still inside the grace: the mis-press is recoverable.
      expect(resumeButton(1)).toBeEnabled();

      act(() => vi.advanceTimersByTime(10_000));

      expect(resumeButton(1)).toBeDisabled();
      expect(resumeButton(1)).toHaveAccessibleDescription(
        'run has resolved — Void or re-run instead',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Screen-only by design: a lane judge's buzzer must never un-stop a lane.
  it('is not bound to the handset', () => {
    const { deliver, pressPad } = renderPage();
    startRace(deliver);
    fireEvent.click(stopButton(1));

    for (const button of [0, 1, 5, 10, 11, 15, 16]) pressPad(button);

    expect(sends('resume')).toHaveLength(0);
  });
});

/**
 * `speedline-dnf-corrects-and-freezes-the-lane`: a fall ends that lane's race,
 * so the DNF press is the stop as well — one press for one event, in either
 * order.
 */
describe('SpeedlineControlPage lane DNF', () => {
  beforeEach(() => {
    sockets.senderSend = vi.fn();
    sockets.receiverMessage = null;
    gamepad.press = undefined;
    playAudioMock.mockReset();
    // The DNF press needs an athlete on the lane — it is the one live control
    // gated on the recording selection rather than on the race.
    apiFetchMock
      .mockReset()
      .mockImplementation((path: string) =>
        Promise.resolve(path.includes('/athletes') ? ATHLETES : []),
      );
  });

  const dnfButton = (lane: 1 | 2) => screen.getByRole('button', { name: `Lane ${lane} DNF` });
  const resumeButton = (lane: 1 | 2) => screen.getByRole('button', { name: `Resume Lane ${lane}` });
  const sends = <T extends StopwatchWSMessage['type']>(type: T) =>
    (sockets.senderSend.mock.calls as [StopwatchWSMessage][])
      .map(([m]) => m)
      .filter((m): m is Extract<StopwatchWSMessage, { type: T }> => m.type === type);

  /** A page with lane 1 recording `a1` and a peer-started race running. */
  const racingPage = async () => {
    const page = renderPage();
    // The picker renders at once but holds only its placeholder until the
    // athletes land — setting a value it has no option for changes nothing.
    await screen.findAllByRole('option', { name: 'Jane Doe' });
    fireEvent.change(screen.getByLabelText(/lane 1 athlete/i), { target: { value: 'a1' } });
    page.deliver({
      type: 'start',
      sessionId: 'c1',
      senderId: 'peer-panel',
      data: { startTime: Date.now() - 1000, lanes: [1, 2] },
    });
    return page;
  };

  it('freezes the lane and tells the room when the fall comes first', async () => {
    await racingPage();
    expect(stopButton(1)).toBeEnabled();

    fireEvent.click(dnfButton(1));

    // The numeral stops at the fall everywhere: locally (Stop goes dead, Resume
    // comes alive) and on every peer/preview/overlay via the relayed frame.
    expect(sends('stop').map((m) => m.data.timerId)).toEqual([1]);
    expect(stopButton(1)).toBeDisabled();
    expect(resumeButton(1)).toBeEnabled();
    // The other lane is still racing — a fall is one lane's, never the run's.
    expect(stopButton(2)).toBeEnabled();
  });

  it('stops nothing extra when the lane was already stopped', async () => {
    await racingPage();
    fireEvent.click(stopButton(1));

    fireEvent.click(dnfButton(1));

    // One stop frame, from the Stop press — the DNF corrects the record, and
    // a second frame would move the frozen numeral to the moment of the press.
    expect(sends('stop')).toHaveLength(1);
  });
});
