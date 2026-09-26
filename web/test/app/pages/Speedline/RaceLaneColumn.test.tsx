import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LaneId, RaceRecorder } from 'app/hooks/useRaceRecorder';
import { RaceLaneColumn } from 'app/pages/Speedline/RaceLaneColumn';
import { speedlineLaneState, type SpeedlineLaneState } from 'app/util/timerSnapshot';

import { px } from '../../../util/computedUnits';

import { ATHLETES, expectRaceControl, makeRecorder, savedFeedback } from './recorderStub';

const idle = (lane: LaneId) =>
  speedlineLaneState({ timerId: lane, startTime: null, stopTime: null });

const column = (
  lane: LaneId,
  recorder: RaceRecorder,
  over: {
    onStop?: () => void;
    onFlagFs?: () => void;
    onDnf?: () => void;
    stopLock?: string | null;
    onResume?: () => void;
    resumeLock?: string | null;
    laneState?: SpeedlineLaneState;
  } = {},
) => (
  <RaceLaneColumn
    lane={lane}
    recorder={recorder}
    athletes={ATHLETES}
    laneState={over.laneState ?? idle(lane)}
    isReady
    onStop={over.onStop ?? vi.fn()}
    stopLock={over.stopLock ?? null}
    onResume={over.onResume ?? vi.fn()}
    resumeLock={over.resumeLock ?? null}
    onFlagFs={over.onFlagFs ?? vi.fn()}
    onDnf={over.onDnf ?? vi.fn()}
  />
);

/** Both lanes at once, for the assertions that compare the two columns. */
const bothLanes = (recorder: RaceRecorder) => (
  <>
    {column(1, recorder)}
    {column(2, recorder)}
  </>
);

describe('RaceLaneColumn', () => {
  it('assigns an athlete to the lane', () => {
    const setLaneAthlete = vi.fn();
    render(column(1, makeRecorder({ setLaneAthlete })));

    fireEvent.change(screen.getByLabelText(/lane 1 athlete/i), { target: { value: 'a1' } });
    expect(setLaneAthlete).toHaveBeenCalledWith(1, 'a1');
  });

  it('disables the lane DNF button until an athlete is assigned', () => {
    render(column(1, makeRecorder()));
    expect(screen.getByRole('button', { name: /lane 1 dnf/i })).toBeDisabled();
  });

  it('records a DNF for an assigned lane', () => {
    const onDnf = vi.fn();
    render(column(1, makeRecorder({ laneAthletes: { 1: 'a1', 2: '' } }), { onDnf }));

    fireEvent.click(screen.getByRole('button', { name: /lane 1 dnf/i }));
    expect(onDnf).toHaveBeenCalledTimes(1);
  });

  it('badges the qualification attempt count and locks the lane at the cap (S5)', () => {
    render(
      bothLanes(
        makeRecorder({
          round: 'qualification',
          laneAthletes: { 1: 'a1', 2: 'a2' },
          laneAttempts: { 1: { used: 2, capped: true }, 2: { used: 1, capped: false } },
        }),
      ),
    );
    expect(screen.getByText('2/2 attempts')).toBeInTheDocument();
    expect(screen.getByText('1/2 attempts')).toBeInTheDocument();
    // The capped lane's DNF is disabled; the under-cap lane's stays live.
    expect(screen.getByRole('button', { name: /lane 1 dnf/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /lane 2 dnf/i })).toBeEnabled();
  });

  it('hides the attempt badge outside qualification', () => {
    render(
      column(
        1,
        makeRecorder({
          round: 'final',
          laneAthletes: { 1: 'a1', 2: '' },
          laneAttempts: { 1: { used: 3, capped: false }, 2: { used: 0, capped: false } },
        }),
      ),
    );
    expect(screen.queryByText(/attempts$/)).not.toBeInTheDocument();
  });

  describe('cascading selection filters', () => {
    const laneOptions = (lane: LaneId): string[] =>
      Array.from(
        screen.getByLabelText(new RegExp(`lane ${lane} athlete`, 'i')).querySelectorAll('option'),
      ).map((o) => o.textContent ?? '');

    it('narrows the lane picker to the selected gender', () => {
      render(column(1, makeRecorder({ selectedGender: 'female' })));
      expect(laneOptions(1)).toEqual(['— not recording —', 'Fay Frau']);
    });

    it('narrows both lane pickers to the selected match’s two athletes', () => {
      const m1 = {
        matchId: 'm1',
        compId: 'c1',
        discipline: 'speed',
        round: 'quarter',
        gender: 'male',
        position: 1,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      };
      render(
        bothLanes(
          makeRecorder({
            round: 'quarter',
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            roundMatches: [m1] as never,
            matches: { data: [m1] } as never,
          }),
        ),
      );
      expect(laneOptions(1)).toEqual(['— not recording —', 'Jane Doe', 'John Roe']);
      expect(laneOptions(2)).toEqual(['— not recording —', 'Jane Doe', 'John Roe']);
    });

    it('keeps an off-filter current pick listed (peer-mirrored selection)', () => {
      render(
        bothLanes(makeRecorder({ selectedGender: 'female', laneAthletes: { 1: 'a1', 2: '' } })),
      );
      expect(laneOptions(1)).toEqual(['— not recording —', 'Fay Frau', 'Jane Doe']);
      expect(laneOptions(2)).toEqual(['— not recording —', 'Fay Frau']);
    });
  });

  it('shows a saved chip with the recorded value', () => {
    render(
      column(
        1,
        makeRecorder({ laneFeedback: { 1: { status: 'saved', valueMs: 83450 }, 2: null } }),
      ),
    );
    // 83450ms -> 1:23.45
    expect(screen.getByText(/saved 1:23\.45/i)).toBeInTheDocument();
  });

  // §6 names the pair a failed save wears — the `NOT SAVED` chip is a stop, the
  // same one the Freestyle rail paints. It had been the break tone (outlined
  // `warning`), which reads as "a break is running" at a glance and wrote the
  // words at 1.94:1 besides.
  it('flags a failed lane save with the stop chip, not the break tone', () => {
    render(
      column(
        1,
        makeRecorder({ laneFeedback: { 1: { status: 'error', valueMs: 83450 }, 2: null } }),
      ),
    );

    const chip = screen.getByText(/not saved 1:23\.45/i).parentElement;
    expect(chip).toHaveClass('MuiChip-colorError');
    expect(chip).toHaveClass('MuiChip-filled');
  });

  it('shows a pending chip while a lane time is in flight', () => {
    render(
      column(
        1,
        makeRecorder({ laneFeedback: { 1: { status: 'pending', valueMs: 5000 }, 2: null } }),
      ),
    );
    expect(screen.getByText(/saving 0:05\.00/i)).toBeInTheDocument();
  });

  it('offers a time-correction field only once a lane time is saved', () => {
    const { rerender } = render(
      column(
        1,
        makeRecorder({ laneFeedback: { 1: { status: 'pending', valueMs: 5000 }, 2: null } }),
      ),
    );
    expect(screen.queryByLabelText(/correct time/i)).not.toBeInTheDocument();

    rerender(column(1, makeRecorder({ laneFeedback: { 1: savedFeedback('t1', 83450), 2: null } })));
    expect(screen.getByLabelText(/correct time/i)).toHaveValue('1:23.45');
  });

  it('commits a corrected time via editLaneTime on Enter', () => {
    const editLaneTime = vi.fn();
    render(
      column(
        1,
        makeRecorder({ editLaneTime, laneFeedback: { 1: savedFeedback('t1', 83450), 2: null } }),
      ),
    );
    const field = screen.getByLabelText(/correct time/i);
    fireEvent.change(field, { target: { value: '1:23.20' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // 1:23.20 -> 83200ms
    expect(editLaneTime).toHaveBeenCalledWith(1, 83200);
  });

  it('does not fire editLaneTime when the value is unchanged', () => {
    const editLaneTime = vi.fn();
    render(
      column(
        1,
        makeRecorder({ editLaneTime, laneFeedback: { 1: savedFeedback('t1', 83450), 2: null } }),
      ),
    );
    fireEvent.blur(screen.getByLabelText(/correct time/i));
    expect(editLaneTime).not.toHaveBeenCalled();
  });

  /**
   * The wrong-athlete recovery (`speedline-wrong-athlete-reattribute`): the
   * saved Time stays bound to whoever it was POSTed under, so the chip has to
   * say so — otherwise it reads as this run's result for the athlete now
   * standing on the lane, and the only undo left is deleting it.
   */
  describe('a lane re-picked after its save', () => {
    const misattributed = makeRecorder({
      laneAthletes: { 1: 'a2', 2: '' },
      laneFeedback: { 1: savedFeedback('t1', 83450, 'a1'), 2: null },
    });

    it('names the athlete the saved time is bound to', () => {
      render(column(1, misattributed));
      expect(screen.getByText('Saved 1:23.45 · Jane Doe')).toBeInTheDocument();
    });

    it('offers a one-tap move to the athlete now on the lane', () => {
      render(column(1, misattributed));

      const move = screen.getByRole('button', { name: /move time to john roe/i });
      expectRaceControl(move);
      fireEvent.click(move);
      expect(misattributed.moveTime).toHaveBeenCalledWith(1);
    });

    it('says nothing extra while the save and the lane agree', () => {
      render(
        column(
          1,
          makeRecorder({
            laneAthletes: { 1: 'a1', 2: '' },
            laneFeedback: { 1: savedFeedback('t1', 83450, 'a1'), 2: null },
          }),
        ),
      );
      expect(screen.getByText('Saved 1:23.45')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /move time to/i })).toBeNull();
    });
  });

  describe('false-start attribution (rules S2–S4)', () => {
    it('flags the lane from its own column, under the spelt-out label', () => {
      const onFlagFs = vi.fn();
      render(column(1, makeRecorder({ laneAthletes: { 1: 'a1', 2: '' } }), { onFlagFs }));

      // "FS" is the app's Freestyle shorthand; the lane control spells it out.
      const flag = screen.getByRole('button', { name: 'False start · Lane 1' });
      expect(window.getComputedStyle(flag).whiteSpace).toBe('nowrap');
      fireEvent.click(flag);
      expect(onFlagFs).toHaveBeenCalledTimes(1);
    });

    it('shows a clearable FS chip and a 2nd-FS warning for a flagged lane', () => {
      const clearFs = vi.fn();
      render(
        column(
          1,
          makeRecorder({ laneAthletes: { 1: 'a1', 2: 'a2' }, fsCounts: { 1: 2, 2: 0 }, clearFs }),
        ),
      );
      expect(screen.getByText('FS ×2')).toBeInTheDocument();
      expect(screen.getByText(/attempt failed, no time recorded/i)).toBeInTheDocument();
      // The chip's delete (✕) clears the lane's counter.
      fireEvent.click(screen.getByTestId('CancelIcon'));
      expect(clearFs).toHaveBeenCalledWith(1);
    });
  });

  // The console's state-painted press: it shipped as a `size="small"`
  // hand-painted `Button` — the right colour, under the 44 px aux floor, and
  // holding the focus the handset needs (§4.4/§6).
  it('paints Lane n DNF as a race control', () => {
    render(column(1, makeRecorder({ laneAthletes: { 1: 'a1', 2: 'a2' } })));

    expectRaceControl(screen.getByRole('button', { name: /lane 1 dnf/i }));
  });

  /**
   * `speedline-lane-post-stop-layout-shift`: every press the run produces used
   * to be MOUNTED on the stop — Resume, the Saved chip, the correction field —
   * pushing False start and DNF 74–120 px down the column under the operator's
   * hand, and DNF under a 768 px fold. The fix is slots, not order alone: the
   * column's own tests can only pin what jsdom knows (DOM order and the
   * reserved heights); the rects are the driver's at the contract widths.
   */
  describe('the column holds still across a stop', () => {
    const assigned = { 1: 'a1', 2: '' } as const;
    const pressOrder = (container: HTMLElement): string[] =>
      Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');

    it('keeps the race pair in the same slots once a lane stops and saves', () => {
      const { container, rerender } = render(
        column(1, makeRecorder({ laneAthletes: assigned })),
        {},
      );
      const before = pressOrder(container);
      expect(before).toEqual(['Stop', 'Resume Lane 1', 'False start · Lane 1', 'Lane 1 DNF']);

      rerender(
        column(
          1,
          makeRecorder({
            laneAthletes: assigned,
            laneFeedback: { 1: savedFeedback('t1', 83450, 'a1'), 2: null },
          }),
          { laneState: speedlineLaneState({ timerId: 1, startTime: 1000, stopTime: 5000 }) },
        ),
      );

      // The chip and the correction field land in slots that already stood;
      // nothing new is inserted above the race pair.
      expect(pressOrder(container)).toEqual(before);
      expect(screen.getByLabelText(/correct time/i)).toBeInTheDocument();
    });

    it('reserves the status row so a landing chip moves nothing', () => {
      render(column(1, makeRecorder({ laneAthletes: assigned })));

      const row = screen.getByTestId('lane-1-status');
      expect(px(window.getComputedStyle(row).minHeight)).toBe(24);
    });

    it('reserves the Resume slot before the lane stops, disabled with its reason', () => {
      render(
        column(1, makeRecorder({ laneAthletes: assigned }), {
          resumeLock: 'Lane 1 is not stopped',
        }),
      );

      const resume = screen.getByRole('button', { name: 'Resume Lane 1' });
      expect(resume).toBeDisabled();
      expect(resume).toHaveAccessibleDescription('Lane 1 is not stopped');
      expect(px(window.getComputedStyle(resume).minHeight)).toBeGreaterThanOrEqual(44);
    });
  });
});
