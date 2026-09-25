import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WarmupChannel } from 'app/hooks/useWarmupChannel';
import { WarmupCard } from 'app/pages/Freestyle/WarmupCard';
import {
  initialWarmupState,
  warmupCardState,
  warmupDisplay,
  type WarmupState,
} from 'app/util/warmupChannel';

const DEFAULT_S = 420;

/** The channel exactly as the card reads it — every view derived from one real
 * machine state, so the card can never be shown a combination the reducer
 * cannot produce. */
const channel = (state: WarmupState): WarmupChannel =>
  ({
    running: state.clock.kind === 'running',
    defaultSeconds: state.defaultSeconds,
    display: warmupDisplay(state),
    card: warmupCardState(state),
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    setDefaultSeconds: vi.fn(),
  }) as unknown as WarmupChannel;

const armed = (): WarmupState => initialWarmupState(DEFAULT_S);
const running = (): WarmupState => ({
  ...armed(),
  clock: { kind: 'running', remainingMs: DEFAULT_S * 1000, startedAt: 0 },
});
/** Stopped one second in: idle, but below the armed default. */
const held = (): WarmupState => ({
  ...armed(),
  clock: { kind: 'idle', remainingMs: DEFAULT_S * 1000 - 1000 },
});
const spent = (): WarmupState => ({ ...armed(), clock: { kind: 'expired' } });

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const minHeightOf = (el: Element) => window.getComputedStyle(el).minHeight;

/** The clock's §6 state frame — the only stroked box around the numeral. */
const clockFrame = (): HTMLElement => screen.getByText(/^\d\d:\d\d$/).parentElement as HTMLElement;

/** Every reserved slot the card holds open, in DOM order (§4.12). */
const reservedSlots = (container: HTMLElement) =>
  [...container.querySelectorAll('div')]
    .map(minHeightOf)
    .filter((h) => h !== '' && h !== 'auto' && h !== '0px');

describe('WarmupCard — the state word', () => {
  it('names each state in a word, in a slot that is never empty', () => {
    const { rerender } = render(<WarmupCard warmup={channel(armed())} />);
    expect(screen.getByText('ARMED')).toBeInTheDocument();

    rerender(<WarmupCard warmup={channel(running())} />);
    expect(screen.getByText('RUNNING')).toBeInTheDocument();

    rerender(<WarmupCard warmup={channel(held())} />);
    expect(screen.getByText('STOPPED · 06:59 LEFT')).toBeInTheDocument();

    rerender(<WarmupCard warmup={channel(spent())} />);
    expect(screen.getByText('WARM-UP OVER')).toBeInTheDocument();
  });
});

describe('WarmupCard — a stopped window', () => {
  it('breaks the frame the armed window draws solid, so the two never read alike', () => {
    const { rerender } = render(<WarmupCard warmup={channel(armed())} />);
    expect(window.getComputedStyle(clockFrame()).borderTopStyle).toBe('solid');

    rerender(<WarmupCard warmup={channel(held())} />);
    const frame = window.getComputedStyle(clockFrame());
    expect(frame.borderTopStyle).toBe('dashed');
    expect(frame.borderTopColor).toBe('rgb(91, 103, 118)'); // ink.mid
  });

  it('keeps the transport, naming the window a re-arm would restore', () => {
    const warmup = channel(held());
    render(<WarmupCard warmup={warmup} />);

    expect(button('Start warm-up').disabled).toBe(false);
    expect(button('Stop warm-up').disabled).toBe(true);
    const rearm = button('Re-arm warm-up');
    expect(rearm).toHaveTextContent('Re-arm 07:00');
    expect(minHeightOf(rearm)).toBe('44px');

    fireEvent.click(rearm);
    expect(warmup.reset).toHaveBeenCalled();
  });
});

describe('WarmupCard — the rail surface', () => {
  it('sits on the outlined card the rest of the rail sits on', () => {
    const { container } = render(<WarmupCard warmup={channel(armed())} />);
    expect(container.firstElementChild).toHaveClass('MuiPaper-outlined');
  });
});

describe('WarmupCard — transport', () => {
  it('starts only an armed clock, stops only a running one, re-arms only a resting one', () => {
    const warmup = channel(armed());
    const { rerender } = render(<WarmupCard warmup={warmup} />);
    expect(button('Start warm-up').disabled).toBe(false);
    expect(button('Stop warm-up').disabled).toBe(true);

    fireEvent.click(button('Start warm-up'));
    expect(warmup.start).toHaveBeenCalled();

    const live = channel(running());
    rerender(<WarmupCard warmup={live} />);
    expect(button('Start warm-up').disabled).toBe(true);
    expect(button('Stop warm-up').disabled).toBe(false);
    expect(button('Reset warm-up').disabled).toBe(true);

    fireEvent.click(button('Stop warm-up'));
    expect(live.stop).toHaveBeenCalled();
  });

  it('every live control clears the 44 px target floor (WCAG 2.5.5)', () => {
    const { rerender } = render(<WarmupCard warmup={channel(armed())} />);
    for (const name of ['Start warm-up', 'Stop warm-up', 'Reset warm-up']) {
      expect(minHeightOf(button(name))).toBe('44px');
    }
    rerender(<WarmupCard warmup={channel(spent())} />);
    expect(minHeightOf(button('Re-arm warm-up'))).toBe('44px');
  });
});

describe('WarmupCard — expiry', () => {
  it('swaps the transport for one Re-arm naming the window it arms', () => {
    const warmup = channel(spent());
    render(<WarmupCard warmup={warmup} />);

    expect(screen.queryByRole('button', { name: 'Start warm-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop warm-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset warm-up' })).not.toBeInTheDocument();
    // Exactly one control stands in their place — the same slot, the same size.
    expect(screen.getAllByRole('button')).toHaveLength(1);

    const rearm = button('Re-arm warm-up');
    expect(rearm).toHaveTextContent('Re-arm 07:00');

    fireEvent.click(rearm);
    expect(warmup.reset).toHaveBeenCalled();
  });

  it('moves nothing on the board: both reserved slots keep their heights', () => {
    const { container, rerender } = render(<WarmupCard warmup={channel(running())} />);
    const before = reservedSlots(container);
    // The word slot and the one transport/re-arm slot, both held open.
    expect(before).toEqual(['30px', '44px']);

    for (const state of [held(), spent()]) {
      rerender(<WarmupCard warmup={channel(state)} />);
      expect(reservedSlots(container)).toEqual(before);
    }
  });
});
