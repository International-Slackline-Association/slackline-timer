import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RaceRecorderControls } from 'app/pages/Speedline/RaceRecorderControls';

import { px } from '../../../util/computedUnits';

import { ATHLETES, expectRaceControl, makeRecorder, savedFeedback } from './recorderStub';

/** The rail is the cross-lane half of the desk; the per-lane half is pinned by
 * `RaceLaneColumn.test.tsx`. */

describe('RaceRecorderControls', () => {
  it('swaps the lanes via swapLanes, disabled until an athlete is picked', () => {
    const swapLanes = vi.fn();
    const { rerender } = render(
      <RaceRecorderControls recorder={makeRecorder({ swapLanes })} athletes={ATHLETES} />,
    );
    expect(screen.getByRole('button', { name: /swap lanes/i })).toBeDisabled();

    rerender(
      <RaceRecorderControls
        recorder={makeRecorder({ swapLanes, laneAthletes: { 1: 'a1', 2: '' } })}
        athletes={ATHLETES}
      />,
    );
    const button = screen.getByRole('button', { name: /swap lanes/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(swapLanes).toHaveBeenCalledTimes(1);
  });

  it('locks the swap while a run is live, and says which run took it', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({ laneAthletes: { 1: 'a1', 2: 'a2' } })}
        athletes={ATHLETES}
        swapLock="locked while a lane runs"
      />,
    );
    expect(screen.getByRole('button', { name: /swap lanes/i })).toBeDisabled();
    expect(screen.getByTestId('why-line')).toHaveTextContent('why: locked while a lane runs');
  });

  it('surfaces a save error without implying timing broke', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          createTime: { isError: true, error: new Error('boom') } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/time not saved.*timing is unaffected/i)).toBeInTheDocument();
  });

  it('selects a speed match for winner derivation (auto-fills via selectMatch)', () => {
    const selectMatch = vi.fn();
    const m1 = {
      matchId: 'm1',
      compId: 'c1',
      discipline: 'speed',
      round: 'quarter',
      roundName: 'Quarter 1',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          round: 'quarter',
          selectMatch,
          roundMatches: [m1] as never,
          matches: { data: [m1] } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    fireEvent.change(screen.getByLabelText(/match \(speed\)/i), { target: { value: 'm1' } });
    expect(selectMatch).toHaveBeenCalledWith('m1');
  });

  it('lists only the current round’s matches and confirms a round change', () => {
    const requestRound = vi.fn();
    const confirmRoundChange = vi.fn();
    const cancelRoundChange = vi.fn();
    const other = {
      matchId: 'm9',
      compId: 'c1',
      discipline: 'speed',
      round: 'final',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    const { rerender } = render(
      <RaceRecorderControls
        recorder={makeRecorder({
          round: 'quarter',
          requestRound,
          // roundMatches is the hook's already-filtered list, so a final-round
          // match must never surface even though matches.data carries it.
          roundMatches: [] as never,
          matches: { data: [other] } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    // Only the "— no match —" placeholder; the final-round match is filtered out.
    expect(screen.getByLabelText(/match \(speed\)/i)).toHaveTextContent(/^— no match —$/);

    // The Round control is a non-native MUI Select: open it and pick an option.
    fireEvent.mouseDown(screen.getByLabelText(/^round$/i));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Final'));
    expect(requestRound).toHaveBeenCalledWith('final');

    // A pending round opens the confirm dialog; its buttons wire to the hook.
    rerender(
      <RaceRecorderControls
        recorder={makeRecorder({
          round: 'quarter',
          selectedMatchId: 'm9',
          pendingChange: { kind: 'round', round: 'final' },
          confirmPendingChange: confirmRoundChange,
          cancelPendingChange: cancelRoundChange,
        })}
        athletes={ATHLETES}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change round/i }));
    expect(confirmRoundChange).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /keep match/i }));
    expect(cancelRoundChange).toHaveBeenCalled();
  });

  it('routes a gender change through requestGender (the guarded door)', () => {
    const requestGender = vi.fn();
    render(<RaceRecorderControls recorder={makeRecorder({ requestGender })} athletes={ATHLETES} />);
    fireEvent.mouseDown(screen.getByLabelText(/^gender$/i));
    fireEvent.click(within(screen.getByRole('listbox')).getByText(/women/i));
    expect(requestGender).toHaveBeenCalledWith('female');
  });

  it('opens the gender confirm for a pending gender change', () => {
    const confirmPendingChange = vi.fn();
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          selectedMatchId: 'm9',
          pendingChange: { kind: 'gender', gender: 'female' },
          confirmPendingChange,
        })}
        athletes={ATHLETES}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change gender/i }));
    expect(confirmPendingChange).toHaveBeenCalled();
  });

  it('surfaces a match-update error separately from a timing failure', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          updateMatch: { isError: true, error: new Error('nope') } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/match not updated.*timing is unaffected/i)).toBeInTheDocument();
  });

  // One alert for the one PUT path: a correction and a re-attribution share the
  // mutation, so the rail states the failure without claiming which it was —
  // the lane's toast names that.
  it('surfaces a failed time update without implying timing broke', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          updateTime: { isError: true, error: new Error('boom') } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/time not updated.*timing is unaffected/i)).toBeInTheDocument();
  });

  it('shows the derived match winner inline once both lanes finish', () => {
    const { container } = render(
      <RaceRecorderControls
        recorder={makeRecorder({ selectedMatchId: 'm1', derivedWinner: 'a1' })}
        athletes={ATHLETES}
      />,
    );
    // The winner athlete's name renders in the inline "Match winner:" line (a <strong>).
    expect(container.querySelector('strong')?.textContent).toMatch(/jane doe/i);
  });

  it('shows a no-winner match result for a tie / both-DNF', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({ selectedMatchId: 'm1', derivedWinner: '' })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/no winner/i)).toBeInTheDocument();
  });

  it('shows the best-of-3 series score only when a match is selected', () => {
    const { rerender } = render(
      <RaceRecorderControls recorder={makeRecorder()} athletes={ATHLETES} />,
    );
    expect(screen.queryByText(/best of 3/i)).not.toBeInTheDocument();

    rerender(
      <RaceRecorderControls
        recorder={makeRecorder({ selectedMatchId: 'm1', runWins: { 1: 1, 2: 0 } })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/best of 3/i)).toBeInTheDocument();
  });

  it('zeroes the series via resetSeries, once the question is answered', () => {
    const resetSeries = vi.fn();
    render(
      <RaceRecorderControls
        recorder={makeRecorder({ selectedMatchId: 'm1', runWins: { 1: 1, 2: 1 }, resetSeries })}
        athletes={ATHLETES}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reset series/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset series' }),
    );
    expect(resetSeries).toHaveBeenCalledTimes(1);
  });

  it('disables the void-run button until a lane time is saved', () => {
    render(<RaceRecorderControls recorder={makeRecorder()} athletes={ATHLETES} />);
    expect(screen.getByRole('button', { name: /void run/i })).toBeDisabled();
  });

  it('voids the run once a lane time is saved', () => {
    const voidRun = vi.fn();
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          voidRun,
          laneFeedback: { 1: savedFeedback('t1', 83450), 2: null },
        })}
        athletes={ATHLETES}
      />,
    );
    const button = screen.getByRole('button', { name: /void run/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Void run' }));
    expect(voidRun).toHaveBeenCalledTimes(1);
  });

  it('surfaces a void error without implying timing broke', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          deleteTime: { isError: true, error: new Error('boom') } as never,
        })}
        athletes={ATHLETES}
      />,
    );
    expect(screen.getByText(/run not voided.*timing is unaffected/i)).toBeInTheDocument();
  });

  describe('false-start advisory (rules S2–S4)', () => {
    it('advises a round forfeit and awards it to the opponent on tap', () => {
      const awardRunTo = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            fsCounts: { 1: 2, 2: 0 },
            fsOutcome: { kind: 'round-to-opponent', offender: 1, opponent: 2 },
            awardRunTo,
          })}
          athletes={ATHLETES}
        />,
      );
      // The forfeit strip replaces the standalone Void run button with the award.
      expect(screen.queryByRole('button', { name: /^void run$/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /award round to john roe/i }));
      expect(awardRunTo).toHaveBeenCalledWith(2);
    });

    it('advises a rerun (no award) when both lanes false-started', () => {
      const voidRun = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            fsCounts: { 1: 1, 2: 1 },
            fsOutcome: { kind: 'rerun-round' },
            voidRun,
          })}
          athletes={ATHLETES}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /void run & rerun/i }));
      expect(voidRun).toHaveBeenCalledTimes(1);
    });
  });

  // Void run is the rail's stop-tier press, so it comes from `RaceButton`
  // rather than a hand-painted fill: one dialect across both boards
  // (FREESTYLE_BOARD_UX §6), the ≥44 px target, and the blur rule that keeps a
  // clicked control from owning the next handset press (§4.4).
  it('paints Void run as a race control, blur rule and target size included', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          selectedMatchId: 'm1',
          laneAthletes: { 1: 'a1', 2: 'a2' },
          laneFeedback: { 1: savedFeedback('t1', 83450), 2: null },
        })}
        athletes={ATHLETES}
      />,
    );

    expectRaceControl(screen.getByRole('button', { name: /^void run$/i }));
  });

  it('paints the false-start award as a race control', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          selectedMatchId: 'm1',
          laneAthletes: { 1: 'a1', 2: 'a2' },
          fsCounts: { 1: 2, 2: 0 },
          fsOutcome: { kind: 'round-to-opponent', offender: 1, opponent: 2 },
        })}
        athletes={ATHLETES}
      />,
    );

    expectRaceControl(screen.getByRole('button', { name: /award round to/i }));
  });

  // The rail's two colourless presses (FREESTYLE_BOARD_UX §7's P3 sibling): no
  // state to paint, so nothing about them looked wrong — and both shipped under
  // the aux floor, holding focus, while the Freestyle desk's own `Swap players`
  // already took the wrapper.
  it('paints the lane swap as a race control', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({ laneAthletes: { 1: 'a1', 2: 'a2' } })}
        athletes={ATHLETES}
      />,
    );

    expectRaceControl(screen.getByRole('button', { name: /swap lanes/i }));
  });

  /**
   * `speedline-void-run-reset-series-confirm`: both presses spend something
   * with no undo — persisted Times, the on-air tally — and both fired on one
   * press while the harmless Reset asked. The shell is the board's
   * (`BoardConfirmDialog`), so a handset press behind the question answers it
   * safely and the Handsets card names what it answered.
   */
  describe('the rail’s two irreversible presses ask first', () => {
    const question = () => screen.getByRole('dialog');
    const savedBoth = {
      1: savedFeedback('t1', 83450, 'a1'),
      2: savedFeedback('t2', 5000, 'a2'),
    } as never;

    it('names every time Void run would delete, and keeps them on the safe answer', () => {
      const voidRun = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            laneAthletes: { 1: 'a1', 2: 'a2' },
            laneFeedback: savedBoth,
            voidRun,
          })}
          athletes={ATHLETES}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^void run$/i }));

      expect(within(question()).getByText('Void this run?')).toBeInTheDocument();
      expect(question()).toHaveTextContent(
        'Deletes Saved 1:23.45 (Jane Doe) and Saved 0:05.00 (John Roe).',
      );
      expect(voidRun).not.toHaveBeenCalled();

      // The safe answer is the autofocused one — a stray Space/ADVANCE lands here.
      const keep = within(question()).getByRole('button', { name: 'Keep times' });
      expect(keep).toHaveFocus();
      fireEvent.click(keep);
      expect(voidRun).not.toHaveBeenCalled();
    });

    it('asks the same question from the false-start strip’s void', () => {
      const voidRun = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            laneFeedback: savedBoth,
            fsCounts: { 1: 1, 2: 1 },
            fsOutcome: { kind: 'rerun-round' },
            voidRun,
          })}
          athletes={ATHLETES}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /void run & rerun/i }));

      expect(within(question()).getByText('Void this run?')).toBeInTheDocument();
      expect(voidRun).not.toHaveBeenCalled();
    });

    it('resets a 0–0 series instantly — nothing spent, no question', () => {
      const resetSeries = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            runWins: { 1: 0, 2: 0 },
            resetSeries,
          })}
          athletes={ATHLETES}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /reset series/i }));

      expect(resetSeries).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks before wiping a tally that stands, naming the score', () => {
      const resetSeries = vi.fn();
      render(
        <RaceRecorderControls
          recorder={makeRecorder({
            selectedMatchId: 'm1',
            laneAthletes: { 1: 'a1', 2: 'a2' },
            runWins: { 1: 2, 2: 1 },
            resetSeries,
          })}
          athletes={ATHLETES}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /reset series/i }));

      expect(within(question()).getByText('Reset the 2–1 series?')).toBeInTheDocument();
      expect(resetSeries).not.toHaveBeenCalled();

      fireEvent.click(within(question()).getByRole('button', { name: 'Keep series' }));
      expect(resetSeries).not.toHaveBeenCalled();
    });
  });

  it('paints Reset series as a race control', () => {
    render(
      <RaceRecorderControls
        recorder={makeRecorder({
          selectedMatchId: 'm1',
          laneAthletes: { 1: 'a1', 2: 'a2' },
          runWins: { 1: 1, 2: 0 },
        })}
        athletes={ATHLETES}
      />,
    );

    expectRaceControl(screen.getByRole('button', { name: /reset series/i }));
  });
});

/**
 * `speedline-recording-rail-heading-gap`: the `RESULT RECORDING` overline sat
 * flush on the Round/Gender row, and MUI's outlined label floats ~9 px above
 * its field box — so at every desk viewport the label overprinted the heading.
 * jsdom does no layout and cannot see the collision; what it can hold is the
 * gutter that prevents it, on the heading that owns it.
 */
/** How far MUI lifts an outlined `TextField`'s label above its own field box. */
const MUI_FLOATING_LABEL_RISE_PX = 9;

describe('the recording rail heading', () => {
  it('keeps a gutter under the overline, so the first field label cannot overprint it', () => {
    render(<RaceRecorderControls recorder={makeRecorder()} athletes={ATHLETES} />);

    const heading = screen.getByText('Result recording');
    const style = window.getComputedStyle(heading);
    // The desk's caption dialect stays (not `subtitle2 gutterBottom`): the
    // overline class is what the rest of the board's section headings carry.
    expect(heading).toHaveClass('MuiTypography-overline');
    // More than the 9 px MUI floats the outlined label above its field box —
    // measured in the browser at all four contract viewports, where an 8 px
    // gutter still overlapped by 1 px.
    expect(px(style.marginBottom)).toBeGreaterThan(MUI_FLOATING_LABEL_RISE_PX);
  });
});
