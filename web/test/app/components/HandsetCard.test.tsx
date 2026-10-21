import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HandsetCard } from 'app/components/HandsetCard';

import { pressPad } from '../../util/gamepadMock';

vi.mock('app/hooks/useGamepads', () => import('../../util/gamepadMock'));

/** A real Chrome pad id: the longest thing the strip's presence line carries. */
const PAD_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const VERDICT = 'handset 3 · red → locked: Lane 1 is not running';

vi.mock('app/state/gamepadSelection', () => ({
  useGamepadSelection: () => ({
    connectedPads: [{ index: 0, id: PAD_ID }],
    selectedPadId: null,
    setSelectedPadId: vi.fn(),
    selectedIndex: 0,
  }),
}));

const renderCard = (variant: 'card' | 'strip') =>
  render(<HandsetCard title="Speedline" rows={[]} describe={() => VERDICT} variant={variant} />);

const expectOneTruncatedLine = (el: HTMLElement) => {
  const style = window.getComputedStyle(el);
  expect(style.whiteSpace).toBe('nowrap');
  expect(style.overflow).toBe('hidden');
  expect(style.textOverflow).toBe('ellipsis');
};

describe('HandsetCard', () => {
  // At the 1024 tablet the strip shares the setup row with the Preview switch
  // in ~430 px; a long pad id or press line that wraps it to a second row
  // pushes `Lane n DNF` under the 768 px fold.
  describe('strip', () => {
    it('holds a long press readout to one truncated line, the whole sentence in its title', () => {
      renderCard('strip');
      pressPad(10);

      const readout = screen.getByTestId('handset-readout');
      expect(readout).toHaveTextContent(`last: ${VERDICT}`);
      expectOneTruncatedLine(readout);
      expect(readout.title).toBe(readout.textContent);
      expect(window.getComputedStyle(readout).minWidth).toBe('0px');
    });

    it('lays presence, readout and the map trigger on one row that never wraps', () => {
      renderCard('strip');
      const strip = screen.getByTestId('handset-strip');
      const row = strip.firstElementChild as HTMLElement;

      expect(window.getComputedStyle(row).flexWrap).toBe('nowrap');
      const presence = within(strip).getByText(`Controller: ${PAD_ID}`);
      expectOneTruncatedLine(presence);
      expect(presence).toHaveAttribute('title', PAD_ID);
      const trigger = within(strip).getByRole('button', { name: 'Open handset map' });
      // The text lines give way; the press keeps its label on one line.
      expect(window.getComputedStyle(trigger.parentElement as HTMLElement).flexShrink).toBe('0');
    });
  });

  // The desk tier's card has the width for both lines whole.
  it('lets the card wrap its readout and presence lines', () => {
    renderCard('card');
    pressPad(10);

    const readout = screen.getByTestId('handset-readout');
    expect(window.getComputedStyle(readout).whiteSpace).not.toBe('nowrap');
    expect(readout).not.toHaveAttribute('title');
    expect(window.getComputedStyle(screen.getByText(`Controller: ${PAD_ID}`)).whiteSpace).not.toBe(
      'nowrap',
    );
  });
});
