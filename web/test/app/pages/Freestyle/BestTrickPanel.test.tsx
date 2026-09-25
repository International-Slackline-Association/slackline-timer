import { ThemeProvider } from '@mui/material';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceBlocked, advanceOverlay } from 'app/hooks/useAdvanceInput';
import { BEST_TRICK_PAD_INLINE, BestTrickPanel } from 'app/pages/Freestyle/BestTrickPanel';
import { telemetryTheme } from 'app/theme/theme';
import { colors } from 'app/theme/tokens';
import { initialTrySeries, type TrySeriesState } from 'app/util/bestTrickSeries';

import { px } from '../../../util/computedUnits';

// Drive the gamepad button through a mock (the CountdownControl.test pattern) so
// the pad path can be exercised without the real rAF/navigator polling.
let lastPressedGamepadButton: { button: number; seq: number } | undefined;
let pressSeq = 0;
const pressButton = (button: number) => {
  pressSeq += 1;
  lastPressedGamepadButton = { button, seq: pressSeq };
};
vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton }),
}));

beforeEach(() => {
  lastPressedGamepadButton = undefined;
  pressSeq = 0;
});

// Presentational panel: it owns no series state, so the tests assert it renders
// the derived button/clock state from the `series` prop and dispatches the
// right action.
const baseProps = {
  athleteNames: { 1: 'Aiko', 2: 'Bruno' } as const,
  runningLane: null,
  defaultCap: 3,
  onArm: vi.fn(),
  onDisarm: vi.fn(),
  onSetCap: vi.fn(),
  onSetTryMs: vi.fn(),
  onStartTry: vi.fn(),
  onSkipTry: vi.fn(),
  onEndTry: vi.fn(),
  onReset: vi.fn(),
  onBlocked: vi.fn(),
};

/** A running-clock series on the given side, at the given used counts. */
const runningOn = (side: 1 | 2, used: { 1: number; 2: number }): TrySeriesState => ({
  ...initialTrySeries(3),
  used,
  clock: { running: true, side, startedAt: 0, tryMs: 30_000 },
  lastSide: side,
});

// Both sides render the same two visible labels, so the panel names them per
// side (the CountdownControl precedent) rather than leaving a test — or a
// screen reader — to address a side by DOM position.
const startTry = (side: 1 | 2) => screen.getByRole('button', { name: `Start try Athlete ${side}` });
const skip = (side: 1 | 2) => screen.getByRole('button', { name: `Skip Athlete ${side}` });
const endTry = () => screen.getByRole('button', { name: 'End try' });
const sideBlock = (side: 1 | 2) =>
  screen.getByRole('region', { name: `Best trick Athlete ${side}` });
const capGroup = () => screen.getByRole('group', { name: 'Tries' });
const capButton = (cap: number) => within(capGroup()).getByRole('button', { name: `${cap} tries` });

describe('BestTrickPanel — disarmed', () => {
  it('shows only the Begin button and arms with the round default cap', async () => {
    const onArm = vi.fn();
    render(<BestTrickPanel {...baseProps} series={null} defaultCap={5} onArm={onArm} />);
    const begin = screen.getByRole('button', { name: /begin best trick/i });
    expect(begin).toHaveTextContent('5 tries');
    await userEvent.click(begin);
    expect(onArm).toHaveBeenCalledWith(5);
  });
});

describe('BestTrickPanel — armed enable-state', () => {
  it('enables both Start try buttons while idle and disables End try', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);
    expect(startTry(1)).toBeEnabled();
    expect(startTry(2)).toBeEnabled();
    expect(endTry()).toBeDisabled();
  });

  it('disables both Start try buttons and enables End try while a clock runs', () => {
    render(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);
    expect(startTry(1)).toBeDisabled();
    expect(startTry(2)).toBeDisabled();
    expect(endTry()).toBeEnabled();
  });

  it('disables the Start try for an exhausted side', () => {
    const series: TrySeriesState = { ...initialTrySeries(2), used: { 1: 2, 2: 0 } };
    render(<BestTrickPanel {...baseProps} series={series} />);
    expect(startTry(1)).toBeDisabled();
    expect(startTry(2)).toBeEnabled();
  });

  it('dispatches onStartTry / onEndTry for the right side', async () => {
    const onStartTry = vi.fn();
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} onStartTry={onStartTry} />);
    await userEvent.click(startTry(2));
    expect(onStartTry).toHaveBeenCalledWith(2);
  });
});

// The try clock derives from the series state (controlled Countdown) — no
// message stream, no recovery side channel.
describe('BestTrickPanel try clock derives from the series', () => {
  it('rests at the armed window before any try', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3, 30_000)} />);
    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('holds the last try’s frozen remaining between tries', () => {
    const series: TrySeriesState = {
      ...initialTrySeries(3),
      used: { 1: 1, 2: 0 },
      clock: { running: false, endedMs: 12_000 },
      lastSide: 1,
    };
    render(<BestTrickPanel {...baseProps} series={series} />);
    expect(screen.getByText('00:12')).toBeInTheDocument();
  });

  it('shows TIME after a window expired (endedMs 0)', () => {
    const series: TrySeriesState = {
      ...initialTrySeries(3),
      used: { 1: 1, 2: 0 },
      clock: { running: false, endedMs: 0 },
      lastSide: 1,
    };
    render(<BestTrickPanel {...baseProps} series={series} />);
    expect(screen.getByText('TIME')).toBeInTheDocument();
  });
});

/** The one framed clock on the panel — `boxed()` strokes the numeral and
 * nothing else. */
const clockFrame = (): HTMLElement => {
  const framed = screen
    .getAllByText(/^\d\d:\d\d$/)
    .map((numeral) => numeral.parentElement as HTMLElement)
    .filter((box) => !['', 'none'].includes(window.getComputedStyle(box).borderTopStyle));
  expect(framed).toHaveLength(1);
  return framed[0];
};

// The try window is a competition clock: it takes the lane cards' `control`
// scale, so the §6 frame tiers name its state at a squint like theirs do.
describe('BestTrickPanel try clock frame tiers (FREESTYLE_BOARD_UX §6)', () => {
  it('strokes a resting window thin and neutral', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);
    const frame = window.getComputedStyle(clockFrame());
    expect(frame.borderTopColor).toBe('rgb(91, 103, 118)'); // ink.mid
    expect(px(frame.borderLeftWidth)).toBe(2);
  });

  it('widens the sides while a try counts', () => {
    render(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);
    const frame = window.getComputedStyle(clockFrame());
    expect(px(frame.borderLeftWidth)).toBe(10);
    // Weight goes to the sides only, so the rows above and below stay put.
    expect(px(frame.borderTopWidth)).toBe(2);
  });
});

describe('BestTrickPanel state word (FREESTYLE_BOARD_UX §3/§6)', () => {
  it.each([
    ['waiting on the first attempt', initialTrySeries(3), 'NEXT · Aiko'],
    ['a window is open', runningOn(2, { 1: 1, 2: 1 }), 'TRY OPEN · Bruno'],
    [
      'every try is spent',
      { ...initialTrySeries(3), used: { 1: 3, 2: 3 } } as TrySeriesState,
      'SERIES COMPLETE',
    ],
  ])('says %s', (_label, series, word) => {
    render(<BestTrickPanel {...baseProps} series={series} />);
    expect(screen.getByText(word)).toBeVisible();
  });

  it('marks the side the series waits on, and only that side', () => {
    const { rerender } = render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);
    expect(within(sideBlock(1)).getByText('ON THE LINE')).toBeVisible();
    expect(within(sideBlock(2)).queryByText('ON THE LINE')).not.toBeInTheDocument();

    // The mark follows the open window, not just the suggestion.
    rerender(<BestTrickPanel {...baseProps} series={runningOn(2, { 1: 1, 2: 1 })} />);
    expect(within(sideBlock(2)).getByText('ON THE LINE')).toBeVisible();
    expect(within(sideBlock(1)).queryByText('ON THE LINE')).not.toBeInTheDocument();
  });

  it('shows each side’s tally against the cap', () => {
    const series: TrySeriesState = { ...initialTrySeries(5), used: { 1: 2, 2: 1 } };
    render(<BestTrickPanel {...baseProps} series={series} />);
    expect(within(sideBlock(1)).getByText('2 / 5')).toBeVisible();
    expect(within(sideBlock(2)).getByText('1 / 5')).toBeVisible();
  });
});

describe('BestTrickPanel live-control contract (FREESTYLE_BOARD_UX §6)', () => {
  const minHeight = (control: HTMLElement): number =>
    px(window.getComputedStyle(control).minHeight);

  it('sizes the try pair at the 56 px race target and everything else at 44', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    for (const race of [startTry(1), startTry(2), endTry()]) {
      expect(minHeight(race)).toBeGreaterThanOrEqual(56);
    }
    const aux = [skip(1), skip(2), capButton(3), capButton(5)];
    for (const name of ['Reset series', 'Leave best trick']) {
      aux.push(screen.getByRole('button', { name }));
    }
    for (const control of aux) {
      expect(minHeight(control)).toBeGreaterThanOrEqual(44);
    }
    // The one control here that is not a button: MUI's `small` field is 40 px,
    // and the target is the input's own box (the field root the sx lands on).
    const field = screen.getByLabelText('Try (s)').parentElement as HTMLElement;
    expect(minHeight(field)).toBeGreaterThanOrEqual(44);
  });

  it('sizes Begin best trick at the aux target', () => {
    render(<BestTrickPanel {...baseProps} series={null} />);
    expect(
      minHeight(screen.getByRole('button', { name: /begin best trick/i })),
    ).toBeGreaterThanOrEqual(44);
  });

  it('makes End try the only lit control while a try is open', () => {
    const { rerender } = render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);
    // Between tries the stop fill is off — the disabled tier holds it.
    expect(endTry()).toBeDisabled();

    rerender(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);
    expect(endTry()).toBeEnabled();
    expect(endTry()).toHaveClass('MuiButton-contained');
    for (const other of [startTry(1), startTry(2), skip(1), skip(2)]) {
      expect(other).toBeDisabled();
    }
  });

  it('fills Start try only on the side the series waits for', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);
    expect(startTry(1)).toHaveClass('MuiButton-contained');
    expect(startTry(2)).toHaveClass('MuiButton-outlined');
  });

  // C12: the armed cap is drawn as a fill, so it must also be spoken — a bare
  // "3"/"5" says neither what it sets nor which of the pair is on.
  it('names the cap pair and reports the armed cap as pressed', async () => {
    const onSetCap = vi.fn();
    const { rerender } = render(
      <BestTrickPanel {...baseProps} series={initialTrySeries(3)} onSetCap={onSetCap} />,
    );

    expect(capButton(3)).toHaveAttribute('aria-pressed', 'true');
    expect(capButton(5)).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(capButton(5));
    expect(onSetCap).toHaveBeenCalledWith(5);

    rerender(<BestTrickPanel {...baseProps} series={initialTrySeries(5)} onSetCap={onSetCap} />);
    expect(capButton(5)).toHaveAttribute('aria-pressed', 'true');
    expect(capButton(3)).toHaveAttribute('aria-pressed', 'false');
  });
});

/**
 * The cap pair is the panel's one segmented SETTING, and §6 confines brand teal
 * to links and nav: MUI's contained/outlined defaults painted the chosen key in
 * the brand fill and the other in brand ink at 2.95:1 — a second primary-looking
 * action beside End try, in the one family the live path may not use.
 */
describe('BestTrickPanel cap pair paint (FREESTYLE_BOARD_UX §6)', () => {
  // The tones resolve through the TELEMETRY palette the app installs in
  // `app/index.tsx`; a bare render would read MUI's own defaults.
  const renderThemed = (ui: ReactElement) =>
    render(<ThemeProvider theme={telemetryTheme}>{ui}</ThemeProvider>);

  const rgb = (hex: string): string => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${channels.join(', ')})`;
  };

  const paintOf = (control: HTMLElement) => {
    const style = getComputedStyle(control);
    return { fill: style.backgroundColor, ink: style.color, stroke: style.borderTopColor };
  };

  it('gives the chosen key the §6 chosen-key pair, the other the panel’s neutral', () => {
    renderThemed(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    const { fill, ink } = paintOf(capButton(3));
    expect({ fill, ink }).toEqual({
      fill: rgb(colors.surface.lineStrong),
      ink: rgb(colors.ink.hi),
    });
    const other = paintOf(capButton(5));
    expect({ ink: other.ink, stroke: other.stroke }).toEqual({
      ink: rgb(colors.ink.mid),
      stroke: rgb(colors.ink.mid),
    });
  });

  // A lock may not take which option is chosen (§6): the row greys while a try
  // is open, and the armed cap has to survive it — the tally beside it counts
  // against that number.
  it('holds the chosen key’s pair while an open try locks the row', () => {
    renderThemed(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);

    expect(capButton(3)).toBeDisabled();
    const { fill, ink } = paintOf(capButton(3));
    expect({ fill, ink }).toEqual({
      fill: rgb(colors.surface.lineStrong),
      ink: rgb(colors.ink.hi),
    });
    const other = paintOf(capButton(5));
    expect({ fill: other.fill, ink: other.ink }).toEqual({
      fill: rgb(colors.surface.muted),
      ink: rgb(colors.ink.mid),
    });
  });
});

/**
 * The armed panel is the run deck's part 2 and paints the same §6 tiers the lane
 * cards do — words, digits, frame strokes, all computed on `panel` — so it is a
 * `panel` Paper like them rather than the one live-column surface left on the
 * page canvas. The disarmed step keeps §2's one-line `[Begin best trick]` row:
 * there is nothing yet for a card to hold.
 */
describe('BestTrickPanel surface (FREESTYLE_BOARD_UX §6)', () => {
  /** §6's race target: the width half of `>=56 x 120`. */
  const RACE_RESERVE_PX = 120;
  const computed = (el: Element) => window.getComputedStyle(el);

  it('draws the armed panel on the desk panel rather than the page canvas', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    expect(screen.getByTestId('best-trick-panel')).toHaveClass('MuiPaper-outlined');
  });

  it('leaves the disarmed step the bare row', () => {
    render(<BestTrickPanel {...baseProps} series={null} />);

    expect(screen.queryByTestId('best-trick-panel')).not.toBeInTheDocument();
  });

  it('pays its own inset out of the slack above the three race tracks', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    // Two Start trys and End try, plus the deck's own gutters and the panel's
    // hairline: what the live column is spent on before any inset. Read off the
    // rendered deck so a wider gutter or a fourth track fails here.
    const panel = computed(screen.getByTestId('best-trick-panel'));
    const floor =
      3 * RACE_RESERVE_PX +
      2 * px(computed(screen.getByTestId('best-trick-deck')).gap) +
      2 * px(panel.borderLeftWidth);
    // jsdom parses no `clamp()` into computed padding, so the expression is held
    // at its source against the floor the rendered panel reports.
    expect(BEST_TRICK_PAD_INLINE).toBe(`clamp(0px, (100% - ${floor}px) / 2, 16px)`);
  });

  it('reserves the 120 px race width on all three tracks', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    for (const race of [startTry(1), startTry(2), endTry()]) {
      expect(px(computed(race).minWidth)).toBeGreaterThanOrEqual(RACE_RESERVE_PX);
    }
  });
});

describe('BestTrickPanel gamepad mapping (pad 3 = side 1, pad 8 = side 2)', () => {
  it('routes pad 3 / pad 8 to onStartTry for the matching side while idle', () => {
    const onStartTry = vi.fn();
    const props = { ...baseProps, series: initialTrySeries(3), onStartTry };
    const { rerender } = render(<BestTrickPanel {...props} />);
    pressButton(3);
    rerender(<BestTrickPanel {...props} />);
    expect(onStartTry).toHaveBeenCalledWith(1);
    pressButton(8);
    rerender(<BestTrickPanel {...props} />);
    expect(onStartTry).toHaveBeenCalledWith(2);
  });

  it('routes either pad key to onEndTry while the try clock runs', () => {
    const onStartTry = vi.fn();
    const onEndTry = vi.fn();
    const props = {
      ...baseProps,
      series: runningOn(1, { 1: 1, 2: 0 }),
      onStartTry,
      onEndTry,
    };
    const { rerender } = render(<BestTrickPanel {...props} />);
    pressButton(8);
    rerender(<BestTrickPanel {...props} />);
    expect(onEndTry).toHaveBeenCalledTimes(1);
    expect(onStartTry).not.toHaveBeenCalled();
  });

  // A blocked key is not a swallowed key (§3's no-op row): the panel hands the
  // board the very lock the button beside it greys on, and the board answers in
  // its words — so the pad and the screen cannot say two things.
  it('hands back the spent-tally lock for an exhausted side', () => {
    const onStartTry = vi.fn();
    const onBlocked = vi.fn();
    const series: TrySeriesState = { ...initialTrySeries(2), used: { 1: 2, 2: 0 } };
    const props = { ...baseProps, series, onStartTry, onBlocked };
    const { rerender } = render(<BestTrickPanel {...props} />);
    pressButton(3);
    rerender(<BestTrickPanel {...props} />);
    expect(onStartTry).not.toHaveBeenCalled();
    expect(onBlocked.mock.calls).toEqual([[{ kind: 'triesSpent', cap: 2 }]]);
  });

  it('hands back the not-armed lock while disarmed', () => {
    const onStartTry = vi.fn();
    const onEndTry = vi.fn();
    const onBlocked = vi.fn();
    const props = { ...baseProps, series: null, onStartTry, onEndTry, onBlocked };
    const { rerender } = render(<BestTrickPanel {...props} />);
    pressButton(3);
    rerender(<BestTrickPanel {...props} />);
    expect(onStartTry).not.toHaveBeenCalled();
    expect(onEndTry).not.toHaveBeenCalled();
    expect(onBlocked.mock.calls).toEqual([[{ kind: 'notArmed' }]]);
  });

  it('ignores the lane-block pad buttons (no cross-talk with the lane mapping)', () => {
    const onStartTry = vi.fn();
    const onEndTry = vi.fn();
    const onBlocked = vi.fn();
    const props = { ...baseProps, series: initialTrySeries(3), onStartTry, onEndTry, onBlocked };
    const { rerender } = render(<BestTrickPanel {...props} />);
    pressButton(0);
    rerender(<BestTrickPanel {...props} />);
    expect(onStartTry).not.toHaveBeenCalled();
    expect(onEndTry).not.toHaveBeenCalled();
    // Not this panel's key at all: answering it would answer for the lane card.
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

// Brief §4.8: the tally is unrecoverable once tries have been spent, so the two
// series-wide presses ask — but only then; an untouched series clears without a
// question.
describe('BestTrickPanel — Reset series guard', () => {
  const clickReset = async () =>
    userEvent.click(screen.getByRole('button', { name: 'Reset series' }));

  it('resets straight through while no try has been used', async () => {
    const onReset = vi.fn();
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} onReset={onReset} />);
    await clickReset();
    expect(onReset).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts once a try has been used, naming the tally at risk', async () => {
    const onReset = vi.fn();
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 2, 2: 1 } };
    render(<BestTrickPanel {...baseProps} series={series} onReset={onReset} />);
    await clickReset();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Aiko has used 2 of 3 tries, Bruno 1/)).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset series' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('keeps the series when the prompt is dismissed', async () => {
    const onReset = vi.fn();
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 1, 2: 0 } };
    render(<BestTrickPanel {...baseProps} series={series} onReset={onReset} />);
    await clickReset();

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep series' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onReset).not.toHaveBeenCalled();
  });

  it('answers with the button the guard registered', async () => {
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 1, 2: 0 } };
    render(<BestTrickPanel {...baseProps} series={series} />);
    await clickReset();
    await screen.findByRole('dialog');

    expect(advanceOverlay()?.confirm).toEqual({
      dialog: 'Reset series',
      safeAction: 'Keep series',
    });
    expect(document.activeElement?.textContent).toBe(advanceOverlay()?.confirm?.safeAction);
  });

  it('answers an ADVANCE press behind the prompt with Keep series', async () => {
    const onReset = vi.fn();
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 1, 2: 0 } };
    render(<BestTrickPanel {...baseProps} series={series} onReset={onReset} />);
    await clickReset();
    await screen.findByRole('dialog');

    const safeClose = advanceBlocked();
    expect(safeClose).not.toBeNull();
    act(() => safeClose?.());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onReset).not.toHaveBeenCalled();
  });

  // Brief §4.8: the question owns the board, and only ADVANCE answers it — the
  // orange key is inert while it stands, like the lane keys behind their own.
  it('holds the try keys while the prompt stands', async () => {
    const onStartTry = vi.fn();
    const onEndTry = vi.fn();
    const onBlocked = vi.fn();
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 1, 2: 0 } };
    const panel = () => (
      <BestTrickPanel
        {...baseProps}
        series={series}
        onStartTry={onStartTry}
        onEndTry={onEndTry}
        onBlocked={onBlocked}
      />
    );
    const { rerender } = render(panel());
    await clickReset();
    await screen.findByRole('dialog');

    pressButton(3);
    rerender(panel());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onStartTry).not.toHaveBeenCalled();
    expect(onEndTry).not.toHaveBeenCalled();
    // Silent, not answered: the question owns the board, so the key reports no
    // lock of its own — the way out is on screen already.
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('re-reads the tally live so a peer try cannot stale the question', async () => {
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 1, 2: 0 } };
    const { rerender } = render(<BestTrickPanel {...baseProps} series={series} />);
    await clickReset();
    const dialog = await screen.findByRole('dialog');

    rerender(
      <BestTrickPanel {...baseProps} series={{ ...initialTrySeries(3), used: { 1: 1, 2: 1 } }} />,
    );
    expect(within(dialog).getByText(/Aiko has used 1 of 3 tries, Bruno 1/)).toBeInTheDocument();
  });

  // A peer reset the series while the question stood: with the tally spent
  // back to zero there is nothing left to lose, so the question goes — and it
  // stays gone. Held behind the closed dialog, the press re-opened it the next
  // time a try was spent, mid-series and unasked for (rubric C04).
  it('closes on a peer reset and does not re-ask on the next try', async () => {
    const onReset = vi.fn();
    const panel = (series: TrySeriesState) => (
      <BestTrickPanel {...baseProps} series={series} onReset={onReset} />
    );
    const { rerender } = render(panel({ ...initialTrySeries(3), used: { 1: 1, 2: 0 } }));
    await clickReset();
    await screen.findByRole('dialog');

    rerender(panel(initialTrySeries(3)));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(panel({ ...initialTrySeries(3), used: { 1: 1, 2: 0 } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });
});

// Leaving disarms the series (`DISARM` → `series = null`), so it destroys the
// same tally Reset series asks about: it shares the question (§4.8).
describe('BestTrickPanel — Leave best trick guard', () => {
  const used: TrySeriesState = { ...initialTrySeries(3), used: { 1: 2, 2: 1 } };
  const clickLeave = async () =>
    userEvent.click(screen.getByRole('button', { name: 'Leave best trick' }));

  it('leaves straight through while no try has been used', async () => {
    const onDisarm = vi.fn();
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} onDisarm={onDisarm} />);
    await clickLeave();
    expect(onDisarm).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts once a try has been used, naming the tally at risk', async () => {
    const onDisarm = vi.fn();
    render(<BestTrickPanel {...baseProps} series={used} onDisarm={onDisarm} />);
    await clickLeave();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Aiko has used 2 of 3 tries, Bruno 1/)).toBeInTheDocument();
    expect(onDisarm).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave best trick' }));
    expect(onDisarm).toHaveBeenCalled();
  });

  it('keeps the series when the prompt is dismissed', async () => {
    const onDisarm = vi.fn();
    render(<BestTrickPanel {...baseProps} series={used} onDisarm={onDisarm} />);
    await clickLeave();

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep series' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDisarm).not.toHaveBeenCalled();
  });

  it('answers an ADVANCE press behind the prompt with Keep series', async () => {
    const onDisarm = vi.fn();
    render(<BestTrickPanel {...baseProps} series={used} onDisarm={onDisarm} />);
    await clickLeave();
    await screen.findByRole('dialog');

    const safeClose = advanceBlocked();
    expect(safeClose).not.toBeNull();
    act(() => safeClose?.());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDisarm).not.toHaveBeenCalled();
  });

  it('asks the leave question, not the reset one (one dialog, two names)', async () => {
    const onDisarm = vi.fn();
    const onReset = vi.fn();
    render(<BestTrickPanel {...baseProps} series={used} onDisarm={onDisarm} onReset={onReset} />);
    await clickLeave();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Reset series' })).not.toBeInTheDocument();
    expect(advanceOverlay()?.confirm).toEqual({
      dialog: 'Leave best trick',
      safeAction: 'Keep series',
    });
    // The readout announces that answer by name, so the focused safe button is
    // the registration itself, not a second copy of the word (§4.14).
    expect(document.activeElement?.textContent).toBe(advanceOverlay()?.confirm?.safeAction);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave best trick' }));
    expect(onReset).not.toHaveBeenCalled();
    expect(onDisarm).toHaveBeenCalled();
  });
});

/** The words a locked control carries — the Tooltip's `describeChild` title on
 * the wrapper span, since a disabled button fires no pointer events. */
const blockerOf = (control: HTMLElement): string | null =>
  control.parentElement?.getAttribute('title') ?? null;

describe('BestTrickPanel interlocks (FREESTYLE_BOARD_UX §4.7)', () => {
  it('locks Begin best trick while a lane still runs, and says who', () => {
    render(<BestTrickPanel {...baseProps} series={null} runningLane={2} />);
    const begin = screen.getByRole('button', { name: /begin best trick/i });

    expect(begin).toBeDisabled();
    expect(blockerOf(begin)).toBe('locked while Athlete 2 runs');
    // …on the panel, not only in a Tooltip a gloved hand never hovers.
    expect(screen.getByText('why: locked while Athlete 2 runs')).toBeVisible();
  });

  it('names the open try on both sides, the cap and the window', () => {
    render(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);

    for (const start of [startTry(1), startTry(2)]) {
      expect(blockerOf(start)).toBe('locked while a try is open');
    }
    for (const control of [skip(1), skip(2)]) {
      expect(control).toBeDisabled();
      expect(blockerOf(control)).toBe('locked while a try is open');
    }
    expect(screen.getAllByText('why: locked while a try is open')).toHaveLength(2);
    const cap = capButton(5);
    expect(cap).toBeDisabled();
    expect(blockerOf(cap)).toBe('locked while a try is open');
    expect(screen.getByLabelText('Try (s)')).toBeDisabled();
  });

  it('names the spent tally on an exhausted side', () => {
    const series: TrySeriesState = { ...initialTrySeries(3), used: { 1: 3, 2: 0 } };
    render(<BestTrickPanel {...baseProps} series={series} />);

    expect(blockerOf(startTry(1))).toBe('all 3 tries used');
    expect(blockerOf(startTry(2))).toBe('');
    expect(within(sideBlock(1)).getByText('why: all 3 tries used')).toBeVisible();
  });

  it('names why End try is inert between tries', () => {
    render(<BestTrickPanel {...baseProps} series={initialTrySeries(3)} />);

    expect(blockerOf(endTry())).toBe('no try is open');
  });

  // The two presses that end the series. Best trick is the phase after both
  // turns, so a live run holds them with the rest of the panel; an open try
  // does not — they are the way out, and the tally confirm is their guard.
  it('locks Reset series and Leave best trick behind a live run', () => {
    const { rerender } = render(
      <BestTrickPanel {...baseProps} series={initialTrySeries(3)} runningLane={1} />,
    );

    for (const verb of ['Reset series', 'Leave best trick']) {
      const control = screen.getByRole('button', { name: verb });
      expect(control).toBeDisabled();
      expect(blockerOf(control)).toBe('locked while Athlete 1 runs');
    }

    rerender(<BestTrickPanel {...baseProps} series={runningOn(1, { 1: 1, 2: 0 })} />);

    for (const verb of ['Reset series', 'Leave best trick']) {
      expect(screen.getByRole('button', { name: verb })).toBeEnabled();
    }
  });

  it('hands back the running-lane lock on a try pad key', () => {
    const onStartTry = vi.fn();
    const onBlocked = vi.fn();
    const props = {
      ...baseProps,
      series: initialTrySeries(3),
      runningLane: 1 as const,
      onStartTry,
      onBlocked,
    };
    const { rerender } = render(<BestTrickPanel {...props} />);

    pressButton(3);
    rerender(<BestTrickPanel {...props} />);

    expect(onStartTry).not.toHaveBeenCalled();
    expect(onBlocked.mock.calls).toEqual([[{ kind: 'hold', hold: { kind: 'running', lane: 1 } }]]);
  });
});
