import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RaceStartSignal from 'app/pages/Speedline/StartSignal';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';

const STOP = 'rgb(240, 78, 52)'; // race.stop
const SET = 'rgb(242, 169, 59)'; // race.set
const GO = 'rgb(101, 188, 123)'; // race.go
const IDLE = 'rgb(138, 147, 157)'; // race.idle
const VOID = 'rgb(51, 60, 78)'; // surface.void (housing)

const bulbFills = () => {
  const left = screen.getByTestId('start-bulb-0');
  const right = screen.getByTestId('start-bulb-1');
  return [
    window.getComputedStyle(left).backgroundColor,
    window.getComputedStyle(right).backgroundColor,
  ];
};

describe('RaceStartSignal token mapping', () => {
  it('phase 0 (idle) shows both bulbs dark/unlit (race.idle), never red — ADR 0041', () => {
    render(<RaceStartSignal currentPhase={0} />);
    // Idle is dark: red-red on air reads as an error/abort indicator, so the
    // armed red look now begins only at PRE_BEEP_PHASE.
    expect(bulbFills()).toEqual([IDLE, IDLE]);
    // The housing still shows through (two dark bulbs), it is not hidden.
    expect(window.getComputedStyle(screen.getByTestId('start-bulb-0').parentElement!).display).toBe(
      'flex',
    );
  });

  it('pre-beep phase (T-5s cue) arms the light red (both red)', () => {
    render(<RaceStartSignal currentPhase={PRE_BEEP_PHASE} />);
    expect(bulbFills()).toEqual([STOP, STOP]);
    expect(window.getComputedStyle(screen.getByTestId('start-bulb-0').parentElement!).display).toBe(
      'flex',
    );
  });

  it('phase 1 (first SET tone) shows left amber, right idle/off', () => {
    render(<RaceStartSignal currentPhase={1} />);
    expect(bulbFills()).toEqual([SET, IDLE]);
  });

  it('phase 2 (second SET tone) shows both bulbs amber (race.set)', () => {
    render(<RaceStartSignal currentPhase={2} />);
    expect(bulbFills()).toEqual([SET, SET]);
  });

  it('phase 3 (GO) shows both bulbs green (race.go)', () => {
    render(<RaceStartSignal currentPhase={3} />);
    expect(bulbFills()).toEqual([GO, GO]);
  });

  it('uses the slate void token for the bulb housing border', () => {
    render(<RaceStartSignal currentPhase={2} />);
    expect(window.getComputedStyle(screen.getByTestId('start-bulb-0')).borderColor).toBe(VOID);
  });

  it('shows the housing through the GO phase but hides it once cleared', () => {
    const { rerender } = render(<RaceStartSignal currentPhase={3} />);
    // The Stack wraps the bulbs; phase 3 must remain visible to show GO.
    expect(window.getComputedStyle(screen.getByTestId('start-bulb-0').parentElement!).display).toBe(
      'flex',
    );

    rerender(<RaceStartSignal currentPhase={-1} />);
    expect(window.getComputedStyle(screen.getByTestId('start-bulb-0').parentElement!).display).toBe(
      'none',
    );
  });
});
