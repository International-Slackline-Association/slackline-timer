import { render, screen } from '@testing-library/react';
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
});
