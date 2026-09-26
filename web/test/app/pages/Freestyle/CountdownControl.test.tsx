import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceBlocked, advanceOverlay } from 'app/hooks/useAdvanceInput';
import { PEER_FLASH_MS } from 'app/hooks/usePeerFlash';
import { CountdownControl } from 'app/pages/Freestyle/CountdownControl';
import type { LaneState } from 'app/util/battleMachine';

import { px } from '../../../util/computedUnits';

// Drive the gamepad button through a mock so the pad path (dispatch to the page
// reducer) can be exercised without the real rAF/navigator polling. The hook
// returns a `{ button, seq }` token; `pressButton` mints a fresh seq so a
// repeated button still re-fires the consumer effect.
let lastPressedGamepadButton: { button: number; seq: number } | undefined;
let pressSeq = 0;
const pressButton = (button: number) => {
  pressSeq += 1;
  lastPressedGamepadButton = { button, seq: pressSeq };
};
vi.mock('app/hooks/useGamepads', () => ({
  useGamepads: () => ({ lastPressedGamepadButton }),
}));

const BUDGET = 120_000;

/** A lane in the given phase at the default budget/allowance — the control is
 * presentational (ADR 0032), so every test drives it through this one prop. */
const lane = (phase: LaneState['phase'], breaksLeft = 2): LaneState => {
  switch (phase) {
    case 'idle':
      return { phase: 'idle', budgetMs: BUDGET, armedMs: BUDGET, breaksLeft };
    case 'running':
      return {
        phase: 'running',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        startedAt: Date.now(),
        breaksLeft,
      };
    case 'onBreak':
      return {
        phase: 'onBreak',
        budgetMs: BUDGET,
        armedMs: BUDGET,
        breakMs: 30_000,
        breakStartedAt: Date.now(),
        breaksLeft,
      };
    case 'finished':
      return { phase: 'finished', armedMs: BUDGET, breaksLeft };
  }
};

// The control owns no timer state: the tests assert it renders the derived
// button state from the `lane` prop and dispatches the right action, rather
// than driving a local countdown.
const baseProps = {
  id: 1 as const,
  runningLane: null,
  bestTrickArmed: false,
  lane: lane('idle'),
  // Default to quali so the advisory Take-break button is present; the battle
  // tests override the mode.
  mode: 'quali' as const,
  onStart: () => {},
  onStop: () => {},
  onReset: () => {},
  onTakeBreak: () => {},
  onBlocked: () => {},
};

beforeEach(() => {
  lastPressedGamepadButton = undefined;
  pressSeq = 0;
});

describe('CountdownControl button state derives from the lane phase', () => {
  it('enables Start/Reset and disables Stop while idle', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop Athlete 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeEnabled();
  });

  it('disables Start and enables Stop while running', () => {
    render(<CountdownControl {...baseProps} lane={lane('running')} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop Athlete 1' })).toBeEnabled();
  });

  it('keeps Start enabled during a break (Start doubles as the break cancel)', () => {
    render(<CountdownControl {...baseProps} lane={lane('onBreak')} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Stop Athlete 1' })).toBeDisabled();
  });

  it('disables Start when finished (budget spent)', () => {
    render(<CountdownControl {...baseProps} lane={lane('finished')} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeDisabled();
  });

  it('disables every control when the other lane is running (mutual exclusion)', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} runningLane={2} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeDisabled();
  });
});

describe('CountdownControl clock derives from the lane state', () => {
  it('shows the armed budget while idle (not 0:00)', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} />);
    // On the quali desk the (hidden) held-run reserve mounts a second copy of
    // the numeral, so the budget text can appear more than once — the point is
    // that the lane reads its budget, not 0:00, from mount.
    expect(screen.getAllByText('02:00').length).toBeGreaterThan(0);
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('shows the held budget and the break clock while on break', () => {
    render(
      <CountdownControl
        {...baseProps}
        lane={{
          phase: 'onBreak',
          budgetMs: 45_000,
          armedMs: BUDGET,
          breakMs: 30_000,
          breakStartedAt: Date.now(),
          breaksLeft: 1,
        }}
      />,
    );
    expect(screen.getByText('00:45')).toBeInTheDocument();
    expect(screen.getByText('00:30')).toBeInTheDocument();
    // The allowance is the card's state word — the clock's own broadcast
    // caption would only repeat it here (§6).
    expect(screen.getByText('BREAK · 1 LEFT')).toBeVisible();
  });
});

/** The one framed clock on the card — `boxed()` strokes the main numeral and
 * nothing else, so the bordered ancestor picks it out of the reserved rows that
 * mirror the same digits. */
const clockFrame = (): HTMLElement => {
  const framed = screen
    .getAllByText(/^\d\d:\d\d$/)
    .map((numeral) => numeral.parentElement as HTMLElement)
    .filter((box) => !['', 'none'].includes(window.getComputedStyle(box).borderTopStyle));
  expect(framed).toHaveLength(1);
  return framed[0];
};

/** A lane's horizontal footprint: the stroke plus the padding that compensates
 * it. Constant across every state, or the transport moves under the hand. */
const frameFootprint = (frame: HTMLElement): number => {
  const style = window.getComputedStyle(frame);
  return px(style.borderLeftWidth) + px(style.paddingLeft);
};

const held: LaneState = { phase: 'idle', budgetMs: 88_000, armedMs: BUDGET, breaksLeft: 2 };

describe('CountdownControl state word (FREESTYLE_BOARD_UX §3/§6)', () => {
  // The squint test: at 25 % scale the word, not the digits, names the state.
  it.each([
    ['idle', lane('idle'), 'READY'],
    ['running', lane('running'), 'RUNNING'],
    ['onBreak', lane('onBreak', 1), 'BREAK · 1 LEFT'],
    ['finished', lane('finished'), 'FINISHED'],
    ['held (a turn was taken off it)', held, 'TURN TAKEN · 01:28 held'],
  ])('says %s', (_label, state, word) => {
    render(<CountdownControl {...baseProps} lane={state} />);
    expect(screen.getByText(word)).toBeVisible();
  });

  it('labels a spent lane TIME under the held 00:00', () => {
    render(<CountdownControl {...baseProps} lane={lane('finished')} />);
    expect(screen.getByText('TIME')).toBeVisible();
  });
});

describe('CountdownControl frame tiers (FREESTYLE_BOARD_UX §6)', () => {
  it('strokes an armed lane thin and neutral', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} />);
    const frame = window.getComputedStyle(clockFrame());
    expect(frame.borderTopColor).toBe('rgb(91, 103, 118)'); // ink.mid
    expect(frame.borderTopStyle).toBe('solid');
    expect(px(frame.borderLeftWidth)).toBe(2);
  });

  it('breaks the stroke on a lane that ran — never the armed one', () => {
    // The S02 finding: `phase` is `idle` for both, so only `armedMs` separates
    // them. Colour alone would not (WCAG 1.4.1), hence the dash.
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('idle')} />);
    expect(window.getComputedStyle(clockFrame()).borderTopStyle).toBe('solid');
    rerender(<CountdownControl {...baseProps} lane={held} />);
    expect(window.getComputedStyle(clockFrame()).borderTopStyle).toBe('dashed');
  });

  it('widens the sides while the lane counts', () => {
    render(<CountdownControl {...baseProps} lane={lane('running')} />);
    const frame = window.getComputedStyle(clockFrame());
    expect(px(frame.borderLeftWidth)).toBe(10);
    expect(px(frame.borderRightWidth)).toBe(10);
    // Weight goes to the sides only, so the rows above and below stay put.
    expect(px(frame.borderTopWidth)).toBe(2);
  });

  it('keeps the frame footprint constant across every lane state', () => {
    const states: LaneState[] = [lane('idle'), lane('running'), held, lane('finished')];
    const { rerender } = render(<CountdownControl {...baseProps} lane={states[0]} />);
    const footprint = frameFootprint(clockFrame());
    for (const state of states.slice(1)) {
      rerender(<CountdownControl {...baseProps} lane={state} />);
      expect(frameFootprint(clockFrame())).toBe(footprint);
    }
  });
});

describe('CountdownControl live-control contract (FREESTYLE_BOARD_UX §6)', () => {
  const minHeight = (button: HTMLElement): number => px(window.getComputedStyle(button).minHeight);

  it('sizes Start and Stop at the 56 px race target and the aux controls at 44', () => {
    render(<CountdownControl {...baseProps} lane={lane('running')} />);
    expect(
      minHeight(screen.getByRole('button', { name: 'Start Athlete 1' })),
    ).toBeGreaterThanOrEqual(56);
    expect(
      minHeight(screen.getByRole('button', { name: 'Stop Athlete 1' })),
    ).toBeGreaterThanOrEqual(56);
    expect(minHeight(screen.getByRole('button', { name: /Take break/ }))).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      minHeight(screen.getByRole('button', { name: 'Reset Athlete 1' })),
    ).toBeGreaterThanOrEqual(44);
  });

  it('fills Start only on the ADVANCE target, so one Start is ever the loud one', () => {
    const { rerender } = render(<CountdownControl {...baseProps} isAdvanceTarget />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toHaveClass(
      'MuiButton-contained',
    );
    rerender(<CountdownControl {...baseProps} isAdvanceTarget={false} />);
    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toHaveClass(
      'MuiButton-outlined',
    );
  });

  // The Reset confirm's destructive answer is a live control too: it comes from
  // `RaceButton`, so it carries the aux target and the blur rule (§4.4/§6). A
  // hand-painted stop fill looks identical and keeps the focus the press gives
  // it — enough to swallow the next buzzer press once the dialog is gone.
  it('answers the Reset confirm through a race control, blur rule and all', async () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('running')} />);
    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} />);
    const dialog = await screen.findByRole('dialog');
    const answer = within(dialog).getByRole('button', { name: 'Reset Athlete 1' });

    expect(minHeight(answer)).toBeGreaterThanOrEqual(44);
    const press = createEvent.mouseDown(answer);
    fireEvent(answer, press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('renders the blocker on the card, not only in a Tooltip', () => {
    const { rerender } = render(<CountdownControl {...baseProps} runningLane={2} />);
    expect(screen.getByText('why: locked while Athlete 2 runs')).toBeVisible();
    // A lane that can act explains nothing — the row stays, its words go.
    rerender(<CountdownControl {...baseProps} lane={lane('idle')} />);
    expect(screen.queryByText(/^why:/)).not.toBeInTheDocument();
  });
});

describe('CountdownControl transport row geometry (FREESTYLE_BOARD_UX §6)', () => {
  /** §6's race target: the width half of `≥56 × 120`. */
  const RACE_RESERVE_PX = 120;

  const button = (name: string) => screen.getByRole('button', { name });
  const computed = (el: Element) => window.getComputedStyle(el);

  it('reserves the 120 px race width for Start and Stop', () => {
    render(<CountdownControl {...baseProps} />);

    for (const name of ['Start Athlete 1', 'Stop Athlete 1']) {
      expect(px(computed(button(name)).minWidth)).toBeGreaterThanOrEqual(RACE_RESERVE_PX);
    }
  });

  it('splits the card between the pair rather than centring a fixed island', () => {
    render(<CountdownControl {...baseProps} />);

    // Two equal tracks, not two content-width buttons: the same row has to sit
    // in a 256 px battle lane and a 560 px quali card, and the operator's hand
    // learns one place per press.
    const row = screen.getByTestId('lane-transport');
    expect(computed(row).gridTemplateColumns).toBe('1fr 1fr');
    expect(computed(button('Start Athlete 1')).width).toBe('100%');
    expect(computed(button('Stop Athlete 1')).width).toBe('100%');
  });

  it('draws the card on the desk panel rather than the page canvas', () => {
    render(<CountdownControl {...baseProps} />);

    // §6 computes every lane pair — words, digits, frame strokes — on `panel`,
    // and the card was the last desk section still drawn straight onto the
    // canvas, so the pinned grounds were not the ones it painted.
    expect(screen.getByTestId('lane-card-1')).toHaveClass('MuiPaper-outlined');
  });

  it('offsets Reset behind a dashed divider rather than flush beside Stop', () => {
    render(<CountdownControl {...baseProps} />);

    // The S03 finding: Reset is the one press with no undo, so the offset and
    // the confirm are its guard (§6) — it may not share the transport row.
    // It shares the AUX row (`freestyle-board-fold-budget`): a row of its own
    // cost the card 52 px and put the aux control itself under a 720 px fold,
    // so the divider turned on its side and kept the offset and the gutter.
    const resetRow = screen.getByTestId('lane-aux-row');
    expect(resetRow).toContainElement(button('Reset Athlete 1'));
    expect(resetRow).toContainElement(button('Take break Athlete 1 (2 left)'));
    expect(resetRow).not.toContainElement(button('Stop Athlete 1'));
    const divider = resetRow.querySelector('.MuiDivider-root');
    expect(divider).not.toBeNull();
    expect(computed(divider as Element).borderTopStyle).toBe('dashed');
  });

  it('keeps the tab run Start → Stop → aux → Reset', () => {
    render(<CountdownControl {...baseProps} />);

    // DOM order IS the tab order, and the buzzer's on-screen twins are read in
    // the order they are pressed. Reset rising to the aux row must not promote
    // it up the run (it is still the press with no undo).
    const run = [
      button('Start Athlete 1'),
      button('Stop Athlete 1'),
      button('Take break Athlete 1 (2 left)'),
      button('Reset Athlete 1'),
    ];
    run.forEach((control, index) => {
      const next = run[index + 1];
      if (next) {
        expect(
          control.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });
  });

  it('keeps the reserved why-line between the pair and the aux slot', () => {
    render(<CountdownControl {...baseProps} runningLane={2} />);

    // The blocker belongs to the pair above it, and the slot is held whether or
    // not it carries a reason — so nothing below it moves as a lock comes and
    // goes (§4.12).
    const why = screen.getByTestId('why-line');
    const follows = (before: Element, after: Element) =>
      Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByTestId('lane-transport'), why)).toBe(true);
    expect(follows(why, button('Take break Athlete 1 (2 left)'))).toBe(true);
  });
});

describe('CountdownControl aux slot (the green handset key, §4.14)', () => {
  it('ends the turn in battle — the same STOP the blue key fires', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <CountdownControl {...baseProps} mode="battle" lane={lane('running')} onStop={onStop} />,
    );
    await user.click(screen.getByRole('button', { name: 'End turn Athlete 1' }));
    expect(onStop).toHaveBeenCalledWith(1);
  });

  it('holds the slot in both modes, so the key never moves', () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('running')} />);
    expect(screen.getByRole('button', { name: /Take break/ })).toBeInTheDocument();
    rerender(<CountdownControl {...baseProps} mode="battle" lane={lane('running')} />);
    expect(screen.getByRole('button', { name: 'End turn Athlete 1' })).toBeInTheDocument();
  });

  // The slot's two faces are one green key, so they answer to one name shape.
  it('names the break with its player, like the End turn it replaces', () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('running')} />);
    expect(screen.getByRole('button', { name: 'Take break Athlete 1 (2 left)' })).toBeEnabled();
    rerender(<CountdownControl {...baseProps} id={2} lane={lane('running')} />);
    expect(screen.getByRole('button', { name: 'Take break Athlete 2 (2 left)' })).toBeEnabled();
  });
});

describe('CountdownControl identity row (FREESTYLE_BOARD_UX §2)', () => {
  const identity = () => screen.getByTestId('lane-identity');

  it('renders the assigned athlete name beside the player label', () => {
    render(<CountdownControl {...baseProps} name="J. Rider" />);
    expect(screen.getByText('J. Rider')).toBeInTheDocument();
  });

  // The card names itself as a landmark, like every other panel on the desk —
  // the label on the row is text, so the board keeps one heading (its `h1`).
  it('renders no name when no athlete is assigned', () => {
    render(<CountdownControl {...baseProps} />);
    expect(screen.getByRole('region', { name: 'Athlete 1' })).toBeInTheDocument();
    expect(screen.getByText('Athlete 1')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('J. Rider')).not.toBeInTheDocument();
  });

  it('carries the player and the athlete on one row', () => {
    render(<CountdownControl {...baseProps} name="J. Rider" />);

    // §2's card header is one line — `PLAYER 1  Bianchi`. Two stacked rows at
    // heading scale spent card height on a label that never changes and pushed
    // Start/Stop below the desk's fold.
    const row = identity();
    expect(row).toContainElement(screen.getByText('Athlete 1'));
    expect(row).toContainElement(screen.getByText('J. Rider'));
    expect(window.getComputedStyle(row).flexDirection).toBe('row');
  });

  it('holds the row height before an athlete is picked', () => {
    render(<CountdownControl {...baseProps} />);

    // A reserved slot (§4.12): picking an athlete may not move the transport.
    expect(px(window.getComputedStyle(identity()).minHeight)).toBeGreaterThan(0);
  });

  it('keeps a long name on one line, so a name never moves the transport', () => {
    render(<CountdownControl {...baseProps} name="Bartholomew Vandersteen-Marchetti" />);

    // The row has to survive the 256 px battle lane: a wrapped name would grow
    // the card and drop Start/Stop under the operator's hand.
    const style = window.getComputedStyle(screen.getByText('Bartholomew Vandersteen-Marchetti'));
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.textOverflow).toBe('ellipsis');
  });
});

describe('CountdownControl dispatches actions', () => {
  it('dispatches onStart with the lane id on Start', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<CountdownControl {...baseProps} onStart={onStart} />);
    await user.click(screen.getByRole('button', { name: 'Start Athlete 1' }));
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it('dispatches onStop on Stop while running', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<CountdownControl {...baseProps} lane={lane('running')} onStop={onStop} />);
    await user.click(screen.getByRole('button', { name: 'Stop Athlete 1' }));
    expect(onStop).toHaveBeenCalledWith(1);
  });

  it('dispatches onTakeBreak on the advisory button (quali)', async () => {
    const user = userEvent.setup();
    const onTakeBreak = vi.fn();
    render(<CountdownControl {...baseProps} lane={lane('running')} onTakeBreak={onTakeBreak} />);
    await user.click(screen.getByRole('button', { name: /Take break/ }));
    expect(onTakeBreak).toHaveBeenCalledWith(1);
  });

  it('routes gamepad button 0 to onStart when idle', () => {
    const onStart = vi.fn();
    const { rerender } = render(<CountdownControl {...baseProps} onStart={onStart} />);
    pressButton(0);
    rerender(<CountdownControl {...baseProps} onStart={onStart} />);
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it('ignores gamepad Start while already running (double-press guard)', () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onStart={onStart} />,
    );
    pressButton(0);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onStart={onStart} />);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('CountdownControl advisory break allowance', () => {
  it('disables Take break while idle and enables it once running', () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('idle')} />);
    expect(screen.getByRole('button', { name: /Take break/ })).toBeDisabled();
    rerender(<CountdownControl {...baseProps} lane={lane('running')} />);
    expect(screen.getByRole('button', { name: /Take break/ })).toBeEnabled();
  });

  it('reflects the remaining allowance in the badge and disables at zero', () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('running', 1)} />);
    expect(screen.getByRole('button', { name: 'Take break Athlete 1 (1 left)' })).toBeEnabled();
    // The badge is the visible half of that name (brief §2 pins `Take break
    // (n left)`) — the per-lane suffix is spoken, never printed.
    expect(screen.getByText('Take break (1 left)')).toBeVisible();
    rerender(<CountdownControl {...baseProps} lane={lane('running', 0)} />);
    expect(screen.getByRole('button', { name: 'Take break Athlete 1 (0 left)' })).toBeDisabled();
  });
});

describe('CountdownControl reset', () => {
  it('resets straight through (no prompt) when the countdown is idle', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<CountdownControl {...baseProps} lane={lane('idle')} onReset={onReset} />);
    await user.click(screen.getByRole('button', { name: 'Reset Athlete 1' }));
    expect(onReset).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prompts before resetting a running countdown, then fires on confirm', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />,
    );

    // Reset while running (gamepad button 1) must prompt, not fire reset.
    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);
    const dialog = await screen.findByRole('dialog');
    expect(onReset).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Reset Athlete 1' }));
    expect(onReset).toHaveBeenCalledWith(1);
  });

  it('keeps the running countdown when the prompt is dismissed', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />,
    );

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Keep timing' }));
    expect(onReset).not.toHaveBeenCalled();
  });

  // FREESTYLE_BOARD_UX §4.8: the prompt names the value at risk and reads it
  // from the store at render — a peer STOP landing while the question is on
  // screen must not leave the operator answering about a stale number.
  it('names the held value live from the lane, never a value captured at open', async () => {
    const { rerender } = render(<CountdownControl {...baseProps} lane={lane('running')} />);

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Athlete 1 holds \d\d:\d\d/)).toBeInTheDocument();

    // A peer ended the turn: the lane now holds 01:28 and the question follows.
    rerender(
      <CountdownControl
        {...baseProps}
        lane={{ phase: 'idle', budgetMs: 88_000, armedMs: BUDGET, breaksLeft: 2 }}
      />,
    );
    expect(within(dialog).getByText(/Athlete 1 holds 01:28 of 02:00/)).toBeInTheDocument();
  });

  it('names the re-arm target so the operator sees what Reset restores', async () => {
    const { rerender } = render(
      <CountdownControl
        {...baseProps}
        lane={{ phase: 'idle', budgetMs: 88_000, armedMs: 150_000, breaksLeft: 2 }}
      />,
    );

    pressButton(1);
    rerender(
      <CountdownControl
        {...baseProps}
        lane={{ phase: 'idle', budgetMs: 88_000, armedMs: 150_000, breaksLeft: 2 }}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Athlete 1 holds 01:28 of 02:30 — resetting re-arms to 02:30.'),
    ).toBeInTheDocument();
  });

  // §4.8's per-instance naming rule (`ConfirmGuard.dialog`): the board stands
  // two of these questions and the modal covers the card that raised one, so
  // the screen has to carry the name the readout sends the operator to
  // (`answer the Reset Athlete 2 question first`). A board-wide `Reset this
  // countdown?` left both dialogs — and both accessible names — identical.
  it.each([1, 2] as const)('names the question and its answer for Player %i', async (id) => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<CountdownControl {...baseProps} id={id} lane={held} onReset={onReset} />);

    await user.click(screen.getByRole('button', { name: `Reset Athlete ${id}` }));
    const dialog = await screen.findByRole('dialog', { name: `Reset Athlete ${id}?` });

    await user.click(within(dialog).getByRole('button', { name: `Reset Athlete ${id}` }));
    expect(onReset).toHaveBeenCalledWith(id);
  });

  // Brief §4.8: the question is for a turn that would have to be re-timed — a
  // fall and a break, not just `running` (the guard the audit found).
  const heldLanes: [string, LaneState][] = [
    [
      'a held lane (idle below its armed budget)',
      { phase: 'idle', budgetMs: 88_000, armedMs: BUDGET, breaksLeft: 2 },
    ],
    ['a lane paused on break', lane('onBreak')],
  ];

  it.each(heldLanes)('prompts before resetting %s', async (_label, held) => {
    const onReset = vi.fn();
    const { rerender } = render(<CountdownControl {...baseProps} lane={held} onReset={onReset} />);

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={held} onReset={onReset} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });

  // Brief §4.8: the re-arm that ends every athlete cycle and every match. A
  // finished lane holds nothing to re-time, so the board's most-repeated press
  // must not be a dialog to click through.
  it('resets a finished lane straight through, button and handset alike', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('finished')} onReset={onReset} />,
    );

    await user.click(screen.getByRole('button', { name: 'Reset Athlete 1' }));
    expect(onReset).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('finished')} onReset={onReset} />);
    expect(onReset).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // The mirror of the live text above: once a peer re-armed the lane there is
  // nothing left to re-time, so the question goes with the risk rather than
  // standing as a no-op the operator still has to answer (rubric C04).
  it('closes the prompt when a peer reset clears the risk', async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />,
    );

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);
    await screen.findByRole('dialog');

    rerender(<CountdownControl {...baseProps} lane={lane('idle')} onReset={onReset} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onReset).not.toHaveBeenCalled();
  });

  // ...and it stays closed. A question the peer event closed was never
  // answered, so a stamp kept behind it re-opened the dialog the next time the
  // lane held a turn — mid-run, with nobody having pressed anything, and it
  // takes the whole handset with it while it stands (§4.8).
  it('does not re-ask itself when the lane next holds a turn', async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />,
    );

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);
    await screen.findByRole('dialog');

    // A peer re-armed the lane (the question goes), then the athlete's next
    // turn starts on this very lane.
    rerender(<CountdownControl {...baseProps} lane={lane('idle')} onReset={onReset} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });

  // The handset readout announces this question and its answer by name
  // (`→ closed the Reset Athlete 2 dialog (Keep timing)`, §4.14), so the dialog
  // renders the safe button the guard registers rather than a second copy of
  // the word — and the question carries the player, off the same `controlName`
  // seam as the button that raised it: the battle board stands two of them, so
  // `answer the Reset question first` names no card to walk to.
  for (const id of [1, 2] as const) {
    it(`answers with the button the guard registered — Player ${id}`, async () => {
      render(<CountdownControl {...baseProps} id={id} lane={lane('running')} />);

      fireEvent.click(screen.getByRole('button', { name: `Reset Athlete ${id}` }));
      await screen.findByRole('dialog');

      expect(advanceOverlay()?.confirm).toEqual({
        dialog: `Reset Athlete ${id}`,
        safeAction: 'Keep timing',
      });
      expect(document.activeElement?.textContent).toBe(advanceOverlay()?.confirm?.safeAction);
    });
  }

  // Brief §4.8: the question owns the board. ADVANCE answers it; every other
  // handset key is inert until it is — the screen twins already sit behind the
  // modal backdrop, so the pad was the one path still reaching the transport
  // from behind an open confirm.
  it('holds this lane its own pad keys while the prompt stands', async () => {
    const handlers = { onStart: vi.fn(), onStop: vi.fn(), onReset: vi.fn(), onTakeBreak: vi.fn() };
    const held = lane('running');
    const { rerender } = render(<CountdownControl {...baseProps} lane={held} {...handlers} />);

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={held} {...handlers} />);
    await screen.findByRole('dialog');

    for (const button of [0, 1, 2, 4]) {
      pressButton(button);
      rerender(<CountdownControl {...baseProps} lane={held} {...handlers} />);
    }

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('answers an ADVANCE press behind the prompt with Keep timing', async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />,
    );

    pressButton(1);
    rerender(<CountdownControl {...baseProps} lane={lane('running')} onReset={onReset} />);
    await screen.findByRole('dialog');

    const safeClose = advanceBlocked();
    expect(safeClose).not.toBeNull();
    act(() => safeClose?.());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onReset).not.toHaveBeenCalled();
  });
});

describe('CountdownControl battle mode', () => {
  it('hides the advisory Take-break button (breaks are a quali surface)', () => {
    render(<CountdownControl {...baseProps} mode="battle" lane={lane('running')} />);
    expect(screen.queryByRole('button', { name: /Take break/ })).not.toBeInTheDocument();
  });

  it('gamepad break button (2) dispatches a Stop (fall) in battle', () => {
    const onStop = vi.fn();
    const onTakeBreak = vi.fn();
    const { rerender } = render(
      <CountdownControl
        {...baseProps}
        mode="battle"
        lane={lane('running')}
        onStop={onStop}
        onTakeBreak={onTakeBreak}
      />,
    );
    pressButton(2);
    rerender(
      <CountdownControl
        {...baseProps}
        mode="battle"
        lane={lane('running')}
        onStop={onStop}
        onTakeBreak={onTakeBreak}
      />,
    );
    expect(onStop).toHaveBeenCalledWith(1);
    expect(onTakeBreak).not.toHaveBeenCalled();
  });

  it('gamepad break button (2) takes the advisory break in quali', () => {
    const onStop = vi.fn();
    const onTakeBreak = vi.fn();
    const { rerender } = render(
      <CountdownControl
        {...baseProps}
        lane={lane('running')}
        onStop={onStop}
        onTakeBreak={onTakeBreak}
      />,
    );
    pressButton(2);
    rerender(
      <CountdownControl
        {...baseProps}
        lane={lane('running')}
        onStop={onStop}
        onTakeBreak={onTakeBreak}
      />,
    );
    expect(onTakeBreak).toHaveBeenCalledWith(1);
    expect(onStop).not.toHaveBeenCalled();
  });
});

/** The words a locked control carries — the Tooltip's `describeChild` title on
 * the wrapper span, since a disabled button fires no pointer events. */
const blockerOf = (button: HTMLElement): string | null =>
  button.parentElement?.getAttribute('title') ?? null;

describe('CountdownControl interlocks (FREESTYLE_BOARD_UX §4.7)', () => {
  it('goes inert while a best-trick series is armed, Reset included', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} bestTrickArmed />);

    expect(screen.getByRole('button', { name: 'Start Athlete 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop Athlete 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Take break/ })).toBeDisabled();
    // The run board is armed for the next match after Leave best trick, never
    // behind the tries — one exit, so no press can re-arm mid-series.
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeDisabled();
  });

  it('names the blocker on every control it locks', () => {
    const { rerender } = render(
      <CountdownControl {...baseProps} lane={lane('idle')} bestTrickArmed />,
    );
    expect(blockerOf(screen.getByRole('button', { name: 'Start Athlete 1' }))).toBe(
      'locked during best trick — Leave best trick first',
    );
    expect(blockerOf(screen.getByRole('button', { name: 'Stop Athlete 1' }))).toBe(
      'locked during best trick — Leave best trick first',
    );
    expect(blockerOf(screen.getByRole('button', { name: 'Reset Athlete 1' }))).toBe(
      'locked during best trick — Leave best trick first',
    );

    rerender(<CountdownControl {...baseProps} lane={lane('idle')} runningLane={2} />);
    expect(blockerOf(screen.getByRole('button', { name: 'Start Athlete 1' }))).toBe(
      'locked while Athlete 2 runs',
    );
    expect(blockerOf(screen.getByRole('button', { name: 'Reset Athlete 1' }))).toBe(
      'locked while Athlete 2 runs',
    );

    rerender(<CountdownControl {...baseProps} lane={lane('finished')} />);
    expect(blockerOf(screen.getByRole('button', { name: 'Start Athlete 1' }))).toBe(
      'budget spent — Reset re-arms 02:00',
    );

    rerender(<CountdownControl {...baseProps} lane={lane('running', 0)} />);
    expect(blockerOf(screen.getByRole('button', { name: /Take break/ }))).toBe('no breaks left');
  });

  it('leaves a live control unnamed (nothing to explain)', () => {
    render(<CountdownControl {...baseProps} lane={lane('idle')} />);

    expect(blockerOf(screen.getByRole('button', { name: 'Start Athlete 1' }))).toBe('');
  });

  // The acceptance case: the handset shares the button's lock, so none of this
  // lane's four keys does anything while the series is armed — Reset (yellow)
  // included, and without raising the question a live Reset would ask. Blocked
  // is not swallowed (§3's no-op row): the card hands the board the very lock
  // the button beside it greys on, and the board flashes it on the plate —
  // the 12 px readout line is not where the hand is looking.
  it.each([
    ['Start (red)', 0],
    ['Reset (yellow)', 1],
    ['Take break / End turn (green)', 2],
    ['Stop (blue)', 4],
  ])('answers handset %s with the best-trick lock', (_label, button) => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onReset = vi.fn();
    const onTakeBreak = vi.fn();
    const onBlocked = vi.fn();
    const props = {
      ...baseProps,
      lane: lane('running'),
      onStart,
      onStop,
      onReset,
      onTakeBreak,
      onBlocked,
    };
    const { rerender } = render(<CountdownControl {...props} bestTrickArmed />);

    pressButton(button);
    rerender(<CountdownControl {...props} bestTrickArmed />);

    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(onTakeBreak).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onBlocked.mock.calls).toEqual([[{ kind: 'hold', hold: { kind: 'bestTrick' } }]]);
  });

  // A spent lane is the ordinary end of a battle, and its Reset is the press
  // that arms the next match — but not from behind the tries.
  it('leaves a spent lane locked while best trick is armed', () => {
    const onReset = vi.fn();
    const props = { ...baseProps, lane: lane('finished'), onReset, bestTrickArmed: true };
    const { rerender } = render(<CountdownControl {...props} />);

    pressButton(1);
    rerender(<CountdownControl {...props} />);

    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reset Athlete 1' })).toBeDisabled();
  });

  it('answers a handset Reset the other player’s run locked out', () => {
    const onReset = vi.fn();
    const onBlocked = vi.fn();
    const props = {
      ...baseProps,
      lane: lane('idle'),
      onReset,
      onBlocked,
      runningLane: 2 as const,
    };
    const { rerender } = render(<CountdownControl {...props} />);

    pressButton(1);
    rerender(<CountdownControl {...props} />);

    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onBlocked.mock.calls).toEqual([[{ kind: 'hold', hold: { kind: 'running', lane: 2 } }]]);
  });
});

describe('CountdownControl peer cue (ADR 0038 / brief §4.10)', () => {
  it('labels a peer-applied event on this lane, then clears it', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<CountdownControl {...baseProps} peerEventToken={null} />);
      expect(screen.queryByLabelText('Athlete 1 changed by other panel')).not.toBeInTheDocument();

      rerender(<CountdownControl {...baseProps} lane={lane('running')} peerEventToken={7} />);
      expect(screen.getByLabelText('Athlete 1 changed by other panel')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(PEER_FLASH_MS));
      expect(screen.queryByLabelText('Athlete 1 changed by other panel')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // fsux-desk-fold-budget's precedent, now on the card: the cue rides the
  // identity row rather than reserving one of its own. The row is already
  // ≥ the chip's height, so §4.12 holds — a peer's Start ellipsises the name
  // for 2 s and moves nothing.
  it('rides the identity row rather than a reserved row of its own', () => {
    render(<CountdownControl {...baseProps} name="J. Rider" peerEventToken={7} />);

    const identity = screen.getByTestId('lane-identity');
    expect(identity).toContainElement(screen.getByLabelText('Athlete 1 changed by other panel'));
    expect(identity).toContainElement(screen.getByText('J. Rider'));
  });

  it('stays silent for a peer event that addressed the other lane', () => {
    // The page hands each card only the events that named it, so a peer Start on
    // Athlete 2 cannot light Athlete 1's chip.
    render(<CountdownControl {...baseProps} peerEventToken={null} />);
    expect(screen.queryByText('by other panel')).not.toBeInTheDocument();
  });
});
