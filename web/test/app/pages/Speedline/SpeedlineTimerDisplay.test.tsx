import { render, screen, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StopwatchWSMessage } from 'app/hooks/useWebSocket';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';

// Stub the receiver socket so no real socket opens (the realtime path is
// deliberately untested) and capture the params it connects with. `readyState`
// defaults to OPEN so the display renders its idle clock.
const { lastMessage, wsParams, readyState, audioBlocked, playAudioMock } = vi.hoisted(() => ({
  lastMessage: { current: null as StopwatchWSMessage | null },
  wsParams: { current: null as { sessionId: string; readToken?: string } | null },
  readyState: { current: 1 },
  audioBlocked: { current: false },
  playAudioMock: vi.fn(),
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

// The lane banner (AthleteNameStrip) resolves athletes through this React Query
// hook; these tests assert WS/badge/recovery, not the banner, so stub it (no
// QueryClientProvider needed). An empty lookup renders no banner — fine here.
vi.mock('app/hooks/useAthleteLookup', () => ({
  useAthleteLookup: () => ({ byId: () => undefined, athletes: { data: [], isPending: false } }),
}));

// Drive the AUDIO MUTED badge off a controllable `audioBlocked` without standing
// up the real audio elements / unlock gesture.
vi.mock('app/hooks/useSignalAudio', () => ({
  useSignalAudio: () => ({
    audioElement: null,
    playAudio: playAudioMock,
    audioBlocked: audioBlocked.current,
  }),
}));

import { SpeedlineTimerDisplay } from 'app/pages/Speedline/SpeedlineTimerDisplay';
import { OVERLAY_LANE } from 'app/pages/Stream/TimerLaneBlock';

import { pinViewport, px } from '../../../util/computedUnits';

const renderDisplay = (variant: 'projector' | 'broadcast', search: string) =>
  render(
    <MemoryRouter initialEntries={[`/route${search}`]}>
      <SpeedlineTimerDisplay variant={variant} />
    </MemoryRouter>,
  );

describe('SpeedlineTimerDisplay relay session', () => {
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

describe('SpeedlineTimerDisplay state recovery', () => {
  // Regression (preview-falsestart-text-recovery): a projector that joins AFTER a
  // false start fires misses the live `updateText`, so its only route to the
  // "FALSE START" callout is the `request_state` → `state_snapshot` reply. Assert
  // the snapshot's persisted `text` is repainted, not just the timer lanes.
  it('repaints the persisted text from a state_snapshot on late join', () => {
    lastMessage.current = null;
    readyState.current = 1; // OPEN — the OPEN effect clears liveSinceOpen + requests state
    const { rerender } = renderDisplay('projector', '?sessionId=worlds-2026');
    expect(screen.queryByText('FALSE START')).toBeNull();

    // The operator's snapshot reply arrives (no live updateText was seen since open).
    act(() => {
      lastMessage.current = {
        type: 'state_snapshot',
        sessionId: 'worlds-2026',
        data: {
          isPreviewEnabled: true,
          signalPhase: -1,
          text: 'FALSE START',
          timers: [
            { timerId: 1, startTime: null, stopTime: null },
            { timerId: 2, startTime: null, stopTime: null },
          ],
        },
      };
      rerender(
        <MemoryRouter initialEntries={['/route?sessionId=worlds-2026']}>
          <SpeedlineTimerDisplay variant="projector" />
        </MemoryRouter>,
      );
    });

    expect(screen.getByText('FALSE START')).toBeInTheDocument();
  });
});

describe('SpeedlineTimerDisplay false-start badge (rules S2–S4)', () => {
  const renderWithMessage = (msg: StopwatchWSMessage) => {
    lastMessage.current = null;
    readyState.current = 1;
    const { rerender } = renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    act(() => {
      lastMessage.current = msg;
      rerender(
        <MemoryRouter initialEntries={['/route?compId=worlds-2026&token=abc']}>
          <SpeedlineTimerDisplay variant="broadcast" />
        </MemoryRouter>,
      );
    });
  };

  it('renders a lane badge from the board selection (2nd FS on lane 1)', () => {
    renderWithMessage({
      type: 'updateSelection',
      sessionId: 'worlds-2026',
      data: {
        discipline: 'speed',
        round: 'final',
        gender: 'male',
        matchId: 'm1',
        athlete1Id: 'a1',
        athlete2Id: 'a2',
        falseStarts: { 1: 2, 2: 0 },
      },
    });
    expect(screen.getByText(/2nd false start/i)).toBeInTheDocument();
  });

  // LWW seq (ADR 0038 §4), one hop further out: the losing side of a crossed
  // panel edit arriving late must not clear a fresher flag off the display.
  it('ignores a stale-stamped selection (last-writer-wins by seq)', () => {
    lastMessage.current = null;
    readyState.current = 1;
    const { rerender } = renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    const selectionData = {
      discipline: 'speed' as const,
      round: 'final' as const,
      gender: 'male' as const,
      matchId: 'm1',
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    const repaint = () =>
      rerender(
        <MemoryRouter initialEntries={['/route?compId=worlds-2026&token=abc']}>
          <SpeedlineTimerDisplay variant="broadcast" />
        </MemoryRouter>,
      );

    act(() => {
      lastMessage.current = {
        type: 'updateSelection',
        sessionId: 'worlds-2026',
        senderId: 'panel-b',
        seq: 100,
        data: { ...selectionData, falseStarts: { 1: 2, 2: 0 } },
      };
      repaint();
    });
    expect(screen.getByText(/2nd false start/i)).toBeInTheDocument();

    act(() => {
      lastMessage.current = {
        type: 'updateSelection',
        sessionId: 'worlds-2026',
        senderId: 'panel-c',
        seq: 99,
        data: { ...selectionData, falseStarts: { 1: 0, 2: 0 } },
      };
      repaint();
    });
    expect(screen.getByText(/2nd false start/i)).toBeInTheDocument();
  });

  // Discipline crosstalk: both disciplines share one relay room, so a Freestyle
  // board's selection (no falseStarts) must not clear a live speed lane badge.
  it('ignores a freestyle board selection, holding the speed lane badge', () => {
    lastMessage.current = null;
    readyState.current = 1;
    const { rerender } = renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    const repaint = () =>
      rerender(
        <MemoryRouter initialEntries={['/route?compId=worlds-2026&token=abc']}>
          <SpeedlineTimerDisplay variant="broadcast" />
        </MemoryRouter>,
      );

    act(() => {
      lastMessage.current = {
        type: 'updateSelection',
        sessionId: 'worlds-2026',
        data: {
          discipline: 'speed',
          round: 'final',
          gender: 'male',
          matchId: 'm1',
          athlete1Id: 'a1',
          athlete2Id: 'a2',
          falseStarts: { 1: 2, 2: 0 },
        },
      };
      repaint();
    });
    expect(screen.getByText(/2nd false start/i)).toBeInTheDocument();

    act(() => {
      lastMessage.current = {
        type: 'updateSelection',
        sessionId: 'worlds-2026',
        data: {
          discipline: 'freestyle',
          round: 'final',
          gender: 'male',
          matchId: 'm2',
          athlete1Id: 'b1',
          athlete2Id: 'b2',
        },
      };
      repaint();
    });
    // The freestyle selection is dropped (no falseStarts reset), so the speed
    // badge survives.
    expect(screen.getByText(/2nd false start/i)).toBeInTheDocument();
  });

  it('recovers a flagged lane from a state_snapshot on late join', () => {
    renderWithMessage({
      type: 'state_snapshot',
      sessionId: 'worlds-2026',
      data: {
        isPreviewEnabled: true,
        signalPhase: 0,
        text: '',
        timers: [
          { timerId: 1, startTime: null, stopTime: null },
          { timerId: 2, startTime: null, stopTime: null },
        ],
        falseStarts: { 1: 1, 2: 0 },
      },
    });
    // count 1 → "False Start" (not the 2nd-FS variant).
    expect(screen.getByText('False Start')).toBeInTheDocument();
    expect(screen.queryByText(/2nd false start/i)).toBeNull();
  });
});

describe('SpeedlineTimerDisplay audio-muted badge (projector-only)', () => {
  // The badge exists to surface a muted projector rig whose beeps feed the venue
  // PA. On the broadcast overlay it is pure clutter composited over live video and
  // is suppressed regardless of the (irrelevant) tab audio state.
  it('shows the badge on the projector while audio is blocked', () => {
    lastMessage.current = null;
    readyState.current = 1;
    audioBlocked.current = true;
    renderDisplay('projector', '?sessionId=worlds-2026');
    expect(screen.getByTestId('audio-muted')).toBeInTheDocument();
  });

  it('suppresses the badge on the broadcast overlay even when audio is blocked', () => {
    lastMessage.current = null;
    readyState.current = 1;
    audioBlocked.current = true;
    renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    expect(screen.queryByTestId('audio-muted')).toBeNull();
    audioBlocked.current = false;
  });
});

describe('SpeedlineTimerDisplay start-signal from the anchor seed', () => {
  // With the seed-only protocol the operator sends one message (armed + anchor);
  // the display derives set1 (+3000) / set2 (+4000) / GO (+5000) and their beeps
  // locally off that anchor, so they are exact under any relay latency.
  const setup = () => {
    lastMessage.current = null;
    readyState.current = 1;
    const r = renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    const deliver = (msg: StopwatchWSMessage) =>
      act(() => {
        lastMessage.current = msg;
        r.rerender(
          <MemoryRouter initialEntries={['/route?compId=worlds-2026&token=abc']}>
            <SpeedlineTimerDisplay variant="broadcast" />
          </MemoryRouter>,
        );
      });
    return { deliver };
  };

  const seed = (anchorEpoch: number, lanes?: number[]): StopwatchWSMessage => ({
    type: 'updateSignalPhase',
    sessionId: 'worlds-2026',
    data: { currentPhase: PRE_BEEP_PHASE, anchorEpoch, ...(lanes ? { lanes } : {}) },
  });

  beforeEach(() => {
    playAudioMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives set1/set2/GO beeps locally on their exact instants', () => {
    const { deliver } = setup();
    deliver(seed(1_000_000)); // armed now
    expect(playAudioMock.mock.calls).toEqual([['short']]); // pre-beep, live

    act(() => vi.advanceTimersByTime(3000)); // set1
    act(() => vi.advanceTimersByTime(1000)); // set2
    act(() => vi.advanceTimersByTime(1000)); // GO
    expect(playAudioMock.mock.calls).toEqual([['short'], ['short'], ['short'], ['long']]);
  });

  it('fast-forwards the light and mutes the passed beep on a late seed', () => {
    const { deliver } = setup();
    // Seed arrives 4600ms after arming (e.g. a very late join): pre-beep/set1/set2
    // are all in the past; GO (+5000) is still 400ms away.
    deliver(seed(1_000_000 - 4600));

    // The passed beeps do NOT replay (a beep in the past is worse than none)...
    expect(playAudioMock).not.toHaveBeenCalled();
    // ...but the light has fast-forwarded and is shown.
    expect(screen.getByTestId('start-bulb-0')).toBeInTheDocument();

    // GO still fires exactly on its instant and beeps.
    act(() => vi.advanceTimersByTime(400));
    expect(playAudioMock).toHaveBeenCalledWith('long');
  });

  // The schedule-anchored start: the seed carries the lanes GO will ignite, so
  // the display starts the lane clocks at its locally-derived GO edge — the
  // same instant its green light fires — instead of waiting out the relay
  // latency on the authoritative `start` message.
  it('ignites the seeded lanes at the GO edge, anchored on the schedule epoch', () => {
    const { deliver } = setup();
    // Solo run: only lane 1 ignites; lane 2 stays dormant.
    deliver(seed(1_000_000, [1]));
    act(() => vi.advanceTimersByTime(5000)); // GO — clocks leave zero NOW

    // One second past GO the ignited lane reads exactly 0:01.00 (anchored on
    // anchor + 5000, not on any message arrival); the dormant lane holds zero.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('0:01.00')).toBeInTheDocument();
    expect(screen.getByText('0:00.00')).toBeInTheDocument();
  });

  it('never ignites the clocks when the sequence is aborted before GO', () => {
    const { deliver } = setup();
    deliver(seed(1_000_000, [1, 2]));
    act(() => vi.advanceTimersByTime(4000)); // through set2, pre-GO

    // The operator aborts: the mirror cancels, so the pending ignition dies.
    deliver({
      type: 'updateSignalPhase',
      sessionId: 'worlds-2026',
      data: { currentPhase: -1 },
    });
    act(() => vi.advanceTimersByTime(3000)); // well past the would-be GO

    // Both lanes still hold the idle clock — nothing started.
    expect(screen.getAllByText('0:00.00').length).toBeGreaterThanOrEqual(2);
  });
});

describe('SpeedlineTimerDisplay idle clock', () => {
  // Part (b): the broadcast overlay paints the idle 0:00.00 numeral on OPEN,
  // without waiting for a first relay message (isPreviewEnabled defaults true).
  it('paints the idle 0:00.00 clock on OPEN before any message', () => {
    lastMessage.current = null;
    readyState.current = 1; // OPEN
    renderDisplay('broadcast', '?compId=worlds-2026&token=abc');
    expect(screen.getAllByText('0:00.00').length).toBeGreaterThanOrEqual(2);
  });
});

describe('SpeedlineTimerDisplay corner geometry', () => {
  let restoreViewport = () => {};
  afterEach(() => restoreViewport());

  /** The lane-1 column's corner inset and its time plate, as jsdom computes them. */
  const laneGeometry = (search = '?compId=worlds-2026&token=abc') => {
    lastMessage.current = null;
    readyState.current = 1;
    renderDisplay('broadcast', search);
    const lane = screen.getByTestId('timer-lane-1');
    const plate = within(lane).getByTestId('stopwatch-plate');
    const laneStyle = window.getComputedStyle(lane);
    return {
      left: px(laneStyle.left),
      bottom: px(laneStyle.bottom),
      plateWidth: px(window.getComputedStyle(plate).width),
      numeral: px(window.getComputedStyle(within(plate).getByText('0:00.00')).fontSize),
    };
  };

  // The whole point of the frame-relative pass: at the 1920x1080 capture the
  // lower-third keeps the exact px the LAAX art was measured at, and every other
  // 16:9 capture scales it — a 4K browser source doubles instead of shrinking the
  // plate relative to the SVO/VS/rankings plates it shares a corner with.
  it('keeps the authored 1080p geometry at the 1920x1080 capture', () => {
    restoreViewport = pinViewport(1920, 1080);
    const { left, bottom, plateWidth, numeral } = laneGeometry();
    expect(left).toBeCloseTo(OVERLAY_LANE.inset, 1);
    expect(bottom).toBeCloseTo(OVERLAY_LANE.inset, 1);
    expect(plateWidth).toBeCloseTo(320, 1);
    expect(numeral).toBeCloseTo(60, 1);
  });

  it('doubles the geometry at a 3840x2160 capture', () => {
    restoreViewport = pinViewport(3840, 2160);
    const { left, bottom, plateWidth, numeral } = laneGeometry();
    expect(left).toBeCloseTo(2 * OVERLAY_LANE.inset, 1);
    expect(bottom).toBeCloseTo(2 * OVERLAY_LANE.inset, 1);
    expect(plateWidth).toBeCloseTo(640, 1);
    expect(numeral).toBeCloseTo(120, 1);
  });

  // The producer knobs stay RAW px against the capture, not frame-relative: they
  // exist to nudge the overlay off a rig's own lower-third furniture.
  it('honours ?bottomMargin / ?sideMargin as raw px overrides', () => {
    restoreViewport = pinViewport(3840, 2160);
    const { left, bottom } = laneGeometry(
      '?compId=worlds-2026&token=abc&bottomMargin=48&sideMargin=32',
    );
    expect(left).toBe(32);
    expect(bottom).toBe(48);
  });
});
