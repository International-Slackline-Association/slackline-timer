import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CountdownWSMessage, FreestyleSelection } from 'app/hooks/useWebSocket';

// The display opens a receiver socket for the countdown + name push. Stub it so
// no real socket opens (the realtime path is deliberately untested) and feed it
// the message under test as `lastJsonMessage`.
const { lastMessage, wsParams, readyState, playAudio, audioBlocked } = vi.hoisted(() => ({
  lastMessage: { current: null as CountdownWSMessage | null },
  wsParams: { current: null as { sessionId: string; readToken?: string } | null },
  // Mutable so a suite can drive a CLOSED -> OPEN cycle: the feed re-seeds its
  // surface once per socket, which is only observable across a reconnect.
  readyState: { current: 1 },
  playAudio: vi.fn(),
  audioBlocked: { current: false },
}));
vi.mock('app/hooks/useWebSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/hooks/useWebSocket')>();
  return {
    ...actual,
    useWS: (params: { sessionId: string; readToken?: string }) => {
      wsParams.current = params;
      return {
        lastJsonMessage: lastMessage.current,
        readyState: readyState.current,
        sendWSMessage: vi.fn(),
      };
    },
  };
});

// The standings panel renders RankingsBody (freestyle Score plane). Stub it with
// a sentinel so we can assert WHETHER the panel is shown for a given round/gender
// without standing up the rankings query.
vi.mock('app/pages/Stream/RankingsOverlay', () => ({
  RankingsBody: () => <div data-testid="standings" />,
}));

// Capture the PA-feed beeps without standing up the real audio elements.
vi.mock('app/hooks/useSignalAudio', () => ({
  useSignalAudio: () => ({ audioElement: null, playAudio, audioBlocked: audioBlocked.current }),
}));

// The lane banners (AthleteNameStrip) resolve the board's selection athlete ids
// through this React Query hook; stub it with a fixed roster so the tests drive
// banners purely off updateSelection without a data plane.
vi.mock('app/hooks/useAthleteLookup', () => {
  const make = (athleteId: string, firstName: string, lastName: string, country: string) => ({
    athleteId,
    compId: 'worlds-2026',
    name: `${firstName} ${lastName}`,
    firstName,
    lastName,
    birthDate: '1990-01-01',
    country,
    gender: 'female' as const,
  });
  const ROSTER: Record<string, ReturnType<typeof make>> = {
    a1: make('a1', 'Jane', 'Doe', 'FRA'),
    a2: make('a2', 'John', 'Smith', 'DEN'),
    a3: make('a3', 'Aiko', 'Tanaka', 'JPN'),
    a4: make('a4', 'Bruno', 'Silva', 'BRA'),
  };
  return {
    useAthleteLookup: () => ({
      byId: (id?: string | null) => (id ? ROSTER[id] : undefined),
      athletes: { data: Object.values(ROSTER), isPending: false },
    }),
  };
});

import { FreestyleTimerDisplay } from 'app/pages/Freestyle/FreestyleTimerDisplay';

const tree = (
  client: QueryClient,
  variant: 'projector' | 'broadcast',
  search = '?sessionId=worlds-2026',
) => (
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/freestyle/preview${search}`]}>
      <FreestyleTimerDisplay variant={variant} />
    </MemoryRouter>
  </QueryClientProvider>
);

// `repaint` re-renders the same display so a freshly-set lastMessage flows in —
// standing in for a message arriving over the (mocked) socket. The QueryClient is
// created ONCE per display: a fresh one per repaint changes the feed's message
// effect dependency, which silently re-applies the last message on every render.
const renderDisplay = (variant: 'projector' | 'broadcast' = 'projector', search?: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(client, variant, search));
  return { ...view, repaint: () => view.rerender(tree(client, variant, search)) };
};

// The board's live selection assigns the lane athletes (the banners resolve the
// ids through the mocked roster above); `freestyleMode` rides the same message.
const laneAthletesMessage = (
  athlete1Id: string | null,
  athlete2Id: string | null,
  freestyleMode?: 'quali' | 'battle',
): CountdownWSMessage => ({
  sessionId: 'worlds-2026',
  type: 'updateSelection',
  data: {
    discipline: 'freestyle',
    round: 'final',
    gender: 'male',
    matchId: null,
    athlete1Id,
    athlete2Id,
    freestyleMode,
  },
});

// A fresh display starts on the warm-up (athlete-display-warmup-default), which
// on this band surface occupies lane 1's left-corner slot alone — the athlete
// lane row only shows once warm-up ends. Stopping the warm-up channel (timerId
// 0) hands off to the lanes without touching lane state, so tests that assert on
// the lane band open past this first.
const endWarmupMessage: CountdownWSMessage = {
  sessionId: 'worlds-2026',
  type: 'stop_countdown',
  timerId: 0,
  data: { remainingMs: 0 },
};

// Render already handed off from warm-up to the lane band, then apply the message
// under test.
const renderPastWarmup = (
  msg: CountdownWSMessage | null,
  variant: 'projector' | 'broadcast' = 'projector',
  search?: string,
) => {
  lastMessage.current = endWarmupMessage;
  const view = renderDisplay(variant, search);
  lastMessage.current = msg;
  view.repaint();
  return view;
};

describe('FreestyleTimerDisplay lane athlete banners', () => {
  it('renders the two lane banners from the board selection (flag+name strip)', () => {
    renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  // The /stream/timer-freestyle OBS overlay mounts the same display via the
  // `broadcast` variant — the banner path must light up there too (STATUS smoke).
  it('renders the two lane banners on the broadcast overlay variant', () => {
    renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'broadcast');

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  // A reconnecting preview gets the selection re-pushed (control re-sends on
  // sender-socket OPEN); from the receiver's side that is just another
  // updateSelection, which must repaint the banners. Re-rendering with a fresh
  // message stands in for the post-reconnect re-push.
  it('repaints the banners when the selection is re-pushed after a reconnect', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    expect(screen.getByText('Jane')).toBeInTheDocument();

    lastMessage.current = laneAthletesMessage('a3', 'a4');
    repaint();

    expect(screen.getByText('Aiko')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.queryByText('Jane')).not.toBeInTheDocument();
  });

  // Lane athletes are intentionally NOT cleared on reset_countdown (the
  // selection persists across runs of the same run).
  it('keeps the banners through a reset_countdown', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 1,
      data: { remainingMs: 60_000 },
    };
    repaint();

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('shows no banner for an unassigned lane', () => {
    renderPastWarmup(laneAthletesMessage('a1', null), 'projector');

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
  });
});

describe('FreestyleTimerDisplay relay session', () => {
  // Regression: the broadcast overlay is addressed by ?compId= and its read token
  // is scoped to that compId. The display must open its WS on compId, not the
  // "default" sessionId fallback that made the $connect authorizer reject the
  // handshake and blank the overlay.
  it('opens the relay on ?compId= for the broadcast overlay', () => {
    lastMessage.current = null;
    renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    expect(wsParams.current?.sessionId).toBe('worlds-2026');
    expect(wsParams.current?.readToken).toBe('abc');
  });

  it('opens the relay on ?sessionId= for the projector', () => {
    lastMessage.current = null;
    renderDisplay('projector', '?sessionId=worlds-2026');
    expect(wsParams.current?.sessionId).toBe('worlds-2026');
  });
});

describe('FreestyleTimerDisplay standings panel', () => {
  it('shows the standings for a valid freestyle (Match) round', () => {
    lastMessage.current = null;
    renderDisplay('projector', '?sessionId=worlds-2026&round=final&gender=male');
    expect(screen.getByTestId('standings')).toBeInTheDocument();
  });

  it('hides the standings for `training` — not a freestyle (Score-plane) round', () => {
    // The panel queries the Score plane (discipline="freestyle"), which reuses
    // MATCH_ROUNDS. `training` is a Time-plane-only round, so it must NOT validate.
    lastMessage.current = null;
    renderDisplay('projector', '?sessionId=worlds-2026&round=training&gender=male');
    expect(screen.queryByTestId('standings')).not.toBeInTheDocument();
  });
});

// ADR 0036: the board's explicit mode rides updateSelection; quali collapses
// the lane row to a single centred hero (lane 1).
describe('FreestyleTimerDisplay quali single-hero collapse', () => {
  it('renders only the lane 1 hero when the board says quali', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');
    expect(screen.getByText('John')).toBeInTheDocument();

    lastMessage.current = laneAthletesMessage('a1', 'a2', 'quali');
    repaint();

    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.queryByText('John')).not.toBeInTheDocument();
  });

  it('restores the two-lane row when the board switches back to battle', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    lastMessage.current = laneAthletesMessage('a1', 'a2', 'quali');
    repaint();
    expect(screen.queryByText('John')).not.toBeInTheDocument();

    lastMessage.current = laneAthletesMessage('a1', 'a2', 'battle');
    repaint();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  it('keeps the two-lane default when the selection carries no mode (pre-0036 board)', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    lastMessage.current = laneAthletesMessage('a1', 'a2', undefined);
    repaint();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });
});

describe('FreestyleTimerDisplay warm-up band slot', () => {
  it('reveals the WARM-UP slot on a timerId 0 start_countdown', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };

    renderDisplay();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });

  // STATUS athlete-display-warmup-default: the shared feed holds the warm-up
  // phase until it finishes or a competition action takes over, so a display the
  // room has seeded shows the pending warm-up (not only one that already
  // started) — here off the operator's re-arm.
  it('shows the pending warm-up slot once the room seeds it', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };
    renderDisplay();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  // fsux-preview-warmup-seed: OPEN and preview-enabled, but nothing has arrived
  // — no snapshot, no countdown message. The band paints EMPTY rather than the
  // defaults' fabricated `WARM-UP 00:00`: on air a wrong number is worse than
  // none, and the gap is what tells the operator to look.
  it('renders no clock at all while the surface is unseeded', () => {
    lastMessage.current = null;
    renderDisplay();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  // broadcast-warmup-hero-shows-zero-precompetition: a late-joining display
  // recovers the pending (armed, not-yet-started) warm-up budget from the
  // control's state_snapshot and shows the real time-to-go — not "00:00", which
  // on-air reads as an already-expired warm-up. The snapshot carries the idle
  // warm-up's armed remainingMs (buildCountdownSnapshot with isRunning:false), the
  // feed maps it into recovery[0], and the warm-up slot's Countdown renders it.
  it('shows the armed warm-up budget from a pre-competition snapshot (not 00:00)', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'state_snapshot',
      data: {
        isPreviewEnabled: true,
        // Warm-up armed at 05:00 but not started; both lanes armed (>0) so the
        // competition is not yet under way and the pending warm-up stays surfaced.
        timers: [
          { timerId: 0, remainingMs: 300_000, isRunning: false },
          { timerId: 1, remainingMs: 60_000, isRunning: false },
          { timerId: 2, remainingMs: 60_000, isRunning: false },
        ],
      },
    } as unknown as CountdownWSMessage;

    renderDisplay();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  // preview-warmup-only-clock: during warm-up the band shows ONLY the warm-up
  // slot — the athlete lane row (clocks + banners) must not leak beside it.
  it('hides the athlete lane row while the warm-up slot is active', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };
    const { repaint } = renderDisplay('projector');
    lastMessage.current = laneAthletesMessage('a1', 'a2');
    repaint();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.queryByText(/^Jane$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^John$/)).not.toBeInTheDocument();
  });

  it('drops the warm-up slot once a lane run starts', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };
    const { repaint } = renderDisplay();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 1,
      data: { remainingMs: 90_000 },
    };
    repaint();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  // STATUS athlete-display-post-warmup-handoff: the shared feed hands off to the
  // lanes when the warm-up ENDS (stopped or run out), not only on the next run.
  it('drops the warm-up slot when the operator stops the warm-up', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };
    const { repaint } = renderDisplay();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'stop_countdown',
      timerId: 0,
      data: { remainingMs: 120_000 },
    };
    repaint();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  // The frozen-02:00 regression (realtime-recovery freestyle-family): a fresh
  // preview recovers IDLE lane rows from the join-time snapshot while the
  // warm-up slot owns the band (the lane clocks are unmounted). When the
  // operator then starts a lane directly (warm-up never run — the everyday
  // flow), the lane clock mounts on that very message; on mount BOTH inputs
  // apply in declaration order — live message first, recovery last — so the
  // stale idle row would clobber the live start and the clock sits frozen at the
  // armed budget for the whole run. The feed must drop a lane's recovered row
  // when a live lane message supersedes it.
  it('mounts the lane clock ticking when a run starts under the warm-up slot (stale recovery dropped)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'state_snapshot',
      data: {
        isPreviewEnabled: true,
        // Warm-up armed (pending) → the warm-up slot owns the band; both lanes
        // idle at their armed budgets → recovery holds idle rows for them.
        timers: [
          { timerId: 0, remainingMs: 300_000, isRunning: false },
          { timerId: 1, remainingMs: 120_000, isRunning: false },
          { timerId: 2, remainingMs: 60_000, isRunning: false },
        ],
      },
    } as unknown as CountdownWSMessage;
    const { repaint } = renderDisplay();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    // The operator starts lane 1 directly — the warm-up slot hands off and the
    // lane clock mounts from this live message (shared wire epoch = now).
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 1,
      data: { remainingMs: 120_000, startedAt: 0 },
    };
    repaint();
    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();

    act(() => {
      vi.setSystemTime(5_000);
      // Advancing to the 1s display tick moves the mocked clock with it, so the
      // tick derives 6s elapsed off the wire anchor (formatClock floors).
      vi.advanceTimersToNextTimer();
    });

    // Ticking off the live start — not the snapshot's stale idle 02:00. (The
    // numeral renders twice: the hidden reserved break row mirrors it.)
    expect(screen.getAllByText('01:54').length).toBeGreaterThan(0);
    expect(screen.queryByText('02:00')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('drops the warm-up slot when the warm-up expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 1_000 },
    };
    renderDisplay();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    // The warm-up slot's own Countdown crosses zero and its onExpire hands off
    // (no repaint: a rerender would mint a fresh QueryClient and re-process the
    // retained start message — a test-only artifact of the per-render client).
    act(() => {
      vi.setSystemTime(2_000);
      vi.advanceTimersToNextTimer();
    });

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

// fsux-preview-warmup-seed: snapshot-vs-live precedence is PER CHANNEL. One
// board-wide "something spoke" flag threw the whole recovery away, so a
// `Set both lanes` reset on a performance lane discarded the warm-up row that
// was the only thing standing between the projector and a fabricated
// `WARM-UP 00:00`.
describe('FreestyleTimerDisplay per-channel snapshot seeding', () => {
  const resetLane = (timerId: number, remainingMs: number): CountdownWSMessage => ({
    sessionId: 'worlds-2026',
    type: 'reset_countdown',
    timerId,
    data: { remainingMs },
  });

  const snapshot = (
    timers: Array<{ timerId: number; remainingMs: number; isRunning: boolean; armedMs?: number }>,
  ): CountdownWSMessage =>
    ({
      sessionId: 'worlds-2026',
      type: 'state_snapshot',
      data: { isPreviewEnabled: true, timers },
    }) as unknown as CountdownWSMessage;

  // The row rule is per channel and INDEPENDENT of the surface rule (which is
  // seeded once per socket — see the surface-seeding suite): lane 2 spoke, so
  // its live 01:00 stands against the snapshot's 00:30, while the still-silent
  // lane 1 takes the snapshot's 02:00 instead of resting at a fabricated 00:00.
  it('applies a silent channel row even though lane 2 spoke since the socket opened', () => {
    lastMessage.current = resetLane(2, 60_000);
    const { repaint } = renderDisplay();

    lastMessage.current = snapshot([
      { timerId: 0, remainingMs: 300_000, isRunning: false },
      { timerId: 1, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
      { timerId: 2, remainingMs: 30_000, isRunning: false, armedMs: 60_000 },
    ]);
    repaint();

    expect(screen.getByText('02:00')).toBeInTheDocument();
    expect(screen.getByText('01:00')).toBeInTheDocument();
    expect(screen.queryByText('00:30')).not.toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('shows the athlete band when the joined room has already warmed up', () => {
    // `Set both lanes` — reset traffic on lanes 1/2 — races the control's reply
    // to this display's request_state.
    lastMessage.current = resetLane(1, 60_000);
    const { repaint } = renderDisplay();
    lastMessage.current = resetLane(2, 60_000);
    repaint();
    lastMessage.current = laneAthletesMessage('a1', 'a2');
    repaint();

    lastMessage.current = snapshot([
      // The warm-up already ran earlier in the session (spent), the lanes are
      // armed for the next match.
      { timerId: 0, remainingMs: 0, isRunning: false },
      { timerId: 1, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
      { timerId: 2, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
    ]);
    repaint();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getAllByText('01:00').length).toBe(2);
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  // The armed-budget evidence (ADR 0046 §2): a lane holding less than its
  // `armedMs` is a match in progress, so a joiner must not paint the pending
  // warm-up hero over the athletes.
  it('keeps the athlete band when a snapshot lane holds less than its armed budget', () => {
    lastMessage.current = snapshot([
      { timerId: 0, remainingMs: 300_000, isRunning: false },
      { timerId: 1, remainingMs: 22_000, isRunning: false, armedMs: 60_000 },
      { timerId: 2, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
    ]);
    renderDisplay();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
    expect(screen.getByText('00:22')).toBeInTheDocument();
  });
});

// fsux-preview-surface-peer-snapshot: `request_state` is answered to the WHOLE
// room, so most snapshots a long-lived projector receives answer somebody else's
// join. The SURFACE is therefore seeded once per socket, by the first evidence to
// arrive, and only live messages move it thereafter — otherwise opening a second
// control panel between matches (lanes pristine, so `competitionBusy` is false)
// flips every projector in the venue back to `WARM-UP 05:00`.
describe('FreestyleTimerDisplay surface seeding (once per socket)', () => {
  afterEach(() => {
    readyState.current = 1;
    lastMessage.current = null;
  });

  const pendingWarmupSnapshot: CountdownWSMessage = {
    sessionId: 'worlds-2026',
    type: 'state_snapshot',
    data: {
      isPreviewEnabled: true,
      timers: [
        { timerId: 0, remainingMs: 300_000, isRunning: false },
        { timerId: 1, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
        { timerId: 2, remainingMs: 60_000, isRunning: false, armedMs: 60_000 },
      ],
    },
  } as unknown as CountdownWSMessage;

  const startLane = (timerId: number, remainingMs: number): CountdownWSMessage => ({
    sessionId: 'worlds-2026',
    type: 'start_countdown',
    timerId,
    data: { remainingMs },
  });

  it('keeps the lane band when a peer join snapshot lands on a seeded display', () => {
    lastMessage.current = startLane(1, 60_000);
    const { repaint } = renderDisplay();
    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();

    lastMessage.current = pendingWarmupSnapshot;
    repaint();

    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('still takes the snapshot on a display that has heard nothing', () => {
    lastMessage.current = pendingWarmupSnapshot;
    renderDisplay();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  it('accepts one fresh seed again after a CLOSED -> OPEN reconnect', () => {
    lastMessage.current = startLane(1, 60_000);
    const { repaint } = renderDisplay();

    readyState.current = 3;
    repaint();
    readyState.current = 1;
    repaint();

    lastMessage.current = pendingWarmupSnapshot;
    repaint();

    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });
});

// fsux-preview-lane-remount-seed: the lane Countdowns are unmounted while the
// warm-up hero holds the band, so the arm messages that precede the first Start
// land with nothing to apply them to — and a fresh mount cannot replay them. The
// feed keeps each lane's row refreshed from its own last message, the way the
// try channel already does, so the mount seeds from it.
describe('FreestyleTimerDisplay lane row refresh', () => {
  const laneMessage = (
    type: 'start_countdown' | 'reset_countdown',
    timerId: number,
    remainingMs: number,
  ): CountdownWSMessage => ({
    sessionId: 'worlds-2026',
    type,
    timerId,
    data: { remainingMs, ...(type === 'start_countdown' ? { startedAt: Date.now() } : {}) },
  });

  it('opens the idle lane on its armed budget when the warm-up hero clears', () => {
    lastMessage.current = laneMessage('start_countdown', 0, 300_000);
    const { repaint } = renderDisplay();

    // Both lanes are armed behind the running warm-up hero (distinct budgets so
    // the assertions cannot confuse them).
    lastMessage.current = laneMessage('reset_countdown', 1, 120_000);
    repaint();
    lastMessage.current = laneMessage('reset_countdown', 2, 90_000);
    repaint();
    expect(screen.getByText('Warm-up')).toBeInTheDocument();
    expect(screen.queryByText('01:30')).not.toBeInTheDocument();

    // The first Start of the match hands the band to the lanes, mounting both
    // clocks: lane 1 off the message it just received, lane 2 off its row.
    lastMessage.current = laneMessage('start_countdown', 1, 120_000);
    repaint();

    expect(screen.getByText('02:00')).toBeInTheDocument();
    expect(screen.getByText('01:30')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });
});

// Battle part 2 (rule F6): best trick keeps the match band layout — the lane
// banners stay, the try clock (timerId 3) rides the turn athlete's side under a
// BEST TRICK label, and the tries tally paints the centre only between tries.
describe('FreestyleTimerDisplay best-trick band', () => {
  afterEach(() => playAudio.mockClear());

  const bestTrickMessage = (
    bestTrick: NonNullable<FreestyleSelection['bestTrick']> | null,
  ): Extract<CountdownWSMessage, { type: 'updateSelection' }> => ({
    sessionId: 'worlds-2026',
    type: 'updateSelection',
    data: {
      discipline: 'freestyle',
      round: 'final',
      gender: 'male',
      matchId: null,
      // The board keeps the lane athletes selected through the best-trick
      // phase — the hero must suppress the band, not an emptied selection.
      athlete1Id: 'a1',
      athlete2Id: 'a2',
      bestTrick: bestTrick ?? undefined,
    },
  });

  it("shows each player's round count on both banners (no centre tally)", () => {
    lastMessage.current = bestTrickMessage({
      cap: 5,
      tries: { 1: 2, 2: 1 },
      turn: 1,
      clockRunning: false,
    });

    renderDisplay('projector');

    // Both lanes' banners carry their own "Best Trick <tries>/<cap>" for the
    // whole session (only the clock follows the turn); the old centre tally
    // (which duplicated the athlete names) is gone.
    expect(screen.getByText('Best Trick 2/5')).toBeInTheDocument();
    expect(screen.getByText('Best Trick 1/5')).toBeInTheDocument();
    // The match band layout stays up — best trick no longer suppresses the
    // banners the way the old full-screen hero did.
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
  });

  // LWW seq (ADR 0038 §4), one hop further out: the losing side of a crossed
  // panel edit arriving late must not clear a fresher tally off the hero.
  it('ignores a stale-stamped selection (last-writer-wins by seq)', () => {
    lastMessage.current = {
      ...bestTrickMessage({ cap: 5, tries: { 1: 2, 2: 1 }, turn: 1, clockRunning: false }),
      senderId: 'panel-b',
      seq: 100,
    };
    const { repaint } = renderDisplay('projector');
    expect(screen.getByText('Best Trick 2/5')).toBeInTheDocument();

    lastMessage.current = { ...bestTrickMessage(null), senderId: 'panel-c', seq: 99 };
    repaint();

    expect(screen.getByText('Best Trick 2/5')).toBeInTheDocument();
  });

  it('swaps the lane run clocks for the best-trick layout, keeping the banners', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    // Arm lane 1 with a distinctive budget so its clock is tellable from the
    // try clock.
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 1,
      data: { remainingMs: 120_000 },
    };
    repaint();
    expect(screen.getAllByText('02:00').length).toBeGreaterThan(0);

    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 0, 2: 0 },
      turn: null,
      clockRunning: false,
    });
    repaint();

    // Both banners keep their round count for the whole session (even with no
    // active turn). The name banners stay (match layout), but the lane run clocks
    // are gone — and with the series idle (turn null) no try clock renders.
    expect(screen.getAllByText('Best Trick 0/3')).toHaveLength(2);
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.queryByText('02:00')).not.toBeInTheDocument();
  });

  it('clears the best-trick layout when bestTrick goes absent (phase disarmed)', () => {
    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 0, 2: 0 },
      turn: 1,
      clockRunning: false,
    });
    const { repaint } = renderDisplay('projector');
    expect(screen.getAllByText('Best Trick 0/3')).toHaveLength(2);

    lastMessage.current = bestTrickMessage(null);
    repaint();
    expect(screen.queryByText(/Best Trick/)).not.toBeInTheDocument();
  });

  it('shows the try clock under the turn athlete once the board arms the window', () => {
    const { repaint } = renderPastWarmup(
      bestTrickMessage({ cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: false }),
      'projector',
    );

    // The board's ARM broadcast resets the try channel to the 30 s window; the
    // mounted try clock adopts it (the selection push precedes this reset on the
    // acting panel, so the clock is already mounted when it lands).
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 3,
      data: { remainingMs: 30_000 },
    };
    repaint();

    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  // The QA-found remount race: the try clock REMOUNTS in the other lane's
  // column when the turn flips, and the fresh mount can never replay the clock
  // message that preceded it. The feed keeps recovery[3] refreshed from every
  // live timerId-3 message (nextRecovery) so the remount seeds the frozen
  // value instead of resting at the UNSEEDED 00:00.
  it('keeps the try-clock value across a turn flip (remount reseeds from the row)', () => {
    const { repaint } = renderPastWarmup(
      bestTrickMessage({ cap: 3, tries: { 1: 0, 2: 0 }, turn: 1, clockRunning: false }),
      'projector',
    );

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 3,
      data: { remainingMs: 30_000, startedAt: Date.now() },
    };
    repaint();
    // END_TRY resets the wire clock to the full window (the next athlete gets a
    // fresh window, not the leftover), so recovery[3] now holds 30 s.
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'reset_countdown',
      timerId: 3,
      data: { remainingMs: 30_000 },
    };
    repaint();
    expect(screen.getByText('00:30')).toBeInTheDocument();

    // The turn flips: the clock moves under the lane 2 banner and, reseeded from
    // the row, shows the full start window (not a leftover, not 00:00).
    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 1, 2: 0 },
      turn: 2,
      clockRunning: false,
    });
    repaint();

    expect(screen.getByText('00:30')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  // The QA-found reconciliation leak: without distinct keys React repurposes
  // the try-clock Countdown instance into the lane clock on disarm (same
  // element type + position), carrying the frozen try remaining across the
  // timerId swap.
  it('does not leak the try-clock state into the lane clocks on disarm', () => {
    const { repaint } = renderPastWarmup(laneAthletesMessage('a1', 'a2'), 'projector');

    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 0, 2: 0 },
      turn: 2,
      clockRunning: false,
    });
    repaint();
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'stop_countdown',
      timerId: 3,
      data: { remainingMs: 27_000 },
    };
    repaint();
    expect(screen.getByText('00:27')).toBeInTheDocument();

    lastMessage.current = bestTrickMessage(null);
    repaint();

    expect(screen.queryByText('00:27')).not.toBeInTheDocument();
    expect(screen.queryByText('Best Trick')).not.toBeInTheDocument();
  });

  // No wire message rides a TRY_TIMEOUT (bestTrickSeries): the display's own
  // Countdown crosses zero. The feed rests the try row at zero (endTryWindow)
  // so the turn-flip remount seeds the spent window — replaying the running
  // anchor would re-fire the expiry beep ~1s after the remount. The try window
  // shares its `short` with the try-start ack (§4.2), so this counts the delta
  // across the flip rather than an absolute total.
  it('does not replay the try-end beep when the turn flips after a local try timeout', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { repaint } = renderPastWarmup(
      bestTrickMessage({ cap: 3, tries: { 1: 1, 2: 0 }, turn: 1, clockRunning: true }),
      'projector',
    );

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 3,
      data: { remainingMs: 1_000, startedAt: 0 },
    };
    repaint();

    act(() => {
      vi.setSystemTime(2_000);
      vi.advanceTimersToNextTimer();
    });
    // The expiry label was removed — a timed-out window shows the red 00:00 alone.
    expect(screen.getByText('00:00')).toBeInTheDocument();
    // The try window's own tone (§4.2 four-tone map), never the run-zero `long`.
    expect(playAudio.mock.calls.filter(([sound]) => sound === 'long')).toHaveLength(0);
    const afterTimeout = playAudio.mock.calls.filter(([sound]) => sound === 'short').length;
    expect(afterTimeout).toBeGreaterThan(0);

    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 1, 2: 0 },
      turn: 2,
      clockRunning: false,
    });
    repaint();
    act(() => {
      vi.setSystemTime(4_000);
      vi.advanceTimersToNextTimer();
    });

    expect(playAudio.mock.calls.filter(([sound]) => sound === 'short')).toHaveLength(afterTimeout);
    vi.useRealTimers();
  });

  it('keeps the round count on the turn banner while the try window runs', () => {
    const { repaint } = renderPastWarmup(
      bestTrickMessage({ cap: 3, tries: { 1: 1, 2: 0 }, turn: 1, clockRunning: true }),
      'projector',
    );

    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 3,
      data: { remainingMs: 30_000 },
    };
    repaint();

    // The turn banner keeps its "Best Trick <tries>/<cap>" count during the run
    // (there is no centre tally to hide); the running try clock shows alongside.
    expect(screen.getByText('Best Trick 1/3')).toBeInTheDocument();
    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('takes precedence over a stale warm-up slot', () => {
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 0,
      data: { remainingMs: 300_000 },
    };
    const { repaint } = renderDisplay('projector');
    expect(screen.getByText('Warm-up')).toBeInTheDocument();

    lastMessage.current = bestTrickMessage({
      cap: 3,
      tries: { 1: 0, 2: 0 },
      turn: 1,
      clockRunning: true,
    });
    repaint();
    expect(screen.getAllByText('Best Trick 0/3')).toHaveLength(2);
    expect(screen.queryByText('Warm-up')).not.toBeInTheDocument();
  });

  it('plays the short beep when a best-trick try starts (timerId 3)', () => {
    playAudio.mockClear();
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 3,
      data: { remainingMs: 30_000 },
    };

    renderDisplay('projector');

    expect(playAudio).toHaveBeenCalledWith('short');
  });
});

// Rule F7: the venue PA feed must not go silent when a performance run clock
// hits zero — the preview lanes beep on run-zero like warm-up/break expiry.
describe('FreestyleTimerDisplay run-zero beep', () => {
  afterEach(() => {
    vi.useRealTimers();
    playAudio.mockClear();
  });

  it('plays the long beep when a performance lane run reaches zero', () => {
    playAudio.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    lastMessage.current = {
      sessionId: 'worlds-2026',
      type: 'start_countdown',
      timerId: 1,
      data: { remainingMs: 2_000 },
    };

    renderDisplay('projector');

    // A start_countdown for a performance lane (timerId ≠ 0) rings no beep on its
    // own; the only 'long' call must come from the run crossing zero.
    expect(playAudio).not.toHaveBeenCalled();
    act(() => {
      vi.setSystemTime(3_000);
      vi.advanceTimersToNextTimer();
    });
    expect(playAudio).toHaveBeenCalledWith('long');
  });
});

describe('FreestyleTimerDisplay audio-muted badge (projector-only)', () => {
  afterEach(() => {
    audioBlocked.current = false;
  });

  // The badge exists to surface a muted projector rig whose beeps feed the venue
  // PA. On the broadcast overlay it is pure clutter composited over live video and
  // is suppressed regardless of the (irrelevant) tab audio state.
  it('shows the badge on the projector while audio is blocked', () => {
    lastMessage.current = null;
    audioBlocked.current = true;
    renderDisplay('projector');
    expect(screen.getByTestId('audio-muted')).toBeInTheDocument();
  });

  it('suppresses the badge on the broadcast overlay even when audio is blocked', () => {
    lastMessage.current = null;
    audioBlocked.current = true;
    renderDisplay('broadcast');
    expect(screen.queryByTestId('audio-muted')).toBeNull();
  });
});

// xmode-freestyle-preview-foreign-snapshot: `compId` doubles as BOTH modes'
// relay session, so a Speedline control sharing the room answers this display's
// `request_state` too — with a SpeedlineSnapshot, which has no per-lane
// `remainingMs`. The feed already drops it for STATE (isCountdownSnapshot), but
// it was still forwarded verbatim as `countdownMessage`, so it reached every
// lane clock's `message` prop. Pinned here because the band is what the
// `cross-mode-snapshot` driver leg reads.
describe('FreestyleTimerDisplay cross-mode snapshot tolerance', () => {
  const armedLanes: CountdownWSMessage = {
    sessionId: 'worlds-2026',
    type: 'state_snapshot',
    data: {
      isPreviewEnabled: true,
      timers: [
        // Warm-up already spent, so the band hands off to the lane row.
        { timerId: 0, remainingMs: 0, isRunning: false },
        { timerId: 1, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
        { timerId: 2, remainingMs: 120_000, isRunning: false, armedMs: 120_000 },
      ],
    },
  } as unknown as CountdownWSMessage;

  // The shape that mis-renders if applied: a RUNNING Speedline lane, no
  // `remainingMs` anywhere (the driver's `foreignSpeedlineSnapshot`).
  const foreignSpeedlineSnapshot: CountdownWSMessage = {
    sessionId: 'worlds-2026',
    type: 'state_snapshot',
    data: {
      isPreviewEnabled: true,
      signalPhase: 0,
      text: '',
      timers: [
        { timerId: 1, startTime: 1_000, stopTime: null },
        { timerId: 2, startTime: null, stopTime: null },
      ],
    },
  } as unknown as CountdownWSMessage;

  it('keeps both idle lane clocks when a foreign Speedline snapshot lands last', () => {
    lastMessage.current = armedLanes;
    const { repaint } = renderDisplay();
    expect(screen.getAllByText('02:00').length).toBe(2);

    lastMessage.current = foreignSpeedlineSnapshot;
    repaint();

    expect(screen.getAllByText('02:00').length).toBe(2);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
