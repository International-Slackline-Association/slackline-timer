import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ConnectingBadge } from 'app/components/ConnectingBadge';
import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import type { LinkPhase } from 'app/hooks/useLinkPhase';

/**
 * The pair as the display surfaces mount it. Both plates are fixed to the same
 * corner, so their readings have to partition the phases: two would stack on
 * one another, none would leave a not-OPEN overlay saying nothing about why it
 * is blank.
 */
const renderPair = (link: LinkPhase) =>
  render(
    <MemoryRouter initialEntries={['/freestyle/preview']}>
      <ConnectingBadge link={link} />
      <ConnectionLostBadge link={link} />
    </MemoryRouter>,
  );

describe('the corner link badges', () => {
  it.each<LinkPhase>(['connecting', 'reconnecting', 'unreachable', 'lost'])(
    'paints exactly one plate on %s',
    (link) => {
      renderPair(link);
      expect(screen.getAllByRole('status')).toHaveLength(1);
    },
  );

  it('paints none while the link is open', () => {
    renderPair('open');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
