import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CountdownWSMessage } from 'app/hooks/useWebSocket';

// The display opens a receiver socket via the shared feed. Stub it so no real
// socket opens, and hand it the frame under test through the captured
// `onMessage` (`deliverFrames`) — same harness as the FreestyleTimerDisplay
// suite (both mount useFreestyleTimerFeed).
const { wsParams, readyState, playAudio, audioBlocked } = vi.hoisted(() => ({
  wsParams: { current: null as { sessionId: string; readToken?: string } | null },
  // Mutable so a suite can drive a CLOSED -> OPEN cycle (see the surface-seeding
  // suite): the feed accepts exactly one fresh seed per socket.
  readyState: { current: 1 },
  playAudio: vi.fn(),
  audioBlocked: { current: false },
}));
vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  const { useCapturedSocket } = await import('../../../util/wsMock');
  return {
    ...actual,
    useWS: (params: {
      sessionId: string;
      readToken?: string;
      onMessage?: (frame: never) => void;
    }) => {
      wsParams.current = params;
      useCapturedSocket(params);
      return {
        readyState: readyState.current,
        sendWSMessage: vi.fn(),
      };
    },
  };
});

// The quali next-up marker resolves an athlete id against the comp's pool, the
// one data-plane read this surface makes; everything else answers empty.
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

// Capture the PA-feed beeps without standing up the real audio elements.
vi.mock('app/hooks/useSignalAudio', () => ({
  useSignalAudio: () => ({ audioElement: null, playAudio, audioBlocked: audioBlocked.current }),
}));

import { FreestyleAthleteDisplay } from 'app/pages/Freestyle/FreestyleAthleteDisplay';
import { deliver as deliverFrames } from '../../../util/wsMock';

const tree = (
  client: QueryClient,
  variant: 'venue' | 'stream',
  search = '?sessionId=worlds-2026',
) => (
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/freestyle/athletes${search}`]}>
      <FreestyleAthleteDisplay variant={variant} />
    </MemoryRouter>
  </QueryClientProvider>
);

// `repaint` re-renders the same display (a socket state change); frames arrive
// through `deliverFrames`. The QueryClient is created ONCE per display, so a
// repaint keeps the cache.
const renderDisplay = (variant: 'venue' | 'stream' = 'venue', search?: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(client, variant, search));
  return { ...view, repaint: () => view.rerender(tree(client, variant, search)) };
};

const namesMessage = (
  lane1: string,
  lane2: string,
  discipline?: 'speed' | 'freestyle',
): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'updateLaneNames',
  data: { lane1, lane2, ...(discipline ? { discipline } : {}) },
});

const selectionMessage = (
  freestyleMode: 'quali' | 'battle' | undefined,
  nextUp?: 1 | 2 | null,
  qualiNextUp?: string | null,
): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'updateSelection',
  data: {
    discipline: 'freestyle',
    round: 'qualification',
    gender: 'male',
    matchId: null,
    athlete1Id: null,
    athlete2Id: null,
    freestyleMode,
    nextUp,
    qualiNextUp,
  },
});

const startLane = (timerId: 0 | 1 | 2 | 3, remainingMs: number): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'start_countdown',
  timerId,
  data: { remainingMs },
});

const stopLane = (timerId: 0 | 1 | 2 | 3, remainingMs: number): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'stop_countdown',
  timerId,
  data: { remainingMs },
});

const resetLane = (timerId: 0 | 1 | 2 | 3, remainingMs: number): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'reset_countdown',
  timerId,
  data: { remainingMs },
});

const snapshotMessage = (
  timers: Array<{ timerId: number; remainingMs: number; isRunning: boolean }>,
): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'state_snapshot',
  data: { isPreviewEnabled: true, timers },
});

beforeEach(() => {
  apiFetchMock.mockReset().mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/athletes')
        ? [
            {
              athleteId: 'a2',
              compId: 'worlds-2026',
              name: 'Fay Frau',
              firstName: 'Fay',
              lastName: 'Frau',
              shortName: 'Frau',
              gender: 'female',
            },
          ]
        : [],
    ),
  );
});

afterEach(() => {
  readyState.current = 1;
  playAudio.mockClear();
});

// ADR 0036 §5: the layout switches on the board's relayed explicit mode, never
// on athlete-count inference. A lane start precedes each flow so the default
// warm-up view has yielded to the lane layout under test.
describe('FreestyleAthleteDisplay quali/battle layout switch', () => {
  it('renders the two stacked lanes once a run starts (no mode on the wire)', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('collapses to the single lane-1 hero when the board says quali', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));

    deliverFrames(selectionMessage('quali'));

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
  });

  it('restores the split screen when the board switches back to battle', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));

    deliverFrames(selectionMessage('quali'));
    expect(screen.queryByText('John')).not.toBeInTheDocument();

    deliverFrames(selectionMessage('battle'));
    expect(screen.getByText('John')).toBeInTheDocument();
  });
});

describe('FreestyleAthleteDisplay quali break counter', () => {
  it('shows the advisory break counter while a quali break runs', () => {
    renderDisplay();
    deliverFrames(selectionMessage('quali'));

    deliverFrames({
      sessionId: 'worlds-2026',
      type: 'start_break',
      timerId: 1,
      data: { runRemainingMs: 60_000, breakMs: 30_000, breaksLeft: 1 },
    });

    expect(screen.getByText('Break · 1 left')).toBeInTheDocument();
  });
});

// ADR 0036: battle has no break machinery on the wire and no audience-facing
// pause clock — the battle layout must render neither, not even reserved-hidden
// ones. (The next-up arrow rides the relayed hint — the "battle next up" suite
// below.)
describe('FreestyleAthleteDisplay battle layout omissions', () => {
  it('renders no break/pause surface in battle', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(selectionMessage('battle'));

    expect(screen.queryByText(/Break/)).not.toBeInTheDocument();
  });
});

// The battle athlete display marks who goes next during the changeover pause
// with an on-deck arrow on that lane's clock, off the board's relayed `nextUp`
// hint (ADR 0037).
describe('FreestyleAthleteDisplay battle next up', () => {
  it('marks the next-up player from the relayed hint', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));
    deliverFrames(selectionMessage('battle', 2));

    // The arrow rides the marked lane's name row (lane 2 = John), not the other.
    const marker = screen.getByRole('img', { name: 'On deck' });
    expect(marker.parentElement).toHaveTextContent('John');
    expect(marker.parentElement).not.toHaveTextContent('Jane');
  });

  it('hides the marker when no next-up player is defined', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));
    deliverFrames(selectionMessage('battle', null));

    expect(screen.queryByRole('img', { name: 'On deck' })).not.toBeInTheDocument();
  });

  it('shows no next-up marker in quali (single-hero layout)', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));
    // A stray hint on a quali board must not surface (source gates it to battle;
    // the quali layout has no marker regardless).
    deliverFrames(selectionMessage('quali', 2));

    expect(screen.queryByRole('img', { name: 'On deck' })).not.toBeInTheDocument();
  });
});

// freestyle-quali-next-up: quali has one clock, so there is no idle lane to mark
// — the board names the next ATHLETE and the display carries that name under the
// hero, behind the SAME on-deck arrow battle uses (identical marker, ADR 0037's
// promise applied to a mode that has no second slot).
describe('FreestyleAthleteDisplay quali next up', () => {
  const qualiDisplay = async (qualiNextUp?: string | null) => {
    const view = renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));
    deliverFrames(selectionMessage('quali', null, qualiNextUp));
    // The pool arrives from the data plane; the marker cannot name anyone before it.
    await act(async () => {
      await Promise.resolve();
    });
    view.repaint();
    return view;
  };

  it('names the operator-picked next athlete under the hero', async () => {
    await qualiDisplay('a2');

    const marker = screen.getByRole('img', { name: 'On deck' });
    // Resolved the way the relayed lane names are (shortName → lastName → name),
    // so the two markers read alike.
    expect(marker.parentElement).toHaveTextContent('Frau');
    // …and it is a row of its own under the performing athlete's clock, never a
    // second arrow on that athlete's name.
    expect(marker.parentElement).not.toHaveTextContent('Jane');
  });

  it('shows nothing once the board clears it', async () => {
    await qualiDisplay(null);

    expect(screen.queryByRole('img', { name: 'On deck' })).not.toBeInTheDocument();
  });
});

describe('FreestyleAthleteDisplay battle over', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Battle Over only once both lanes have spent their budgets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    renderDisplay();
    deliverFrames(startLane(1, 2_000));

    act(() => {
      vi.setSystemTime(3_000);
      vi.advanceTimersToNextTimer();
    });
    // Lane 1 spent, lane 2 untouched: the battle is still live.
    expect(screen.queryByText('Battle Over')).not.toBeInTheDocument();

    deliverFrames(startLane(2, 2_000));
    act(() => {
      vi.setSystemTime(6_000);
      vi.advanceTimersToNextTimer();
    });

    expect(screen.getByText('Battle Over')).toBeInTheDocument();
  });

  // As the lane column's THIRD flex child the banner would make `space-evenly`
  // re-divide the screen the moment a battle ends, jumping both hero clocks —
  // on the projector and on /stream/athletes-freestyle. jsdom has no layout, so
  // the pin is structural: the banner is out of the flex flow. The clock
  // bounding boxes either side of the transition are measured by the driver's
  // display-signoff pass at 1920x1080.
  it('keeps the Battle Over banner out of the lane column flex flow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    renderDisplay();
    deliverFrames(startLane(1, 1_000));
    act(() => {
      vi.setSystemTime(2_000);
      vi.advanceTimersToNextTimer();
    });
    deliverFrames(startLane(2, 1_000));
    act(() => {
      vi.setSystemTime(4_000);
      vi.advanceTimersToNextTimer();
    });

    expect(screen.getByText('Battle Over')).toHaveStyle({ position: 'absolute' });
  });

  it('clears Battle Over when a lane restarts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    renderDisplay();
    deliverFrames(startLane(1, 1_000));
    act(() => {
      vi.setSystemTime(2_000);
      vi.advanceTimersToNextTimer();
    });
    deliverFrames(startLane(2, 1_000));
    act(() => {
      vi.setSystemTime(4_000);
      vi.advanceTimersToNextTimer();
    });
    expect(screen.getByText('Battle Over')).toBeInTheDocument();

    deliverFrames(startLane(1, 60_000));
    expect(screen.queryByText('Battle Over')).not.toBeInTheDocument();
  });
});

// Warm-up is the DEFAULT view — it shows until the warm-up has finished or a
// competition action (a lane run / best-trick try) takes over; a fresh display
// presumes the warm-up phase.
describe('FreestyleAthleteDisplay warm-up default view', () => {
  // OPEN and preview-enabled, but nothing has arrived — neither a snapshot nor
  // a countdown message. The surface is unseeded, so it draws NO clock: a
  // `warmupActive: true` default over an empty recovery would put a fabricated
  // `WARM-UP 00:00` on air.
  it('renders no clock at all on an unseeded display (no messages yet)', () => {
    renderDisplay();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('shows the pending warm-up view once the room seeds it (warm-up re-arm)', () => {
    renderDisplay();
    deliverFrames(resetLane(0, 300_000));

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  it('yields to the lane layout when a lane run starts', () => {
    renderDisplay();
    deliverFrames(resetLane(0, 300_000));
    deliverFrames(namesMessage('Jane', 'John'));
    // The pending warm-up shadows the lane layout until a run starts.
    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();

    deliverFrames(startLane(1, 60_000));

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('yields to the lane layout when a best-trick try starts (timerId 3)', () => {
    renderDisplay();
    deliverFrames(resetLane(0, 300_000));
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    deliverFrames(startLane(3, 30_000));

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('returns when the operator starts a new warm-up mid-competition', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();

    deliverFrames(startLane(0, 300_000));

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  it('does not resurface on a warm-up reset mid-competition (re-arm only)', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));

    deliverFrames({
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    });

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('recovers the pending warm-up view from an idle control snapshot', () => {
    renderDisplay();
    deliverFrames(
      snapshotMessage([
        { timerId: 0, remainingMs: 300_000, isRunning: false },
        { timerId: 1, remainingMs: 90_000, isRunning: false },
        { timerId: 2, remainingMs: 90_000, isRunning: false },
      ]),
    );

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  it('recovers the lane view when the snapshot shows the warm-up spent', () => {
    renderDisplay();
    deliverFrames(
      snapshotMessage([
        { timerId: 0, remainingMs: 0, isRunning: false },
        { timerId: 1, remainingMs: 90_000, isRunning: false },
        { timerId: 2, remainingMs: 90_000, isRunning: false },
      ]),
    );

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('recovers the lane view when a run is live even though the warm-up is pending', () => {
    renderDisplay();
    deliverFrames(
      snapshotMessage([
        { timerId: 0, remainingMs: 300_000, isRunning: false },
        { timerId: 1, remainingMs: 45_000, isRunning: true },
        { timerId: 2, remainingMs: 90_000, isRunning: false },
      ]),
    );

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('recovers a RUNNING warm-up view even after lanes have spent budgets', () => {
    renderDisplay();
    deliverFrames(
      snapshotMessage([
        { timerId: 0, remainingMs: 250_000, isRunning: true },
        { timerId: 1, remainingMs: 0, isRunning: false },
        { timerId: 2, remainingMs: 90_000, isRunning: false },
      ]),
    );

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  // A running warm-up whose time-to-go has fully elapsed snapshots as
  // { isRunning: true, remainingMs: 0 } (the control's own onExpire hand-off
  // may not have landed at the instant the snapshot was built). remainingMs is
  // the authority: a spent window is expired-and-cleared like the
  // already-connected viewers whose hero Countdown fired onExpire — never a
  // resurrected WARM-UP OVER hold for the late joiner.
  it('recovers the lane view when the running warm-up has fully elapsed', () => {
    renderDisplay();
    deliverFrames(
      snapshotMessage([
        { timerId: 0, remainingMs: 0, isRunning: true },
        { timerId: 1, remainingMs: 90_000, isRunning: false },
        { timerId: 2, remainingMs: 90_000, isRunning: false },
      ]),
    );

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });
});

// `request_state` is answered to the WHOLE room, so a snapshot mostly answers
// somebody ELSE's join. The surface is seeded once per socket, by the first
// evidence to arrive, and only live messages move it after that — otherwise
// opening a second control panel between matches (lanes pristine, so
// `competitionBusy` is false) flips every athlete display in the venue back to
// the WARM-UP hero.
describe('FreestyleAthleteDisplay surface seeding (once per socket)', () => {
  const pendingWarmupSnapshot = snapshotMessage([
    { timerId: 0, remainingMs: 300_000, isRunning: false },
    { timerId: 1, remainingMs: 90_000, isRunning: false },
    { timerId: 2, remainingMs: 90_000, isRunning: false },
  ]);

  it('holds the lane clocks when a peer join snapshot lands on a seeded display', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John'));
    expect(screen.getByText('Jane')).toBeInTheDocument();

    deliverFrames(pendingWarmupSnapshot);

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('still takes the snapshot on a display that has heard nothing', () => {
    renderDisplay();
    deliverFrames(pendingWarmupSnapshot);

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  it('accepts one fresh seed again after a CLOSED -> OPEN reconnect', () => {
    const { repaint } = renderDisplay();
    deliverFrames(startLane(1, 60_000));

    readyState.current = 3;
    repaint();
    readyState.current = 1;
    repaint();

    deliverFrames(pendingWarmupSnapshot);

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });
});

// Once the warm-up ENDS — stopped by the operator or run out — the display
// hands off to the selected athletes' armed lanes rather than holding a stale
// WARM-UP OVER hero.
describe('FreestyleAthleteDisplay post-warm-up handoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands off to the lane layout when the operator stops the warm-up', () => {
    renderDisplay();
    deliverFrames(startLane(0, 300_000));
    deliverFrames(namesMessage('Jane', 'John'));
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    deliverFrames(stopLane(0, 120_000));

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('hands off to the lane layout when the warm-up expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    renderDisplay();
    deliverFrames(startLane(0, 1_000));
    deliverFrames(namesMessage('Jane', 'John'));
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(2_000);
      vi.advanceTimersToNextTimer();
    });

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('re-claims the warm-up surface when a new warm-up starts after a stop', () => {
    renderDisplay();
    deliverFrames(startLane(0, 300_000));
    deliverFrames(stopLane(0, 120_000));
    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();

    deliverFrames(startLane(0, 300_000));
    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });
});

describe('FreestyleAthleteDisplay shared heroes', () => {
  it('reveals the WARM-UP hero on a timerId 0 start_countdown', () => {
    renderDisplay();
    deliverFrames({
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    });

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  it('shows the best-trick hero and hides the lane layout while armed', () => {
    renderDisplay();
    deliverFrames(namesMessage('Alpha', 'Bravo'));

    deliverFrames({
      sessionId: 'worlds-2026',
      type: 'updateSelection',
      data: {
        discipline: 'freestyle',
        round: 'final',
        gender: 'male',
        matchId: null,
        athlete1Id: null,
        athlete2Id: null,
        // turn: null so the hero's turn-name line doesn't itself render "Alpha".
        bestTrick: { cap: 5, tries: { 1: 2, 2: 1 }, turn: null, clockRunning: false, rev: 0 },
      },
    });

    expect(screen.getByText('Best Trick')).toBeInTheDocument();
    expect(screen.getByText(/2\/5/)).toBeInTheDocument();
    expect(screen.queryByText(/^Alpha$/)).not.toBeInTheDocument();
  });
});

// Discipline crosstalk: both disciplines share one relay room (compId =
// sessionId), so the freestyle display must drop a Speedline board's
// selection/lane-names — otherwise the operator working the speed board reorders
// the freestyle athlete display mid-event.
describe('FreestyleAthleteDisplay discipline crosstalk', () => {
  it('ignores the speed board lane names, keeping the freestyle heroes', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John', 'freestyle'));
    expect(screen.getByText('Jane')).toBeInTheDocument();

    // A speed board sharing the room re-pushes its own lane names — they must not
    // overwrite the freestyle hero names.
    deliverFrames(namesMessage('Sprint One', 'Sprint Two', 'speed'));

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.queryByText('Sprint One')).not.toBeInTheDocument();
  });

  it('ignores a speed board selection, holding the freestyle mode', () => {
    renderDisplay();
    deliverFrames(startLane(1, 60_000));
    deliverFrames(namesMessage('Jane', 'John', 'freestyle'));
    deliverFrames(selectionMessage('quali'));
    expect(screen.queryByText('John')).not.toBeInTheDocument();

    // A speed selection carries no freestyleMode; applying it would clear quali
    // and re-split the screen. The guard drops it, so the hero stays collapsed.
    deliverFrames({
      sessionId: 'worlds-2026',
      type: 'updateSelection',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: null,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      },
    });

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
  });
});

describe('FreestyleAthleteDisplay relay session', () => {
  // The stream twin is addressed by ?compId= and its read token is scoped to
  // that compId — same contract as every /stream/* overlay (via the shared feed).
  it('opens the relay on ?compId= for the stream twin', () => {
    renderDisplay('stream', '?compId=worlds-2026&token=abc');
    expect(wsParams.current?.sessionId).toBe('worlds-2026');
    expect(wsParams.current?.readToken).toBe('abc');
  });

  it('opens the relay on ?sessionId= for the venue screen', () => {
    renderDisplay('venue', '?sessionId=worlds-2026');
    expect(wsParams.current?.sessionId).toBe('worlds-2026');
  });
});

describe('FreestyleAthleteDisplay audio-muted badge (venue-only)', () => {
  afterEach(() => {
    audioBlocked.current = false;
  });

  it('shows the badge on the venue screen while audio is blocked', () => {
    audioBlocked.current = true;
    renderDisplay('venue');
    expect(screen.getByTestId('audio-muted')).toBeInTheDocument();
  });

  it('suppresses the badge on the stream twin even when audio is blocked', () => {
    audioBlocked.current = true;
    renderDisplay('stream');
    expect(screen.queryByTestId('audio-muted')).toBeNull();
  });
});
