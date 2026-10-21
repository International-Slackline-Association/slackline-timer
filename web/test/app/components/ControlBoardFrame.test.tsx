import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ControlBoardFrame } from 'app/components/ControlBoardFrame';
import { boardGeometry } from 'app/theme/tokens';

// Past the cap the desk's fixed rails would drift away from the capped live
// deck; jsdom lays nothing out, so what it can hold is the cap, its centring and
// that the page padding sits outside it. The measured gaps are the driver's.
describe('ControlBoardFrame', () => {
  it.each(['speedline', 'freestyle'] as const)(
    'caps the %s board at its own boardMax and centres it',
    (board) => {
      render(
        <ControlBoardFrame board={board} spacing={1.5} padding={2}>
          <div data-testid="probe" />
        </ControlBoardFrame>,
      );

      const frame = screen.getByTestId('control-board-frame');
      const style = window.getComputedStyle(frame);
      expect(style.maxWidth).toBe(`${boardGeometry.boardMax[board]}px`);
      expect(style.marginLeft).toBe('auto');
      expect(style.marginRight).toBe('auto');
      expect(frame).toContainElement(screen.getByTestId('probe'));
    },
  );

  it('pads outside the cap, so the content box holds the whole boardMax', () => {
    render(
      <ControlBoardFrame board="speedline" spacing={1} padding={2}>
        <div />
      </ControlBoardFrame>,
    );

    const frame = screen.getByTestId('control-board-frame');
    expect(Number.parseFloat(window.getComputedStyle(frame).padding) || 0).toBe(0);
    expect(window.getComputedStyle(frame.parentElement as HTMLElement).padding).toBe('16px');
  });
});
