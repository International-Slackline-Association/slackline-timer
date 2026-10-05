import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RaceStartSignal from 'app/pages/Speedline/StartSignal';
import { PRE_BEEP_PHASE } from 'app/hooks/useStartSignalTimer';
import { overlayArt } from 'app/theme/tokens';
import { refVh } from 'app/util/overlayScale';

const STOP = 'rgb(240, 78, 52)'; // race.stop
const SET = 'rgb(242, 169, 59)'; // race.set
const GO = 'rgb(101, 188, 123)'; // race.go
const IDLE = 'rgb(138, 147, 157)'; // race.idle
const VOID = 'rgb(51, 60, 78)'; // surface.void (housing)
const WHITE = 'rgb(255, 255, 255)'; // overlay.stroke

const PHASES = [-1, 0, PRE_BEEP_PHASE, 1, 2, 3];

// jsdom resolves `vh` against its viewport, so a `refVh(px)` reads back in px.
const expectRefVh = (computed: string, px: number) =>
  expect(parseFloat(computed)).toBeCloseTo((px / 1080) * window.innerHeight, 1);

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

  it.each(['small', 'large'] as const)(
    'cuts between phases with no fade (%s) — the GO edge is a hard cut',
    (size) => {
      const { rerender } = render(<RaceStartSignal currentPhase={0} size={size} />);
      for (const phase of PHASES) {
        rerender(<RaceStartSignal currentPhase={phase} size={size} />);
        for (const id of ['start-bulb-0', 'start-bulb-1']) {
          const bulb = window.getComputedStyle(screen.getByTestId(id));
          expect(bulb.transition).toBe('');
          expect(bulb.transitionDuration).toBe('0s');
        }
      }
    },
  );

  it('large (overlay/preview) sizes off the 1080p frame inside a stroked void housing', () => {
    render(<RaceStartSignal currentPhase={2} />);
    const bulb = window.getComputedStyle(screen.getByTestId('start-bulb-0'));
    expectRefVh(bulb.width, 60);
    expectRefVh(bulb.height, 60);
    // The housing is the edge; the bulbs carry none of their own.
    expect(bulb.borderTopWidth).toBe('0px');

    const housing = screen.getByTestId('start-signal-housing');
    expect(screen.getByTestId('start-bulb-0').parentElement).toBe(housing);
    const h = window.getComputedStyle(housing);
    expect(h.backgroundColor).toBe(VOID);
    expect(h.borderTopStyle).toBe('solid');
    expectRefVh(h.borderTopWidth, parseFloat(overlayArt.strokeWidth));
    expect(h.borderTopColor).toBe(WHITE);
    // The `gap` shorthand is not resolved to px by jsdom.
    expect(h.gap).toBe(refVh(8));
    expectRefVh(h.paddingTop, 8);
    expect(h.borderTopLeftRadius).toBe('0');
  });

  it('small (control page) keeps its px bulbs with the slate void edge and no housing', () => {
    render(<RaceStartSignal currentPhase={2} size="small" />);
    const bulb = window.getComputedStyle(screen.getByTestId('start-bulb-0'));
    expect(bulb.width).toBe('30px');
    expect(bulb.height).toBe('30px');
    expect(bulb.borderColor).toBe(VOID);
    expect(bulb.borderTopWidth).toBe('1px');
    expect(screen.queryByTestId('start-signal-housing')).toBeNull();
  });

  it('shows the housing through the GO phase but takes it out once cleared (large)', () => {
    const { rerender } = render(<RaceStartSignal currentPhase={3} />);
    const housing = () => window.getComputedStyle(screen.getByTestId('start-signal-housing'));
    expect(housing().display).toBe('flex');

    rerender(<RaceStartSignal currentPhase={-1} />);
    expect(housing().display).toBe('none');
  });

  // `ftt-followup-speedline-board-run-interlocks-1`: collapsing the control
  // page's bulbs on clear lifted Start / Abort / Reset ~30 px under the hand.
  it('hides the control bulbs once cleared but keeps their slot (small)', () => {
    const { rerender } = render(<RaceStartSignal currentPhase={3} size="small" />);
    const root = () => window.getComputedStyle(screen.getByTestId('start-bulb-0').parentElement!);
    expect(root().display).toBe('flex');
    expect(root().visibility).toBe('visible');

    rerender(<RaceStartSignal currentPhase={-1} size="small" />);
    expect(root().display).toBe('flex');
    expect(root().visibility).toBe('hidden');
  });
});
