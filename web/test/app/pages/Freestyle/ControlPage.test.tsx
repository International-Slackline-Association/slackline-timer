import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CountdownWSMessage, LiveSelection } from 'app/hooks/useWebSocket';
import { FreestyleControlPage } from 'app/pages/Freestyle/ControlPage';
import { GamepadSelectionProvider } from 'app/state/gamepadSelection';
import type { Athlete } from 'app/types';

import { px } from '../../../util/computedUnits';
import {
  COMPACT_HEIGHT_PX,
  COMPACT_PX,
  DECK_GAP_PX,
  DESK_GAP_PX,
  DESK_HEIGHT_PX,
  DESK_MIN_PX,
  LANE_COLUMN_PX,
  LIVE_COLUMN_PX,
  PAGE_PADDING_PX,
  SHORT_DESK_HEIGHT_PX,
  TALLISH_DESK_HEIGHT_PX,
  deskMediaValue,
  pinLayoutWidth,
  solveTracks,
} from '../../../util/deskGeometry';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

// The page's single relay socket (ADR 0043). `receiverMessage` is the incoming
// peer message a rerender delivers — the relay never fans a send back to its
// own connection, so everything here is peer traffic by construction.
const { sockets } = vi.hoisted(() => ({
  sockets: {
    senderSend: vi.fn(),
    receiverMessage: null as CountdownWSMessage | null,
    readyState: 1,
  },
}));
vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  return {
    ...actual,
    useWS: () => ({
      sendWSMessage: sockets.senderSend,
      readyState: sockets.readyState,
      lastJsonMessage: sockets.receiverMessage,
      senderId: 'own-sender-id',
    }),
  };
});

const { gamepad } = vi.hoisted(() => ({
  gamepad: { press: undefined as { button: number; seq: number } | undefined },
}));
vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton: gamepad.press }),
}));
vi.mock('app/components/GamepadPicker', () => ({ GamepadPicker: () => null }));
vi.mock('app/components/BuzzerMappingDialog', () => ({ BuzzerMappingDialog: () => null }));
vi.mock('app/hooks/useSignalAudio', () => ({
  useSignalAudio: () => ({
    audioElement: null,
    playAudio: vi.fn(),
    audioBlocked: false,
  }),
}));
vi.mock('app/state/selectedCompetition', () => ({
  useSelectedCompetition: () => ({ compId: 'c1' }),
}));

const athlete = (athleteId: string, name: string): Athlete =>
  ({
    athleteId,
    compId: 'c1',
    name,
    firstName: name,
    lastName: '',
    shortName: name,
    gender: 'male',
  }) as Athlete;

const ATHLETES = [athlete('a1', 'Bianchi'), athlete('a2', 'Roe')];

beforeEach(() => {
  window.localStorage.clear();
  sockets.readyState = 1;
  sockets.receiverMessage = null;
  sockets.senderSend = vi.fn();
  gamepad.press = undefined;
  // Reads resolve to the comp's pool (or empty); a write resolves as a
  // persisted Score, so a Save reaches the locked `saved` panel. Anything with
  // a method is a data-plane write, which `writeCalls()` counts.
  apiFetchMock
    .mockReset()
    .mockImplementation((path: string, opts?: { method?: string }) =>
      Promise.resolve(
        (opts?.method ?? 'GET') !== 'GET'
          ? { overall: 28, dnf: false }
          : path.endsWith('/athletes')
            ? ATHLETES
            : [],
      ),
    );
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GamepadSelectionProvider>
          <FreestyleControlPage />
        </GamepadSelectionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(tree());
  /** Hand the page one peer frame, the way the socket would. */
  const deliver = (message: CountdownWSMessage): void => {
    act(() => {
      sockets.receiverMessage = message;
      rendered.rerender(tree());
    });
  };
  return { ...rendered, deliver };
};

// --- peer frames -----------------------------------------------------------

const peerStart = (timerId: number, remainingMs: number): CountdownWSMessage => ({
  type: 'start_countdown',
  timerId,
  sessionId: 'c1',
  senderId: 'peer-panel',
  data: { remainingMs },
});

const peerStop = (timerId: number, remainingMs: number): CountdownWSMessage => ({
  type: 'stop_countdown',
  timerId,
  sessionId: 'c1',
  senderId: 'peer-panel',
  data: { remainingMs },
});

const peerReset = (timerId: number, remainingMs: number): CountdownWSMessage => ({
  type: 'reset_countdown',
  timerId,
  sessionId: 'c1',
  senderId: 'peer-panel',
  data: { remainingMs },
});

const peerBreakStart = (timerId: number): CountdownWSMessage => ({
  type: 'start_break',
  timerId,
  sessionId: 'c1',
  senderId: 'peer-panel',
  data: { runRemainingMs: 90_000, breakMs: 30_000, breaksLeft: 0 },
});

const peerSelection = (selection: Partial<LiveSelection>): CountdownWSMessage => ({
  type: 'updateSelection',
  sessionId: 'c1',
  senderId: 'peer-panel',
  data: {
    discipline: 'freestyle',
    round: 'final',
    gender: 'male',
    matchId: null,
    athlete1Id: null,
    athlete2Id: null,
    ...selection,
  },
});

// --- what left the panel ---------------------------------------------------

/** apiFetch calls that would write to the data plane (Score POST / Match PUT…). */
const writeCalls = () =>
  (apiFetchMock.mock.calls as [string, { method?: string } | undefined][]).filter(
    ([, opts]) => (opts?.method ?? 'GET') !== 'GET',
  );

/** The newest selection this panel put on the wire. */
const lastSelection = () =>
  sentOfType('updateSelection').at(-1) as
    { data: { qualiNextUp?: string | null; freestyleMode?: string } } | undefined;

const sentOfType = (...types: string[]) =>
  (sockets.senderSend.mock.calls as [{ type: string }][])
    .map(([message]) => message)
    .filter((message) => types.includes(message.type));

/** Lane messages this panel put on the wire (the peer-apply loop guard). */
const countdownSends = () =>
  sentOfType('start_countdown', 'stop_countdown', 'reset_countdown', 'start_break', 'end_break');

const resetSends = () => sentOfType('reset_countdown');

// --- the two layout branches -----------------------------------------------

/**
 * jsdom ships no `matchMedia` and lays nothing out, so *every* page test used to
 * fall through `useMediaQuery` to `CompactBoardLayout` — the three-column desk
 * had no page-level coverage at all. Each suite below therefore states the
 * branch it pins and runs on both: `pinLayoutWidth` decides which one renders,
 * and `reach` is the difference in getting to a section — the desk shows all of
 * them at once, the compact layout one tab at a time.
 */
const LAYOUTS = [
  { branch: 'desk ≥1280×800', width: DESK_MIN_PX, desk: true },
  { branch: 'compact <1280', width: COMPACT_PX, desk: false },
] as const;

type BoardTab = 'Setup' | 'Selection' | 'Run' | 'Best trick' | 'Score';

const reacher = (desk: boolean) => (tab: BoardTab) => {
  if (desk) return;
  fireEvent.click(screen.getByRole('tab', { name: tab }));
};

const laneButton = (verb: string, lane: 1 | 2 = 1) =>
  screen.getByRole('button', { name: `${verb} Athlete ${lane}` }) as HTMLButtonElement;

const warmupButton = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

// ---------------------------------------------------------------------------

describe.each(LAYOUTS)('FreestyleControlPage athlete wording — $branch', ({ width, desk }) => {
  const reach = reacher(desk);
  beforeEach(() => pinLayoutWidth(width));

  it('uses athlete labels for the quali lane controls', () => {
    renderPage();

    reach('Run');
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeInTheDocument();
    expect(screen.queryByText(/^Player 1$/)).not.toBeInTheDocument();

    // Scoped: on the desk the lane card is a landmark named `Athlete 1` too, so
    // a bare label query is ambiguous there and unambiguous in the tabs.
    reach('Selection');
    expect(
      within(screen.getByTestId('selection-column')).getByLabelText(/^Athlete 1$/i),
    ).toBeInTheDocument();

    reach('Score');
    expect(screen.getByRole('button', { name: 'Save Athlete 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DNF Athlete 1' })).toBeInTheDocument();
  });

  it('uses athlete labels for the battle second lane and athlete assignment controls', () => {
    window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
    renderPage();

    reach('Selection');
    expect(screen.getByRole('button', { name: /swap athletes/i })).toBeInTheDocument();
    expect(screen.getByTestId('athlete-assignment-group')).toBeInTheDocument();

    reach('Run');
    expect(screen.getByRole('region', { name: 'Athlete 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Athlete 2' })).toBeInTheDocument();

    reach('Score');
    expect(screen.getByRole('button', { name: 'Save Athlete 2' })).toBeInTheDocument();
  });

  it('uses athlete labels for best-trick controls and reset confirmations', async () => {
    window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
    renderPage();

    // Reset is locked once a best-trick series is armed (lockReason.ts —
    // "no exception for Reset"), so the confirm dialog is exercised first,
    // before arming best trick. A pristine idle lane resets instantly with no
    // confirm (resetGuard.ts) — start the lane first so Reset has a run to ask
    // about.
    reach('Run');
    fireEvent.click(laneButton('Start'));
    fireEvent.click(laneButton('Reset'));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    // Confirm the reset (not "Keep timing") so the lane is idle again — a
    // best-trick series won't arm over a lane still running.
    fireEvent.click(screen.getByRole('button', { name: 'Reset Athlete 1' }));
    // MUI's Dialog exit transition lingers in the DOM (and keeps the rest of
    // the tree aria-hidden) past the click that closes it.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    reach('Best trick');
    fireEvent.click(screen.getByRole('button', { name: /^begin best trick/i }));
    expect(screen.getByRole('button', { name: 'Start try Athlete 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip Athlete 1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Best trick Athlete 1' })).toBeInTheDocument();
  });
});

// A peer panel's frames must move THIS board's machines and nothing else: no
// re-broadcast (the drains would loop the room) and no data-plane write (ADR
// 0038 binds writes to local operator actions).
describe.each(LAYOUTS)(
  'FreestyleControlPage peer mirroring (ADR 0038) — $branch',
  ({ width, desk }) => {
    const reach = reacher(desk);
    beforeEach(() => pinLayoutWidth(width));

    it('applies a peer lane start/stop into the battle machine', () => {
      const { deliver } = renderPage();
      reach('Run');
      expect(laneButton('Start').disabled).toBe(false);
      expect(laneButton('Stop').disabled).toBe(true);

      // A run started on ANOTHER panel: this panel's buttons must tell the truth.
      deliver(peerStart(1, 100_000));
      reach('Run');
      expect(laneButton('Start').disabled).toBe(true);
      expect(laneButton('Stop').disabled).toBe(false);

      // The peer ends the turn: the lane freezes here at the wire budget.
      deliver(peerStop(1, 80_000));
      reach('Run');
      expect(laneButton('Start').disabled).toBe(false);
      expect(laneButton('Stop').disabled).toBe(true);

      expect(countdownSends()).toHaveLength(0);
      expect(writeCalls()).toHaveLength(0);
    });

    it('re-arms after a peer reset', () => {
      const { deliver } = renderPage();
      deliver(peerStart(1, 100_000));
      reach('Run');
      expect(laneButton('Start').disabled).toBe(true);

      deliver(peerReset(1, 120_000));
      reach('Run');
      expect(laneButton('Start').disabled).toBe(false);
      expect(laneButton('Stop').disabled).toBe(true);
      expect(countdownSends()).toHaveLength(0);
    });

    it('mirrors a peer board-mode flip off updateSelection (quali → battle)', () => {
      const { deliver } = renderPage();
      reach('Run');
      expect(screen.queryByRole('region', { name: 'Athlete 2' })).toBeNull();

      deliver(peerSelection({ freestyleMode: 'battle' }));

      reach('Run');
      expect(screen.getByRole('region', { name: 'Athlete 2' })).toBeInTheDocument();
      expect(countdownSends()).toHaveLength(0);
      expect(writeCalls()).toHaveLength(0);
    });

    it('re-derives both second drafts from a peer mode flip (format = mode)', () => {
      const { deliver } = renderPage();
      reach('Setup');
      fireEvent.click(screen.getByRole('button', { name: 'Setup details' }));
      // Quali's format (rules F4/F5) — the drafts the panel opened on.
      expect((screen.getByLabelText('Run (s)') as HTMLInputElement).value).toBe('120');
      expect((screen.getByLabelText('Warm-up (s)') as HTMLInputElement).value).toBe('300');

      // A peer-applied mode IS the room's mode: the drafts follow the flipped
      // format exactly as on a local flip, so the next Set-both-lanes on this
      // panel re-arms the room to battle timings rather than quali's.
      // The dialog stays open across the frame (a rerender, not a remount), so
      // the two drafts are read in place — reaching for the tab again would
      // query the tree the open dialog holds `aria-hidden`.
      deliver(peerSelection({ freestyleMode: 'battle' }));

      expect((screen.getByLabelText('Run (s)') as HTMLInputElement).value).toBe('150');
      expect((screen.getByLabelText('Warm-up (s)') as HTMLInputElement).value).toBe('420');
      // …and silently: applying the format re-arms nothing from here (the acting
      // panel's own reset pair carries the lanes — ADR 0046 §2).
      expect(countdownSends()).toHaveLength(0);
      expect(writeCalls()).toHaveLength(0);
    });

    it('mirrors a peer warm-up start into the warm-up channel', () => {
      const { deliver } = renderPage();
      reach('Setup');
      expect(warmupButton('Start warm-up').disabled).toBe(false);

      // Warm-up is timerId 0 — the third channel, outside the two lanes.
      deliver(peerStart(0, 300_000));

      reach('Setup');
      expect(warmupButton('Start warm-up').disabled).toBe(true);
      expect(warmupButton('Stop warm-up').disabled).toBe(false);
      expect(countdownSends()).toHaveLength(0);
    });
  },
);

// The consolidation seam (ADR 0032): the lane clocks run controlled off the
// battle reducer, so PEER_SNAPSHOT is the ONLY application — hydrating the
// machine hydrates the display with it, and there is no recovery side channel
// left to feed.
describe.each(LAYOUTS)(
  'FreestyleControlPage peer state_snapshot catch-up — $branch',
  ({ width, desk }) => {
    const reach = reacher(desk);
    beforeEach(() => pinLayoutWidth(width));

    it('hydrates the reducer AND the clocks from a mid-join snapshot', () => {
      const { deliver } = renderPage();

      // First frame since the socket opened, so the live-beats-snapshot gate is
      // still down and the catch-up applies.
      deliver({
        type: 'state_snapshot',
        sessionId: 'c1',
        senderId: 'peer-panel',
        data: {
          isPreviewEnabled: true,
          timers: [
            { timerId: 0, remainingMs: 300_000, isRunning: false },
            { timerId: 1, remainingMs: 80_000, isRunning: true, breaksLeft: 1 },
            { timerId: 2, remainingMs: 120_000, isRunning: false, breaksLeft: 2 },
          ],
        },
      });

      reach('Run');
      // The hydrated lane runs here: the clock resumed at the wire remaining
      // (the card mounts a hidden held-run row beside the numeral, so the value
      // can match twice) and the buttons tell the truth.
      expect(screen.getAllByText('01:20').length).toBeGreaterThan(0);
      expect(laneButton('Start').disabled).toBe(true);
      expect(laneButton('Stop').disabled).toBe(false);
      expect(countdownSends()).toHaveLength(0);
      expect(writeCalls()).toHaveLength(0);
    });
  },
);

// Format IS mode (ADR 0036): one Quali/Battle toggle picks the board shape, its
// championship timings (rules F4/F5) and its recording round — and the choice is
// remembered per competition (localStorage keyed off compId = sessionId), so
// reopening the same comp's board restores all three. Nothing is confirmed: the
// toggle is inert while the board holds anything (5d4d523 replaced both native
// confirms with that lock), so by the time it can be pressed it destroys nothing.
describe.each(LAYOUTS)(
  'FreestyleControlPage mode memory and mode switch — $branch',
  ({ width, desk }) => {
    const reach = reacher(desk);
    beforeEach(() => pinLayoutWidth(width));

    const modeToggle = (name: 'Quali' | 'Battle') =>
      screen.getByRole('button', { name }) as HTMLButtonElement;
    const storedMode = () => window.localStorage.getItem('speedline.freestyleMode.c1');
    /** The recording round + board mode as the console header shows them. */
    const headerText = () => screen.getByTestId('control-status-header').textContent ?? '';
    /** The setup rail's one-line summary of the applied format. */
    const formatSummary = () =>
      screen.getByText(/^Run \d+ s · Warm-up \d+ s · Preview/).textContent ?? '';

    it('restores the stored battle mode on mount, with its format and round', () => {
      window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
      renderPage();

      reach('Setup');
      expect(modeToggle('Battle')).toHaveAttribute('aria-pressed', 'true');
      expect(formatSummary()).toBe('Run 150 s · Warm-up 420 s · Preview ON');
      expect(headerText()).toContain('Quarter-finals');

      reach('Run');
      expect(screen.getByRole('region', { name: 'Athlete 2' })).toBeInTheDocument();
    });

    it('does not leak another competition’s stored mode', () => {
      window.localStorage.setItem('speedline.freestyleMode.other-comp', 'battle');
      renderPage();

      reach('Run');
      expect(screen.queryByRole('region', { name: 'Athlete 2' })).toBeNull();
      expect(headerText()).toContain('Qualification');
    });

    it('stores the mode a switch applies and re-arms both lanes to its timings', () => {
      renderPage();
      reach('Setup');

      fireEvent.click(modeToggle('Battle'));

      expect(storedMode()).toBe('battle');
      reach('Setup');
      expect(formatSummary()).toBe('Run 150 s · Warm-up 420 s · Preview ON');
      expect(resetSends()).toEqual([
        { type: 'reset_countdown', timerId: 1, data: { remainingMs: 150_000 } },
        { type: 'reset_countdown', timerId: 2, data: { remainingMs: 150_000 } },
      ]);
    });

    it('normalizes an out-of-mode round through requestRound', () => {
      renderPage();
      reach('Setup');
      expect(headerText()).toContain('Qualification');

      // quali → battle: qualification is not a battle round → quarter.
      fireEvent.click(modeToggle('Battle'));
      expect(headerText()).toContain('Quarter-finals');

      // battle → quali: quarter is not a quali round → back to qualification.
      reach('Setup');
      fireEvent.click(modeToggle('Quali'));
      expect(headerText()).toContain('Qualification');
    });

    it('locks the toggle while a quali break is open (a mid-run flip corrupts the board)', () => {
      const { deliver } = renderPage();

      // A peer opens the advisory quali break: no lane runs, but the run is
      // mid-break, so the re-arm behind a flip would discard it.
      deliver(peerBreakStart(1));
      reach('Setup');

      expect(modeToggle('Battle').disabled).toBe(true);
      fireEvent.click(modeToggle('Battle'));
      expect(modeToggle('Quali')).toHaveAttribute('aria-pressed', 'true');
      expect(storedMode()).toBeNull();
      expect(resetSends()).toHaveLength(0);
    });

    it('remembers a peer-mirrored mode flip too (this board showed it last)', () => {
      const { deliver } = renderPage();

      deliver(peerSelection({ freestyleMode: 'battle' }));

      expect(storedMode()).toBe('battle');
    });
  },
);

// The score rail's whole-board re-arm (§4.9) is the two per-lane RESETs in one
// press, so it must put one `reset_countdown` per lane on the wire — each at
// the budget ITS lane was armed to, never one shared default.
describe.each(LAYOUTS)(
  'FreestyleControlPage Reset lanes for the next match — $branch',
  ({ width, desk }) => {
    const reach = reacher(desk);
    beforeEach(() => pinLayoutWidth(width));

    it('sends one reset_countdown per lane, each at its own armedMs', async () => {
      window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
      const { deliver } = renderPage();

      // The room armed lane 2 shorter than this panel's format default (ADR
      // 0046 §2 — the room owns `armedMs`, not the panel), so the two frames
      // cannot both carry 150 s.
      deliver(peerReset(2, 90_000));
      deliver(
        peerSelection({
          round: 'quarter',
          freestyleMode: 'battle',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
        }),
      );

      // The rail offers the re-arm only once both athlete slots are saved.
      reach('Score');
      fireEvent.click(screen.getByRole('button', { name: 'Save Athlete 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save Athlete 2' }));
      const resetLanes = await screen.findByRole('button', {
        name: /reset lanes for the next match/i,
      });

      // Both lanes are pristine, so the press asks nothing and fires straight.
      fireEvent.click(resetLanes);

      expect(resetSends()).toEqual([
        { type: 'reset_countdown', timerId: 1, data: { remainingMs: 150_000 } },
        { type: 'reset_countdown', timerId: 2, data: { remainingMs: 90_000 } },
      ]);
    });
  },
);

// The desk's own arithmetic, which only the ≥1280 branch can answer: jsdom
// applies no `@media` and lays nothing out, so the authored track lists are read
// off the CSSOM and solved against `deskGeometry`'s model — the file whose
// numbers every lane-card width assertion (the why-line's wrap budget included)
// is held to.
describe('FreestyleControlPage desk geometry (pins the ≥1280 branch)', () => {
  beforeEach(() => pinLayoutWidth(DESK_MIN_PX));

  it('solves the three-column desk and the battle deck to the shared model', () => {
    window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
    renderPage();

    const deskRow = screen.getByTestId('desk-live').parentElement as HTMLElement;
    expect(px(window.getComputedStyle(deskRow).gap)).toBe(DESK_GAP_PX);
    const [, liveColumn] = solveTracks(
      deskMediaValue(deskRow, 'grid-template-columns'),
      DESK_GAP_PX,
      DESK_MIN_PX - 2 * PAGE_PADDING_PX,
    );
    expect(liveColumn).toBe(LIVE_COLUMN_PX);

    const deck = screen.getByTestId('run-deck');
    expect(px(window.getComputedStyle(deck).gap)).toBe(DECK_GAP_PX);
    const [laneColumn] = solveTracks(
      window.getComputedStyle(deck).gridTemplateColumns,
      DECK_GAP_PX,
      liveColumn,
    );
    expect(Math.floor(laneColumn)).toBe(LANE_COLUMN_PX);
  });

  // The sticky plate used to span the live column while the deck under it
  // stopped at its own ceiling, so the verb hung 448 px clear of the lane it
  // names at 1920. It takes the deck's ceiling now — except in quali, where the
  // 500 px deck wraps the TAKE BREAK verb and steps the whole board (measured
  // in a browser; see `QUALI_RUN_MAX_WIDTH`), so the plate keeps the column.
  it('caps the sticky plate at the battle deck ceiling', () => {
    window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
    renderPage();

    const ceiling = window.getComputedStyle(screen.getByTestId('run-column')).maxWidth;

    expect(ceiling).not.toBe('');
    expect(window.getComputedStyle(screen.getByTestId('plate-rail')).maxWidth).toBe(ceiling);
  });

  it('leaves the quali plate on the live column', () => {
    renderPage();

    expect(window.getComputedStyle(screen.getByTestId('run-column')).maxWidth).not.toBe('none');
    expect(window.getComputedStyle(screen.getByTestId('plate-rail')).maxWidth).toBe('none');
  });
});

// fsux-desk-fold-budget (c): the wide desk is gated on HEIGHT as well as width.
// A 1280x720 screen is wide enough for the three columns and too short to hold
// them, so it took the desk and put the lane transport under the fold; the tab
// layout is the answer to a short screen exactly as it is to a narrow one.
// The threshold is 900 (`freestyle-board-fold-budget`): measured with the fold
// budget spent down, the battle desk's last control lands at 879 and quali's at
// 862, so at 1280x800 the desk took a screen it could not keep its promise on.
describe('FreestyleControlPage desk height gate', () => {
  it.each([
    { viewport: '1280x720 (wide but short)', width: DESK_MIN_PX, height: SHORT_DESK_HEIGHT_PX },
    {
      viewport: '1280x800 (wide, 80 px short)',
      width: DESK_MIN_PX,
      height: TALLISH_DESK_HEIGHT_PX,
    },
    { viewport: '1024x768 (tablet)', width: COMPACT_PX, height: COMPACT_HEIGHT_PX },
  ])('takes the compact tab layout at $viewport', ({ width, height }) => {
    pinLayoutWidth(width, height);
    renderPage();

    expect(screen.queryByTestId('desk-live')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Run' })).toBeInTheDocument();
  });

  it('takes the desk at the contract laptop', () => {
    pinLayoutWidth(DESK_MIN_PX, DESK_HEIGHT_PX);
    renderPage();

    expect(screen.getByTestId('desk-live')).toBeInTheDocument();
  });
});

// freestyle-board-fold-budget: two rows the board only owes on one branch. The
// step caption is the tab's own word on the compact layout, and the lane
// clock's held-run reserve is a QUALI row (ADR 0036 — battle never breaks)
// that only the desk owes §4.12's no-shift promise for.
describe('FreestyleControlPage fold budget', () => {
  const laneRow = (numeral: string) =>
    within(screen.getByTestId('lane-card-1')).getAllByText(numeral).length;

  it('prints the step captions on the desk and leaves them to the tabs', () => {
    pinLayoutWidth(DESK_MIN_PX);
    const desk = renderPage();
    expect(screen.getByText('4 · Run')).toBeInTheDocument();
    desk.unmount();

    pinLayoutWidth(COMPACT_PX, COMPACT_HEIGHT_PX);
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
    expect(screen.queryByText('4 · Run')).not.toBeInTheDocument();
    // The landmark is not the caption's to give up — the tab names the step,
    // the section still answers to it.
    expect(screen.getByRole('region', { name: 'Run' })).toBeInTheDocument();
  });

  it('reserves the held-run row on the quali desk only', () => {
    // The reserve mounts a hidden mirror of the numeral above it, so the
    // budget reads twice inside the card exactly where the row is held.
    pinLayoutWidth(DESK_MIN_PX);
    const qualiDesk = renderPage();
    expect(laneRow('02:00')).toBe(2);
    qualiDesk.unmount();

    pinLayoutWidth(COMPACT_PX, COMPACT_HEIGHT_PX);
    const qualiTabs = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
    expect(laneRow('02:00')).toBe(1);
    qualiTabs.unmount();

    window.localStorage.setItem('speedline.freestyleMode.c1', 'battle');
    pinLayoutWidth(DESK_MIN_PX);
    renderPage();
    expect(laneRow('02:30')).toBe(1);
  });
});

// freestyle-quali-next-up: quali runs one athlete at a time, so who follows is
// not derivable from anything the board holds — the operator names it, it rides
// `updateSelection` (inheriting the ADR 0038 §4 authority rank), and nothing
// persists it.
describe.each(LAYOUTS)('FreestyleControlPage quali Next up — $branch', ({ width, desk }) => {
  const reach = reacher(desk);
  beforeEach(() => pinLayoutWidth(width));

  const nextUpField = () => screen.getByLabelText(/^next up$/i) as HTMLSelectElement;

  /** The athlete pool arrives from the data plane, and a native select reports
   * `''` for a value it has no option for — so every assertion here waits for
   * the options first. */
  const withAthletePool = async () => {
    await screen.findAllByRole('option', { name: 'Roe' });
  };

  it('relays the named athlete, and clears it in one press', async () => {
    renderPage();
    reach('Selection');
    await withAthletePool();

    fireEvent.change(nextUpField(), { target: { value: 'a2' } });
    expect(lastSelection()?.data.qualiNextUp).toBe('a2');

    fireEvent.change(nextUpField(), { target: { value: '' } });
    expect(lastSelection()?.data.qualiNextUp).toBeNull();
    // A hint, not a record: naming the next athlete writes nothing.
    expect(writeCalls()).toHaveLength(0);
  });

  it('mirrors a peer panel’s choice, and is not rendered in battle', async () => {
    const { deliver } = renderPage();
    reach('Selection');
    await withAthletePool();

    deliver(peerSelection({ freestyleMode: 'quali', qualiNextUp: 'a1' }));
    reach('Selection');
    expect(nextUpField().value).toBe('a1');

    deliver(peerSelection({ freestyleMode: 'battle' }));
    reach('Selection');
    expect(screen.queryByLabelText(/^next up$/i)).not.toBeInTheDocument();
    expect(lastSelection()?.data.qualiNextUp).toBeNull();
  });
});
