import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PauseClock } from 'app/pages/Freestyle/PauseClock';

// The judge-facing battle changeover count-up (ADR 0036): control-local, never
// relayed. Anchored to the wall clock, so a late tick shows real elapsed time.
describe('PauseClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The gutter is always rendered (§4.12): a turn ending must not slide the two
  // lane cards sideways to make room for it.
  it('holds the gutter with a dash while no pause is anchored', () => {
    render(<PauseClock startedAt={null} goesAgain={false} />);
    expect(screen.getByText('Changeover')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the CHANGEOVER caption and the elapsed since the anchor', () => {
    vi.setSystemTime(10_000);
    render(<PauseClock startedAt={0} goesAgain={false} />);
    expect(screen.getByText('Changeover')).toBeInTheDocument();
    expect(screen.getByText('00:10')).toBeInTheDocument();
  });

  // Nobody changes over when the partner's budget is spent: the same athlete
  // comes back out, which is what the plate promised a press earlier (`then:
  // start … again`). One gap, one word — the gutter must not name it a handover
  // the plate is not naming.
  it('calls the gap a pause once the same athlete goes again', () => {
    vi.setSystemTime(10_000);
    render(<PauseClock startedAt={0} goesAgain />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.queryByText('Changeover')).not.toBeInTheDocument();
    expect(screen.getByText('00:10')).toBeInTheDocument();
  });

  it('counts up on a 1s wall-clock tick', () => {
    vi.setSystemTime(0);
    render(<PauseClock startedAt={0} goesAgain={false} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText('00:05')).toBeInTheDocument();
  });

  it('derives elapsed from the anchor, not per-tick decrements (throttled tab)', () => {
    vi.setSystemTime(0);
    render(<PauseClock startedAt={0} goesAgain={false} />);
    // Wall time jumps ~30s while the interval fires only once.
    act(() => {
      vi.setSystemTime(30_000);
      vi.advanceTimersToNextTimer();
    });
    expect(screen.getByText(/00:3[01]/)).toBeInTheDocument();
  });

  it('re-anchors when a new pause starts', () => {
    vi.setSystemTime(60_000);
    const { rerender } = render(<PauseClock startedAt={0} goesAgain={false} />);
    expect(screen.getByText('01:00')).toBeInTheDocument();
    rerender(<PauseClock startedAt={60_000} goesAgain={false} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });
});
