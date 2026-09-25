import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ScoreRecorder } from 'app/hooks/useScoreRecorder';
import { FreestyleScoreControls } from 'app/pages/Freestyle/FreestyleScoreControls';
import type { Athlete } from 'app/types';
import type { LaneState } from 'app/util/battleMachine';
import type { SavedScore, ScoreFields, SlotEntry } from 'app/util/scoreInput';

import { SCORE_RAIL_CONTENT_PX } from '../../../util/deskGeometry';
import { REQUIRED_SLACK_CHARS, charsPerLine, longestLine } from '../../../util/lineBudget';

const athlete = (athleteId: string, name: string): Athlete => ({
  athleteId,
  compId: 'c1',
  name,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  shortName: name.split(' ')[0],
  birthDate: '1990-01-01',
  country: 'USA',
  gender: 'male',
});

const ATHLETES = [athlete('a1', 'Jane Doe'), athlete('a2', 'John Roe')];
const EMPTY_FIELDS: ScoreFields = {
  difficulty: 0,
  combo: 0,
  style: 0,
  bestTrick: 0,
  controlPenalty: 0,
};

const editing = (fields: Partial<ScoreFields>, override: string | null = null): SlotEntry => ({
  status: 'editing',
  fields: { ...EMPTY_FIELDS, ...fields },
  override,
});

const saved = (overall: number, dnf = false): SlotEntry => ({
  status: 'saved',
  fields: { ...EMPTY_FIELDS },
  override: null,
  result: { overall, dnf },
  origin: 'live',
});

const failed = (reason: string, dnf = false): SlotEntry => ({
  status: 'error',
  fields: { ...EMPTY_FIELDS, difficulty: 26 },
  override: null,
  result: { overall: 26, dnf },
  reason,
});

/** The Score row a slot has on the server — here, one saved under `athleteId`. */
const record = (athleteId: string, overall = 26, dnf = false): SavedScore => ({
  scoreId: 's1',
  input: { athleteId, round: 'qualification', ...EMPTY_FIELDS, ...(dnf ? { dnf } : {}) },
  result: { overall, dnf },
});

const pending = (): SlotEntry => ({
  status: 'pending',
  fields: { ...EMPTY_FIELDS },
  override: null,
  result: { overall: 0, dnf: false },
});

const makeRecorder = (over: Partial<ScoreRecorder> = {}): ScoreRecorder =>
  ({
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
    canSwapAthletes: false,
    swapAthletes: vi.fn(),
    entries: { 1: { status: 'empty' }, 2: { status: 'empty' } },
    records: { 1: null, 2: null },
    moveScore: vi.fn(),
    movingSlot: null,
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
    scores: { data: [] } as never,
    updateMatch: { isError: false, error: null } as never,
    retryMatchUpdate: vi.fn(),
    derivedWinner: null,
    applySelection: vi.fn(),
    ...over,
  }) as ScoreRecorder;

type Rail = NonNullable<ComponentProps<typeof FreestyleScoreControls>['resetLanes']>;

const idleLane = (budgetMs = 420_000): LaneState => ({
  phase: 'idle',
  budgetMs,
  armedMs: 420_000,
  breaksLeft: 0,
});

const rail = (over: Partial<Rail> = {}): Rail => ({
  lanes: { 1: idleLane(), 2: idleLane() },
  runningLane: null,
  bestTrickArmed: false,
  onReset: vi.fn(),
  ...over,
});

const renderPanel = (
  recorder: ScoreRecorder,
  mode: 'quali' | 'battle' = 'battle',
  resetLanes?: Rail,
) =>
  render(
    <FreestyleScoreControls
      scoring={recorder}
      athletes={ATHLETES}
      mode={mode}
      resetLanes={resetLanes}
    />,
  );

const saveButton = (slot: 1 | 2 = 1, label: 'Save' | 'Retry save' = 'Save') =>
  screen.getByRole('button', { name: `${label} Athlete ${slot}` });
const dnfButton = (slot: 1 | 2 = 1) => screen.getByRole('button', { name: `DNF Athlete ${slot}` });

describe('FreestyleScoreControls', () => {
  it('labels the combo component "Combo"', () => {
    renderPanel(makeRecorder());
    expect(screen.getAllByLabelText(/^combo$/i).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/composition/i)).toBeNull();
  });

  it('orders the judged components as the manual lists them', () => {
    const { container } = renderPanel(makeRecorder({ round: 'final' }));
    const order = Array.from(container.querySelectorAll('label'))
      .map((label) => label.textContent ?? '')
      .filter((text) => /^(Difficulty|Combo|Style|Best trick|Control penalty|Overall)$/.test(text))
      .slice(0, 6);
    expect(order).toEqual([
      'Difficulty',
      'Combo',
      'Style',
      'Best trick',
      'Control penalty',
      'Overall',
    ]);
  });

  it('previews the computed overall from the components', () => {
    renderPanel(
      makeRecorder({
        round: 'final',
        entries: {
          1: editing({ difficulty: 5, combo: 4, style: 3, bestTrick: 2, controlPenalty: 1 }),
          2: { status: 'empty' },
        },
      }),
    );
    expect((screen.getAllByLabelText(/overall/i)[0] as HTMLInputElement).value).toBe('13');
  });

  it('hides battle-only fields in qualification and shows them in battle', () => {
    const { unmount } = renderPanel(
      makeRecorder({
        round: 'qualification',
        entries: {
          1: editing({ difficulty: 5, combo: 4, style: 3, bestTrick: 2, controlPenalty: 1 }),
          2: { status: 'empty' },
        },
      }),
      'quali',
    );
    expect(screen.queryByLabelText(/best trick/i)).toBeNull();
    expect(screen.queryByLabelText(/control penalty/i)).toBeNull();
    expect((screen.getAllByLabelText(/overall/i)[0] as HTMLInputElement).value).toBe('12');
    unmount();

    renderPanel(makeRecorder({ round: 'final' }), 'battle');
    expect(screen.getAllByLabelText(/best trick/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/control penalty/i).length).toBeGreaterThan(0);
  });

  // §4.11: the panel is typed on the numpad — five components, Overall, Save.
  // `use computed` is an end-adornment INSIDE the Overall field, so it used to
  // land between the last number and the press that records it.
  it('keeps `use computed` out of the Overall → Save tab run', async () => {
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: '' },
        entries: { 1: editing({ difficulty: 20 }, '26'), 2: { status: 'empty' } },
      }),
      'quali',
    );
    const overall = screen.getAllByLabelText(/overall/i)[0] as HTMLInputElement;
    overall.focus();

    await userEvent.tab();

    expect(document.activeElement).toBe(saveButton(1));
  });

  it('applies the computed overall from the adornment a pointer can still reach', async () => {
    const setOverride = vi.fn();
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: '' },
        entries: { 1: editing({ difficulty: 20 }, '26'), 2: { status: 'empty' } },
        setOverride,
      }),
      'quali',
    );

    await userEvent.click(screen.getByRole('button', { name: 'use computed Athlete 1' }));

    expect(setOverride).toHaveBeenCalledWith(1, null);
  });

  it('renders both athlete panels in battle and only Athlete 1 in quali', () => {
    const { unmount } = renderPanel(makeRecorder(), 'battle');
    expect(screen.getByText(/^Athlete 1/)).toBeInTheDocument();
    expect(screen.getByText(/^Athlete 2/)).toBeInTheDocument();
    unmount();

    renderPanel(makeRecorder(), 'quali');
    expect(screen.getByText(/^Athlete 1/)).toBeInTheDocument();
    expect(screen.queryByText(/^Athlete 2/)).not.toBeInTheDocument();
  });

  it('names the assigned athlete in the athlete panel heading', () => {
    renderPanel(makeRecorder({ athletes: { 1: 'a1', 2: '' } }), 'quali');
    expect(screen.getByText(/Athlete 1 — Jane Doe/)).toBeInTheDocument();
  });

  it('disables Save until an athlete is assigned and saves by athlete name', () => {
    const recordScore = vi.fn();
    const { rerender } = renderPanel(makeRecorder({ recordScore }), 'quali');
    expect(saveButton()).toBeDisabled();

    rerender(
      <FreestyleScoreControls
        scoring={makeRecorder({ athletes: { 1: 'a1', 2: '' }, recordScore })}
        athletes={ATHLETES}
        mode="quali"
      />,
    );

    fireEvent.click(saveButton());
    expect(recordScore).toHaveBeenCalledWith(1);
  });

  it('disables DNF until an athlete is assigned and marks the athlete DNF', () => {
    const recordDnf = vi.fn();
    const { rerender } = renderPanel(makeRecorder({ recordDnf }), 'quali');
    expect(dnfButton()).toBeDisabled();

    rerender(
      <FreestyleScoreControls
        scoring={makeRecorder({ athletes: { 1: 'a1', 2: '' }, recordDnf })}
        athletes={ATHLETES}
        mode="quali"
      />,
    );

    fireEvent.click(dnfButton());
    expect(recordDnf).toHaveBeenCalledWith(1);
  });

  it('flags an over-cap component and blocks Save', () => {
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: '' },
        entries: { 1: editing({ difficulty: 41 }), 2: { status: 'empty' } },
      }),
      'quali',
    );
    expect(screen.getByText(/max 40/i)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('shows the saved status and correction link for an athlete slot', () => {
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: '' },
        entries: { 1: saved(26), 2: { status: 'empty' } },
      }),
      'quali',
    );
    expect(screen.getByText(/saved 26\.00/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /scores page/i })).toHaveAttribute(
      'href',
      '/admin/scores?athlete=a1&round=qualification',
    );
    expect(saveButton()).toBeDisabled();
    expect(dnfButton()).toBeDisabled();
  });

  it('keeps failed values and retries the same athlete save', () => {
    const recordScore = vi.fn();
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: '' },
        entries: { 1: failed('network'), 2: { status: 'empty' } },
        recordScore,
      }),
      'quali',
    );
    expect(screen.getByText(/not saved · network/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/difficulty/i) as HTMLInputElement).value).toBe('26');
    fireEvent.click(saveButton(1, 'Retry save'));
    expect(recordScore).toHaveBeenCalledWith(1);
  });

  it('shows the winner line once both athlete slots are saved', () => {
    renderPanel(
      makeRecorder({
        selectedMatchId: 'm1',
        entries: { 1: saved(28), 2: saved(24) },
        derivedWinner: { winnerId: 'a1', source: 'derived' },
      }),
      'battle',
    );
    expect(screen.getByText(/derived from both saved scores/i)).toBeInTheDocument();
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
  });

  it('offers reset lanes after both athlete slots are saved and names the held athlete', () => {
    const onReset = vi.fn();
    renderPanel(
      makeRecorder({
        entries: { 1: saved(28), 2: saved(24) },
      }),
      'battle',
      rail({ lanes: { 1: idleLane(), 2: idleLane(120_000) }, onReset }),
    );

    fireEvent.click(screen.getByRole('button', { name: /reset lanes for the next match/i }));

    const dialog = screen.getByRole('dialog', { name: 'Reset lanes?' });
    expect(
      within(dialog).getByText(
        'Athlete 2 holds 02:00 of 07:00 — resetting re-arms both lanes for the next match. ' +
          'The saved scores are not affected.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^reset lanes$/i }));
    expect(onReset).toHaveBeenCalled();
  });

  // The freestyle twin of the lane card's "Move time to …": the panel reopens
  // for the next athlete, but the row it wrote is still named — and re-filable
  // in one press.
  describe('a row saved under another athlete', () => {
    const misfiled = (over: Partial<ScoreRecorder> = {}) =>
      makeRecorder({
        athletes: { 1: 'a2', 2: '' },
        records: { 1: record('a1'), 2: null },
        ...over,
      });

    const moveButton = (name = 'John Roe', slot: 1 | 2 = 1) =>
      screen.getByRole('button', { name: `Move score to ${name} Athlete ${slot}` });

    it('names the athlete it is stored under and offers to move it', () => {
      const moveScore = vi.fn();
      renderPanel(misfiled({ moveScore }), 'quali');

      // The status slot stays the truth about the save: it belongs to Jane,
      // not to whoever the slot now carries.
      expect(screen.getByText('SAVED 26.00 · Jane Doe')).toBeInTheDocument();
      fireEvent.click(moveButton());
      expect(moveScore).toHaveBeenCalledWith(1);
    });

    it('holds the press inert while the move is on the wire', () => {
      renderPanel(misfiled({ movingSlot: 1 }), 'quali');

      expect(moveButton()).toBeDisabled();
    });

    it('offers nothing while the row is filed under the slot’s own athlete', () => {
      renderPanel(
        makeRecorder({
          athletes: { 1: 'a1', 2: '' },
          records: { 1: record('a1'), 2: null },
          entries: { 1: saved(26), 2: { status: 'empty' } },
        }),
        'quali',
      );

      expect(screen.getByText('SAVED 26.00')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Move score/ })).toBeNull();
      expect(screen.getByRole('link', { name: /scores page/i })).toBeInTheDocument();
    });

    it('keeps both new lines inside the score rail’s own wrap budget', () => {
      // The same model the lane card's why-line is held to (`lineBudget`), at
      // the rail's width: a status that wraps is a status the operator reads
      // twice, and these two lines carry a name they did not choose.
      renderPanel(misfiled(), 'quali');
      const chars = charsPerLine(SCORE_RAIL_CONTENT_PX);

      for (const line of ['SAVED 26.00 · Jane Doe', 'Move score to John Roe']) {
        expect(longestLine(line, chars)).toBeLessThanOrEqual(chars - REQUIRED_SLACK_CHARS);
      }
    });
  });

  it('blocks Save and DNF while that athlete POST is in flight', () => {
    renderPanel(
      makeRecorder({
        athletes: { 1: 'a1', 2: 'a2' },
        entries: { 1: pending(), 2: { status: 'empty' } },
      }),
    );
    expect(saveButton()).toBeDisabled();
    expect(dnfButton()).toBeDisabled();
  });
});
