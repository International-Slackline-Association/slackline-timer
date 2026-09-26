import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TallyPlate } from 'app/pages/Freestyle/TallyPlate';
import { advanceLabel, advanceRoute } from 'app/util/advanceRoute';
import { initialBattleState, reduce, type BattleState } from 'app/util/battleMachine';
import { DEFAULT_CAP, initialTrySeries } from 'app/util/bestTrickSeries';
import type { TallyInput } from 'app/util/tallyModel';

const BUDGET = 120_000;
const NAMES = { 1: 'C. Bianchi', 2: 'R. Lafleur' } as const;

const fresh = (): BattleState => initialBattleState(BUDGET, 2);
const running = (): BattleState =>
  reduce(fresh(), { type: 'START', lane: 1, at: Date.now() }).state;
const bothSpent = (): BattleState => ({
  ...fresh(),
  1: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  2: { phase: 'finished', armedMs: BUDGET, breaksLeft: 2 },
  lastRan: 2,
});

/** A board with nothing outside the advance cycle to say, so the sub-line is
 * the press's `then:` hint alone. */
const board = (over: Partial<Omit<TallyInput, 'now'>> = {}): Omit<TallyInput, 'now'> => ({
  mode: 'battle',
  battle: fresh(),
  trySeries: null,
  names: NAMES,
  warmup: { kind: 'idle', remainingMs: 420_000 },
  link: 'open',
  audioBlocked: false,
  peerState: 'alone',
  saves: { 1: { status: 'empty' }, 2: { status: 'empty' } },
  ...over,
});

/** No press has been answered yet — the board's resting `noopPress`. */
const NO_PRESS = { token: 0, reason: null };

const plate = () => screen.getByRole('button', { name: /^ADVANCE — / });
const px = (value: string): number => parseFloat(value);

/** The state channel, which is decorative to a screen reader (the state word
 * says the same thing in words) and so has no role to query by. */
const stripe = (): HTMLElement => {
  const bar = plate().querySelector<HTMLElement>('[data-state-tier]');
  if (bar === null) throw new Error('the plate drew no state stripe');
  return bar;
};

describe('TallyPlate', () => {
  // §4.1: the right half is the router's label over the very route the press
  // dispatches — the plate types no verb of its own, so it cannot promise an
  // effect the press does not have.
  it.each([
    { state: 'ready', battle: fresh },
    { state: 'a lane running', battle: running },
    { state: 'nothing left to advance', battle: bothSpent },
  ])('renders advanceLabel of the next press ($state)', ({ battle }) => {
    const input = board({ battle: battle() });
    const label = advanceLabel(advanceRoute(input.mode, input.battle, input.trySeries), NAMES);
    // A no-op's reason takes the target slot behind an em dash, which frees the
    // sub-line for the scoring state the operator now acts on.
    const noop = label.target === '';

    render(<TallyPlate board={input} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    expect(within(plate()).getByText(label.verb)).toBeInTheDocument();
    expect(
      within(plate()).getByText(noop ? `— ${label.detail}` : label.target),
    ).toBeInTheDocument();
    if (!noop) expect(within(plate()).getByText(label.detail)).toBeInTheDocument();
    expect(plate()).toHaveAccessibleName(
      `ADVANCE — ${label.verb}${noop ? ` — ${label.detail}` : ` ${label.target}`}`,
    );
  });

  // The one number both halves could claim: which attempt the next press opens.
  // It is a reading off the series, so §4.1 gives it to the LEFT half — the
  // half that ticks — and leaves the right half naming who takes the try. Two
  // copies of one count on one plate is the operator asking which is current.
  it('counts the attempt once, on the half that ticks', () => {
    const armed = board({ battle: bothSpent(), trySeries: initialTrySeries(DEFAULT_CAP) });

    render(<TallyPlate board={armed} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    expect(within(plate()).getAllByText(`try 1 of ${DEFAULT_CAP}`)).toHaveLength(1);
    expect(within(plate()).getByText(NAMES[1])).toBeInTheDocument();
  });

  // The overlay guard belongs to the input seam (`useAdvanceInput`, §4.3), which
  // hands back one guarded press for all three triggers. The plate holds no copy
  // of it — it presses, and the seam decides — so even behind an open confirm
  // the click reaches this prop.
  it('presses its onAdvance seam, whatever is open over the board', () => {
    const onAdvance = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    render(<TallyPlate board={board()} onAdvance={onAdvance} noopPress={NO_PRESS} />);
    fireEvent.click(plate());
    dialog.remove();

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  // The state channel: the plate's FILL is the next press's tier, so the same
  // running board paints amber in quali (the press takes a break) and red in
  // battle (the press ends the turn). The stripe is the other channel — where
  // the BOARD is, in the lane cards' own tiers, whatever the press does.
  it.each([
    { state: 'battle running, a press away from STOP', input: board({ battle: running() }) },
    {
      state: 'quali running, a press away from TAKE BREAK',
      input: board({ mode: 'quali', battle: running() }),
    },
  ])('says the board is running while the verb says otherwise ($state)', ({ input }) => {
    render(<TallyPlate board={input} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    expect(stripe()).toHaveAttribute('data-state-tier', 'running');
  });

  it.each([
    { state: 'ready', input: board(), tier: 'ready' },
    { state: 'nothing left to advance', input: board({ battle: bothSpent() }), tier: 'finished' },
    {
      state: 'a joiner still awaiting the room',
      input: board({ peerState: 'awaiting' }),
      tier: 'idle',
    },
  ])('carries the $state tier', ({ input, tier }) => {
    render(<TallyPlate board={input} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    expect(stripe()).toHaveAttribute('data-state-tier', tier);
  });

  // §4.12 / C14: the channel rides the plate's own left padding, out of the
  // flow — so it moved nothing when it landed, and it is in the same place at
  // the same width in every state. Only its colour changes, which is what lets
  // "something is live" be read off one position at 25 % scale.
  it('holds the stripe out of the flow, in one place, at one width', () => {
    const geometry = (input: Omit<TallyInput, 'now'>) => {
      const { unmount } = render(
        <TallyPlate board={input} onAdvance={vi.fn()} noopPress={NO_PRESS} />,
      );
      const bar = window.getComputedStyle(stripe());
      const box = window.getComputedStyle(plate());
      const read = {
        place: `${bar.position} ${bar.left} ${bar.width}`,
        plate: `${box.minHeight} ${box.paddingLeft} ${box.paddingTop}`,
        color: bar.backgroundColor,
      };
      unmount();
      return read;
    };

    const live = geometry(board({ battle: running() }));
    const ready = geometry(board());

    expect(live.place).toBe('absolute 2px 12px');
    expect(live.place).toBe(ready.place);
    expect(live.plate).toBe(ready.plate);
    expect(live.color).not.toBe(ready.color);
  });

  it('offsets plate content to the right of the state stripe', () => {
    render(<TallyPlate board={board()} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    const content = within(plate()).getByTestId('plate-content');
    const style = window.getComputedStyle(content);

    expect(style.paddingLeft).toBe('16px');
  });

  // §4.12 (nothing moves): a no-op verb is a sentence, so it drops to the
  // target's scale rather than wrapping — but the slot has to keep the live
  // verb's line box. The plate is sticky at the top of the live column, so a
  // shorter verb shrank the whole board's box the moment the last run resolved
  // and stepped the run deck up under the operator's hand.
  it('reserves the live verb line box under a no-op sentence', () => {
    const { unmount } = render(
      <TallyPlate board={board()} onAdvance={vi.fn()} noopPress={NO_PRESS} />,
    );
    const live = window.getComputedStyle(within(plate()).getByText('START'));
    const slot = live.minHeight;
    const liveSize = px(live.fontSize);
    unmount();

    render(
      <TallyPlate
        board={board({ battle: bothSpent() })}
        onAdvance={vi.fn()}
        noopPress={NO_PRESS}
      />,
    );
    const noop = window.getComputedStyle(within(plate()).getByText('NOTHING TO ADVANCE'));

    expect(px(noop.fontSize)).toBeLessThan(liveSize);
    expect(noop.minHeight).toBe(slot);
    expect(px(slot)).toBeGreaterThanOrEqual(liveSize);
  });

  // A blocked handset key borrows the plate for a second (§3's no-op row). It
  // borrows the SUB-LINE only: the verb above still promises what ADVANCE would
  // do, which in this state is a live Start — the plate may never name an
  // effect the next press does not have (§4.1).
  it('flashes a blocked key’s own words without touching the promise', () => {
    vi.useFakeTimers();
    try {
      const blocked = { token: 1, reason: 'locked while Athlete 1 runs' };
      render(<TallyPlate board={board()} onAdvance={vi.fn()} noopPress={blocked} />);

      expect(plate()).toHaveAttribute('data-noop-flash', 'on');
      expect(within(plate()).getByTestId('plate-subline')).toHaveTextContent(blocked.reason);
      expect(within(plate()).getByText('START')).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1000));

      expect(plate()).not.toHaveAttribute('data-noop-flash');
      expect(within(plate()).getByTestId('plate-subline')).not.toHaveTextContent(blocked.reason);
    } finally {
      vi.useRealTimers();
    }
  });

  // The whole plate is the buzzer's screen twin, so the click target may not be
  // split (§4.1) — and its `aria-label` names the PRESS, which leaves the state
  // report it wraps unreadable to a screen reader. A live region beside the
  // button carries that half instead: the name stays the action, the region
  // stays the state, and neither repeats the other.
  it('announces where the board is beside the button, never inside its name', () => {
    const { rerender } = render(
      <TallyPlate board={board()} onAdvance={vi.fn()} noopPress={NO_PRESS} />,
    );
    const report = screen.getByRole('status');

    expect(plate()).not.toContainElement(report);
    expect(report).toHaveTextContent('READY · TURN 1');
    expect(plate()).not.toHaveAccessibleName(/READY/);

    rerender(
      <TallyPlate board={board({ battle: running() })} onAdvance={vi.fn()} noopPress={NO_PRESS} />,
    );

    expect(report).toHaveTextContent('RUNNING · P1 C. BIANCHI');
  });

  // The left half counts down, and a live region that re-read every tick would
  // talk over its reader without pause — so the report is stamped by the state
  // change, and the number it carries is that moment's.
  it('stamps the report at the state change, not at every clock tick', () => {
    vi.useFakeTimers();
    try {
      render(
        <TallyPlate
          board={board({ battle: running() })}
          onAdvance={vi.fn()}
          noopPress={NO_PRESS}
        />,
      );
      const report = screen.getByRole('status');
      const stamped = report.textContent;
      const ticking = plate().textContent;

      act(() => vi.advanceTimersByTime(2000));

      expect(plate().textContent).not.toBe(ticking);
      expect(report.textContent).toBe(stamped);
    } finally {
      vi.useRealTimers();
    }
  });

  // A `<button>` may hold phrasing content only, and the plate's report was four
  // `div`s deep inside one. Every box in there is a `span` now — the target, the
  // fills and the reserved slots are untouched, the markup is valid.
  it('nests no div inside the press', () => {
    render(<TallyPlate board={board()} onAdvance={vi.fn()} noopPress={NO_PRESS} />);

    expect(plate().querySelector('div')).toBeNull();
  });
});
