import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ConnectingBadge } from 'app/components/ConnectingBadge';
import type { LinkPhase } from 'app/hooks/useLinkPhase';

const renderBadge = (
  link: LinkPhase,
  { search = '', defaultBg }: { search?: string; defaultBg?: string } = {},
) =>
  render(
    <MemoryRouter initialEntries={[`/stream/timer${search}`]}>
      <ConnectingBadge link={link} defaultBg={defaultBg} />
    </MemoryRouter>,
  );

describe('ConnectingBadge', () => {
  it('names a first handshake', () => {
    renderBadge('connecting');
    expect(screen.getByTestId('connecting')).toHaveTextContent('Connecting');
  });

  it('names a drop the link is still inside the grace of', () => {
    renderBadge('reconnecting');
    expect(screen.getByTestId('connecting')).toHaveTextContent('Reconnecting');
  });

  it.each<LinkPhase>(['open', 'unreachable', 'lost'])('shows nothing on %s', (link) => {
    renderBadge(link);
    expect(screen.queryByTestId('connecting')).toBeNull();
  });

  it('stays invisible on a chroma-keyed ground (?bg=key)', () => {
    renderBadge('connecting', { search: '?bg=key' });
    expect(screen.queryByTestId('connecting')).toBeNull();
  });

  it('respects a chroma default ground (projector variant) without a ?bg= param', () => {
    renderBadge('connecting', { defaultBg: 'var(--tl-chroma-key)' });
    expect(screen.queryByTestId('connecting')).toBeNull();
  });

  it('shows on a non-chroma ?bg= override of a chroma default', () => {
    renderBadge('connecting', {
      search: '?bg=%23123456',
      defaultBg: 'var(--tl-chroma-key)',
    });
    expect(screen.getByTestId('connecting')).toBeInTheDocument();
  });
});
