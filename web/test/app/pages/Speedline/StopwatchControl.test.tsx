import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StopwatchControl } from 'app/pages/Speedline/StopwatchControl';

import { px } from '../../../util/computedUnits';

const noop = () => {};

const stop = (lane: number) => screen.getByRole('button', { name: `Stop Lane ${lane}` });

/** The idle lane's lock, as the page's interlock table words it. */
const IDLE_LOCK = 'Lane 1 is not running';

const running = { kind: 'running', startTime: 1_000 } as const;

describe('StopwatchControl lane labelling', () => {
  it('labels the column "Lane N" (consistent with the recorder), not "Player N"', () => {
    render(
      <StopwatchControl id={1} laneState={{ kind: 'idle' }} isReady stop={noop} lock={IDLE_LOCK} />,
    );
    expect(screen.getByText('Lane 1')).toBeInTheDocument();
    expect(screen.queryByText('Player 1')).not.toBeInTheDocument();
  });

  it('shows the lane athlete name on the column when assigned', () => {
    render(
      <StopwatchControl
        id={2}
        laneState={{ kind: 'idle' }}
        isReady
        stop={noop}
        lock="Lane 2 is not running"
        name="A. Athlete"
      />,
    );
    expect(screen.getByText('A. Athlete')).toBeInTheDocument();
  });

  // The page owns the interlock table (`speedlineLocks`), so the column asks it
  // rather than re-deciding from the lane state next to it — one answer for the
  // button, the why-line and the handset guard.
  it("follows the page's lock, and prints it (FREESTYLE_BOARD_UX §4.7)", () => {
    const { rerender } = render(
      <StopwatchControl id={1} laneState={{ kind: 'idle' }} isReady stop={noop} lock={IDLE_LOCK} />,
    );
    expect(stop(1)).toBeDisabled();
    expect(screen.getByText(`why: ${IDLE_LOCK}`)).toBeInTheDocument();

    rerender(<StopwatchControl id={1} laneState={running} isReady stop={noop} lock={null} />);
    expect(stop(1)).toBeEnabled();
    expect(screen.queryByText(/^why: /)).not.toBeInTheDocument();
  });

  it('names Stop per lane so both columns are addressable', () => {
    render(
      <StopwatchControl
        id={2}
        laneState={{ kind: 'idle' }}
        isReady
        stop={noop}
        lock="Lane 2 is not running"
      />,
    );
    expect(stop(2)).toBeInTheDocument();
  });
});

// The Speedline board speaks the Freestyle board's control dialect
// (FREESTYLE_BOARD_UX §6, the P3 sibling note).
describe('StopwatchControl live-control contract (FREESTYLE_BOARD_UX §6)', () => {
  it('sizes Stop at the 56 px race target', () => {
    render(
      <StopwatchControl id={1} laneState={{ kind: 'idle' }} isReady stop={noop} lock={IDLE_LOCK} />,
    );
    const style = window.getComputedStyle(stop(1));
    expect(px(style.minHeight)).toBeGreaterThanOrEqual(56);
    expect(px(style.minWidth)).toBeGreaterThanOrEqual(120);
  });

  it('fills Stop only while its own lane runs', () => {
    const { rerender } = render(
      <StopwatchControl id={1} laneState={{ kind: 'idle' }} isReady stop={noop} lock={IDLE_LOCK} />,
    );
    // Idle: the theme's disabled pair holds it — no washed stop colour.
    expect(stop(1)).toBeDisabled();

    rerender(<StopwatchControl id={1} laneState={running} isReady stop={noop} lock={null} />);
    expect(stop(1)).toHaveClass('MuiButton-contained');
  });
});
