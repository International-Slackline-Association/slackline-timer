import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CompactBoardLayout } from 'app/pages/Freestyle/CompactBoardLayout';

const baseProps = {
  tallyPlate: <div>Tally</div>,
  selectionSection: <div>Selection section</div>,
  runSection: <div>Run section</div>,
  bestTrickSection: <div>Best trick section</div>,
  scoreSection: <div>Score section</div>,
  warmupSection: <div>Warm-up section</div>,
  setupSection: <div>Setup section</div>,
  handsetSection: <div>Handset section</div>,
} as const;

describe('CompactBoardLayout', () => {
  it('renders Setup as the first compact tab', () => {
    render(<CompactBoardLayout mode="battle" step="selection" {...baseProps} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Setup',
      'Selection',
      'Run',
      'Best trick',
      'Score',
    ]);
  });

  it('keeps the mobile Setup content order as warm-up, setup, handset', () => {
    // The warm-up is how the board reaches that tab: `currentStep` never
    // reports `'setup'`, so the step type has no such member to render from.
    render(<CompactBoardLayout mode="battle" step="warmup" {...baseProps} />);

    const warmup = screen.getByText('Warm-up section');
    const setup = screen.getByText('Setup section');
    const handset = screen.getByText('Handset section');

    expect(warmup.compareDocumentPosition(setup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(setup.compareDocumentPosition(handset)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // The quali loop (Save -> Reset -> pick): the rail's reset hands the board
  // back to Selection, and the tab follows without a hunt for the picker.
  it.each(['quali', 'battle'] as const)(
    'moves from the Score tab to Selection when the %s board is re-armed',
    (mode) => {
      const { rerender } = render(<CompactBoardLayout mode={mode} step="score" {...baseProps} />);
      expect(screen.getByRole('tab', { name: 'Score' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Score section')).toBeInTheDocument();

      rerender(<CompactBoardLayout mode={mode} step="selection" {...baseProps} />);

      expect(screen.getByRole('tab', { name: 'Selection' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText('Selection section')).toBeInTheDocument();
      expect(screen.queryByText('Score section')).toBeNull();
    },
  );

  // A save over clocks that never ran: the step goes Run -> Selection without
  // passing Score, so the operator picked the Score tab by hand and is reading
  // the SAVED chip. Moving them off it would hide the save they just made.
  it.each(['quali', 'battle'] as const)(
    'holds a hand-picked Score tab when a %s save lands over pristine clocks',
    (mode) => {
      const { rerender } = render(<CompactBoardLayout mode={mode} step="run" {...baseProps} />);
      fireEvent.click(screen.getByRole('tab', { name: 'Score' }));

      rerender(<CompactBoardLayout mode={mode} step="selection" {...baseProps} />);

      expect(screen.getByRole('tab', { name: 'Score' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Score section')).toBeInTheDocument();
    },
  );

  it('still follows Run -> Selection from any tab but Score', () => {
    const { rerender } = render(<CompactBoardLayout mode="battle" step="run" {...baseProps} />);

    rerender(<CompactBoardLayout mode="battle" step="selection" {...baseProps} />);

    expect(screen.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
  });
});
