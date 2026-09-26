import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FreestyleSelection } from 'app/hooks/useWebSocket';
import { BestTrickTally } from 'app/pages/Freestyle/FreestyleHeroes';

const TALLY: NonNullable<FreestyleSelection['bestTrick']> = {
  cap: 3,
  tries: { 1: 1, 2: 0 },
  turn: 1,
  clockRunning: false,
};

/**
 * The audience best-trick tally is fed by the relay's `{lane1, lane2}` name
 * shape, so it carried its own hand-written "Athlete n" fallback — the copy the
 * shared `athleteLabel` seam exists to prevent (a rename splits the copies, and
 * this one is the surface the room reads). Pinned with EMPTY names, the only
 * state in which the fallback shows at all.
 */
describe('BestTrickTally athlete labels', () => {
  it('falls back to the shared athlete label when the room has no names yet', () => {
    render(
      <BestTrickTally bestTrick={TALLY} laneNames={{ lane1: '', lane2: '' }} variant="hero" />,
    );

    expect(screen.getByText(/^Athlete 1 1\/3$/)).toBeInTheDocument();
    expect(screen.getByText(/^Athlete 2 0\/3$/)).toBeInTheDocument();
  });

  it('shows the relayed names once they arrive', () => {
    render(
      <BestTrickTally
        bestTrick={TALLY}
        laneNames={{ lane1: 'Bianchi', lane2: 'Roe' }}
        variant="band"
      />,
    );

    expect(screen.getByText(/^Bianchi 1\/3$/)).toBeInTheDocument();
    expect(screen.getByText(/^Roe 0\/3$/)).toBeInTheDocument();
    expect(screen.queryByText(/Athlete \d/)).not.toBeInTheDocument();
  });
});
