import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { advanceOverlay } from 'app/hooks/useAdvanceInput';
import type { ScoreRecorder } from 'app/hooks/useScoreRecorder';
import { PEER_FLASH_MS } from 'app/hooks/usePeerFlash';
import { FreestyleSelectionPanel } from 'app/pages/Freestyle/FreestyleSelectionPanel';
import type { Athlete } from 'app/types';

const athlete = (athleteId: string, name: string, gender: 'male' | 'female' = 'male'): Athlete => ({
  athleteId,
  compId: 'c1',
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender,
});

const ATHLETES = [
  athlete('a1', 'Jane Doe'),
  athlete('a2', 'John Roe'),
  athlete('a3', 'Fay Frau', 'female'),
];

/** A recorder stub: just the fields the panel reads + spies for the callbacks. */
const makeRecorder = (over: Partial<ScoreRecorder> = {}): ScoreRecorder => {
  const recorder = {
    round: 'qualification',
    setRound: vi.fn(),
    requestRound: vi.fn(),
    requestGender: vi.fn(),
    pendingChange: null,
    confirmPendingChange: vi.fn(),
    cancelPendingChange: vi.fn(),
    roundMatches: [],
    athletes: { 1: '', 2: '' },
    setAthlete: vi.fn(),
    swapAthletes: vi.fn(),
    entries: { 1: { status: 'empty' }, 2: { status: 'empty' } },
    setField: vi.fn(),
    setOverride: vi.fn(),
    recordScore: vi.fn(),
    recordDnf: vi.fn(),
    toast: null,
    clearToast: vi.fn(),
    selectedGender: 'male',
    selectedMatchId: '',
    selectMatch: vi.fn(),
    matches: { data: [] } as never,
    updateMatch: { isError: false, error: null } as never,
    derivedWinner: null,
    ...over,
  } as ScoreRecorder;

  return {
    ...recorder,
    canSwapAthletes: over.canSwapAthletes ?? Boolean(recorder.athletes[1] && recorder.athletes[2]),
  } as ScoreRecorder;
};

const renderPanel = (recorder: ScoreRecorder, mode: 'quali' | 'battle' = 'battle') =>
  render(<FreestyleSelectionPanel selection={recorder} athletes={ATHLETES} mode={mode} />);

describe('FreestyleSelectionPanel', () => {
  // The whole selection is ONE wrapping row, and Athlete 1 ⇄ Swap ⇄ Athlete 2
  // is one wrap unit inside it: the match picks the field, and the trio stays
  // grouped across widths instead of free-wrapping between the context fields.
  it('keeps the athlete-assignment trio one wrap unit of the selection row', () => {
    renderPanel(makeRecorder(), 'battle');

    const row = screen.getByTestId('selection-context-group');
    const assignment = screen.getByTestId('athlete-assignment-group');
    expect(row).toContainElement(assignment);
    expect(screen.getByTestId('athlete-assignment-grid')).toBeInTheDocument();

    const order = [
      screen.getByLabelText(/^round$/i),
      screen.getByLabelText(/^gender$/i),
      screen.getByLabelText(/match \(freestyle\)/i),
      screen.getByLabelText(/athlete 1/i),
      screen.getByRole('button', { name: /Swap athletes/i }),
      screen.getByLabelText(/athlete 2/i),
    ];
    order.forEach((field, index) => {
      const next = order[index + 1];
      if (next) {
        expect(field.compareDocumentPosition(next)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      }
    });
    expect(order.slice(0, 4).map((field) => field.tagName)).toEqual([
      'SELECT',
      'SELECT',
      'SELECT',
      'SELECT',
    ]);
  });

  it('assigns an athlete to a slot', () => {
    const setAthlete = vi.fn();
    renderPanel(makeRecorder({ setAthlete }));

    fireEvent.change(screen.getByLabelText(/athlete 1/i), { target: { value: 'a1' } });
    expect(setAthlete).toHaveBeenCalledWith(1, 'a1');
  });

  it('shows the match select and Athlete 2 picker in battle', () => {
    renderPanel(makeRecorder(), 'battle');
    expect(screen.getByLabelText(/match \(freestyle\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/athlete 2/i)).toBeInTheDocument();
  });

  it('swaps the athletes via swapAthletes in battle only once both athletes are picked', () => {
    const swapAthletes = vi.fn();
    const { rerender } = renderPanel(makeRecorder({ swapAthletes }), 'battle');
    const swapButton = () => screen.getByRole('button', { name: /Swap athletes/i });
    expect(swapButton()).toBeDisabled();
    expect(screen.getByTestId('why-line')).toHaveTextContent(
      'why: pick both athletes to swap sides',
    );

    rerender(
      <FreestyleSelectionPanel
        selection={makeRecorder({ swapAthletes, athletes: { 1: 'a1', 2: '' } })}
        athletes={ATHLETES}
        mode="battle"
      />,
    );
    expect(swapButton()).toBeDisabled();
    expect(screen.getByTestId('why-line')).toHaveTextContent(
      'why: pick both athletes to swap sides',
    );

    rerender(
      <FreestyleSelectionPanel
        selection={makeRecorder({ swapAthletes, athletes: { 1: 'a1', 2: 'a2' } })}
        athletes={ATHLETES}
        mode="battle"
      />,
    );
    expect(swapButton()).toBeEnabled();
    fireEvent.click(swapButton());
    expect(swapAthletes).toHaveBeenCalledTimes(1);
    // The why-line is reserved either way (§4.12), so the row does not jump as
    // a lock arrives — with nothing to say it says nothing.
    expect(screen.getByTestId('why-line')).toHaveTextContent('');
  });

  // §4.7 on the sibling of Speedline's `Swap`: the swap moves the athletes and
  // their panels, never the lane clocks, so a board holding a player takes it
  // away — and prints the same hold the locked lane controls print.
  it('locks Swap athletes while the board holds an athlete, and says why', () => {
    const swapAthletes = vi.fn();
    render(
      <FreestyleSelectionPanel
        selection={makeRecorder({ swapAthletes, athletes: { 1: 'a1', 2: 'a2' } })}
        athletes={ATHLETES}
        mode="battle"
        swapLock="locked while Athlete 1 runs"
      />,
    );

    const button = screen.getByRole('button', { name: /Swap athletes/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(swapAthletes).not.toHaveBeenCalled();
    expect(screen.getByTestId('why-line')).toHaveTextContent('why: locked while Athlete 1 runs');
  });

  // freestyle-board-fold-budget: battle used to stack a context grid over a
  // bordered "Athlete assignment" box — two captions, a border and a nested
  // inset, ~60 px of the live column that holds the lane transport over the
  // fold. One wrapping row now: four flex items in quali, four in battle (the
  // trio counts once, because it wraps as one).
  it('lays the whole selection on one wrapping row in both modes', () => {
    const { rerender } = renderPanel(makeRecorder(), 'quali');

    const qualiRow = screen.getByTestId('selection-context-group');
    expect(window.getComputedStyle(qualiRow).flexWrap).toBe('wrap');
    expect(qualiRow.children).toHaveLength(4);
    expect(screen.queryByTestId('athlete-assignment-group')).not.toBeInTheDocument();

    rerender(
      <FreestyleSelectionPanel selection={makeRecorder()} athletes={ATHLETES} mode="battle" />,
    );
    const battleRow = screen.getByTestId('selection-context-group');
    expect(window.getComputedStyle(battleRow).flexWrap).toBe('wrap');
    expect(battleRow.children).toHaveLength(4);
    expect(battleRow).toContainElement(screen.getByTestId('athlete-assignment-group'));
  });

  // The Match select carried a permanent helper line under it. What it fills is
  // the manual's own sentence and the two pickers beside it show the answer, so
  // on a fold-bound live board the hint is setup chrome the live path paid 20 px
  // for (the responsive contract's collapse order).
  it('carries no helper line under the match select', () => {
    renderPanel(makeRecorder(), 'battle');

    expect(screen.queryByText(/fills both athletes/i)).not.toBeInTheDocument();
  });

  // freestyle-quali-next-up: quali runs one athlete at a time, so who follows is
  // not derivable — the operator names it, and the placeholder clears it in one
  // press. Battle has the slot marker (ADR 0037), so the control is not rendered
  // there at all: a different mode is not a locked control.
  describe('quali Next up', () => {
    it('names and clears the next athlete', () => {
      const onNextUpAthleteChange = vi.fn();
      const { rerender } = render(
        <FreestyleSelectionPanel
          selection={makeRecorder()}
          athletes={ATHLETES}
          mode="quali"
          onNextUpAthleteChange={onNextUpAthleteChange}
        />,
      );

      const nextUp = screen.getByLabelText(/^next up$/i) as HTMLSelectElement;
      expect(nextUp.value).toBe('');
      fireEvent.change(nextUp, { target: { value: 'a2' } });
      expect(onNextUpAthleteChange).toHaveBeenCalledWith('a2');

      rerender(
        <FreestyleSelectionPanel
          selection={makeRecorder()}
          athletes={ATHLETES}
          mode="quali"
          nextUpAthleteId="a2"
          onNextUpAthleteChange={onNextUpAthleteChange}
        />,
      );
      expect((screen.getByLabelText(/^next up$/i) as HTMLSelectElement).value).toBe('a2');

      fireEvent.change(screen.getByLabelText(/^next up$/i), { target: { value: '' } });
      expect(onNextUpAthleteChange).toHaveBeenLastCalledWith('');
    });

    it('narrows the list to the selected gender, like the athlete pickers', () => {
      renderPanel(makeRecorder({ selectedGender: 'female' }), 'quali');

      expect(
        Array.from(screen.getByLabelText(/^next up$/i).querySelectorAll('option')).map(
          (o) => o.textContent,
        ),
      ).toEqual(['— none —', 'Fay Frau']);
    });

    it('is not rendered in battle, where the slot marker owns it', () => {
      renderPanel(makeRecorder(), 'battle');
      expect(screen.queryByLabelText(/^next up$/i)).not.toBeInTheDocument();
    });
  });

  it('hides the swap-athletes button in quali (one athlete at a time)', () => {
    renderPanel(makeRecorder(), 'quali');
    expect(screen.queryByRole('button', { name: /Swap athletes/i })).not.toBeInTheDocument();
  });

  it('hides the match select and Athlete 2 picker in quali (one athlete at a time)', () => {
    renderPanel(makeRecorder(), 'quali');
    expect(screen.queryByLabelText(/match \(freestyle\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/athlete 2/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/athlete 1/i)).toBeInTheDocument();
  });

  it('selects a freestyle match for auto-fill + winner derivation', () => {
    const selectMatch = vi.fn();
    const m1 = {
      matchId: 'm1',
      compId: 'c1',
      discipline: 'freestyle',
      round: 'final',
      roundName: 'Final',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    renderPanel(
      makeRecorder({
        round: 'final',
        selectMatch,
        roundMatches: [m1] as never,
        matches: { data: [m1] } as never,
      }),
    );
    fireEvent.change(screen.getByLabelText(/match \(freestyle\)/i), { target: { value: 'm1' } });
    expect(selectMatch).toHaveBeenCalledWith('m1');
  });

  it('lists only the current round’s matches and confirms a round change', () => {
    const requestRound = vi.fn();
    const confirmRoundChange = vi.fn();
    const cancelRoundChange = vi.fn();
    const other = {
      matchId: 'm9',
      compId: 'c1',
      discipline: 'freestyle',
      round: 'final',
      gender: 'male',
      position: 1,
      athlete1Id: 'a1',
      athlete2Id: 'a2',
    };
    const { rerender } = renderPanel(
      makeRecorder({
        round: 'quarter',
        requestRound,
        // roundMatches is the hook's already-filtered list, so a final-round
        // match must never surface even though matches.data carries it.
        roundMatches: [] as never,
        matches: { data: [other] } as never,
      }),
    );
    expect(screen.getByLabelText(/match \(freestyle\)/i)).toHaveTextContent(/^— no match —$/);

    // Round is the house NATIVE select (§4.3): its list is the platform's, so
    // an open one can never own the board's Space.
    fireEvent.change(screen.getByLabelText(/^round$/i), { target: { value: 'final' } });
    expect(requestRound).toHaveBeenCalledWith('final');

    rerender(
      <FreestyleSelectionPanel
        selection={makeRecorder({
          round: 'quarter',
          selectedMatchId: 'm9',
          pendingChange: { kind: 'round', round: 'final' },
          confirmPendingChange: confirmRoundChange,
          cancelPendingChange: cancelRoundChange,
        })}
        athletes={ATHLETES}
        mode="battle"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change round/i }));
    expect(confirmRoundChange).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /keep match/i }));
    expect(cancelRoundChange).toHaveBeenCalled();
  });

  // The handset readout names a question after the change it asks about
  // (§4.8/§4.14): one dialog stands over two doors, so a single hand-spelled
  // name sent the operator looking for a control the board never had — and read
  // the same whichever picker raised it.
  it.each([
    { kind: 'gender', pending: { kind: 'gender', gender: 'female' }, question: 'Change gender' },
    { kind: 'round', pending: { kind: 'round', round: 'final' }, question: 'Change round' },
  ] as const)(
    'registers the $kind question by the change it asks about',
    ({ pending, question }) => {
      renderPanel(makeRecorder({ selectedMatchId: 'm9', pendingChange: pending }));

      expect(advanceOverlay()?.confirm).toEqual({ dialog: question, safeAction: 'Keep match' });
      // Not a second wording of it: the name IS the button the operator reads.
      expect(screen.getByRole('button', { name: question })).toBeInTheDocument();
    },
  );

  describe('cascading selection filters', () => {
    const playerOptions = (player: 1 | 2): string[] =>
      Array.from(
        screen.getByLabelText(new RegExp(`^athlete ${player}$`, 'i')).querySelectorAll('option'),
      ).map((o) => o.textContent ?? '');

    it('narrows the player pickers to the selected gender (both modes)', () => {
      renderPanel(makeRecorder({ selectedGender: 'female' }), 'quali');
      expect(playerOptions(1)).toEqual(['— not recording —', 'Fay Frau']);
    });

    it('narrows the player pickers to the selected match’s two athletes', () => {
      const m1 = {
        matchId: 'm1',
        compId: 'c1',
        discipline: 'freestyle',
        round: 'final',
        gender: 'male',
        position: 1,
        athlete1Id: 'a1',
        athlete2Id: 'a2',
      };
      renderPanel(
        makeRecorder({
          round: 'final',
          selectedMatchId: 'm1',
          athletes: { 1: 'a1', 2: 'a2' },
          roundMatches: [m1] as never,
          matches: { data: [m1] } as never,
        }),
      );
      expect(playerOptions(1)).toEqual(['— not recording —', 'Jane Doe', 'John Roe']);
      expect(playerOptions(2)).toEqual(['— not recording —', 'Jane Doe', 'John Roe']);
    });

    it('keeps an off-filter current pick listed (peer-mirrored selection)', () => {
      renderPanel(makeRecorder({ selectedGender: 'female', athletes: { 1: 'a1', 2: '' } }));
      expect(playerOptions(1)).toEqual(['— not recording —', 'Fay Frau', 'Jane Doe']);
      expect(playerOptions(2)).toEqual(['— not recording —', 'Fay Frau']);
    });

    it('routes a gender change through requestGender (the guarded door)', () => {
      const requestGender = vi.fn();
      renderPanel(makeRecorder({ requestGender }));
      fireEvent.change(screen.getByLabelText(/^gender$/i), { target: { value: 'female' } });
      expect(requestGender).toHaveBeenCalledWith('female');
    });

    it('opens the gender confirm for a pending gender change', () => {
      const confirmPendingChange = vi.fn();
      renderPanel(
        makeRecorder({
          selectedMatchId: 'm9',
          pendingChange: { kind: 'gender', gender: 'female' },
          confirmPendingChange,
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: /change gender/i }));
      expect(confirmPendingChange).toHaveBeenCalled();
    });
  });
});

// The mode owns the Round vocabulary (format = mode, the ADR 0036 respec):
// quali IS the qualification round, battle IS a playoff match, and `test` stays
// in both as the full-component rehearsal round.
describe('FreestyleSelectionPanel round options per mode', () => {
  const listedRounds = () =>
    Array.from(screen.getByLabelText(/^round$/i).querySelectorAll('option')).map(
      (o) => o.textContent,
    );

  it('quali offers Test + Qualification only', () => {
    renderPanel(makeRecorder(), 'quali');
    expect(listedRounds()).toEqual(['Test', 'Qualification']);
  });

  it('battle offers Test + the playoff rounds', () => {
    renderPanel(makeRecorder({ round: 'quarter' }), 'battle');
    expect(listedRounds()).toEqual([
      'Test',
      'Quarter-finals',
      'Semi-finals',
      'Small final',
      'Final',
    ]);
  });

  it('keeps an out-of-mode current round listed (cancelled normalization / peer mirror)', () => {
    renderPanel(makeRecorder({ round: 'final' }), 'quali');
    expect(listedRounds()).toEqual(['Test', 'Qualification', 'Final']);
  });
});

describe('FreestyleSelectionPanel peer cue (ADR 0038 / brief §4.10)', () => {
  it('marks a selection a peer panel changed, then clears the mark', () => {
    vi.useFakeTimers();
    try {
      const recorder = makeRecorder();
      const { rerender } = render(
        <FreestyleSelectionPanel selection={recorder} athletes={ATHLETES} mode="battle" />,
      );
      expect(screen.queryByText('changed by another panel')).not.toBeInTheDocument();

      rerender(
        <FreestyleSelectionPanel
          selection={recorder}
          athletes={ATHLETES}
          mode="battle"
          peerEventToken={3}
        />,
      );
      expect(screen.getByText('changed by another panel')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(PEER_FLASH_MS));
      expect(screen.queryByText('changed by another panel')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
