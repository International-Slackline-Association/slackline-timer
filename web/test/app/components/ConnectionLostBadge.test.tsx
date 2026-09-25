import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionLostBadge } from 'app/components/ConnectionLostBadge';
import type { LinkPhase } from 'app/hooks/useLinkPhase';

const renderBadge = (
  link: LinkPhase,
  { search = '', defaultBg }: { search?: string; defaultBg?: string } = {},
) =>
  render(
    <MemoryRouter initialEntries={[`/stream/rankings${search}`]}>
      <ConnectionLostBadge link={link} defaultBg={defaultBg} />
    </MemoryRouter>,
  );

const rerenderBadge = (rerender: (ui: React.ReactElement) => void, link: LinkPhase) =>
  rerender(
    <MemoryRouter initialEntries={['/stream/rankings']}>
      <ConnectionLostBadge link={link} />
    </MemoryRouter>,
  );

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionLostBadge', () => {
  it.each<LinkPhase>(['open', 'connecting', 'reconnecting'])('shows nothing on %s', (link) => {
    renderBadge(link);
    expect(screen.queryByTestId('connection-lost')).toBeNull();
  });

  it('never claims a lost signal on a link that never arrived', () => {
    renderBadge('unreachable');
    expect(screen.getByTestId('connection-lost')).toHaveTextContent('No signal');
  });

  it('names the drop once the grace is spent', () => {
    renderBadge('lost');
    expect(screen.getByTestId('connection-lost')).toHaveTextContent('Signal lost — reconnecting');
  });

  it('clears the lost badge and flashes "reconnected" when the socket reopens after a drop', () => {
    const { rerender } = renderBadge('lost');
    expect(screen.getByTestId('connection-lost')).toBeInTheDocument();

    rerenderBadge(rerender, 'open');
    expect(screen.queryByTestId('connection-lost')).toBeNull();

    // The self-heal cue takes over briefly, then auto-dismisses.
    expect(screen.getByTestId('connection-reconnected')).toBeInTheDocument();
    advance(3_000);
    expect(screen.queryByTestId('connection-reconnected')).toBeNull();
  });

  it('does not flash "reconnected" on a link that only ever handshook', () => {
    const { rerender } = renderBadge('unreachable');
    rerenderBadge(rerender, 'open');
    expect(screen.queryByTestId('connection-reconnected')).toBeNull();
  });

  it('does not flash "reconnected" on a blip that never surfaced', () => {
    const { rerender } = renderBadge('reconnecting');
    rerenderBadge(rerender, 'open');
    expect(screen.queryByTestId('connection-reconnected')).toBeNull();
  });

  it('suppresses the "reconnected" flash on a chroma-keyed ground', () => {
    const { rerender } = renderBadge('lost', { search: '?bg=key' });
    rerender(
      <MemoryRouter initialEntries={['/stream/rankings?bg=key']}>
        <ConnectionLostBadge link="open" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('connection-reconnected')).toBeNull();
  });

  it('stays invisible on a chroma-keyed ground (?bg=key)', () => {
    renderBadge('lost', { search: '?bg=key' });
    expect(screen.queryByTestId('connection-lost')).toBeNull();
  });

  it('stays invisible in the key-composite mode (?bg=h2r — keyed downstream)', () => {
    renderBadge('lost', { search: '?bg=h2r' });
    expect(screen.queryByTestId('connection-lost')).toBeNull();
  });

  it('respects a chroma default ground (projector variant) without a ?bg= param', () => {
    renderBadge('lost', { defaultBg: 'var(--tl-chroma-key)' });
    expect(screen.queryByTestId('connection-lost')).toBeNull();
  });

  it('shows on a non-chroma ?bg= override of a chroma default', () => {
    renderBadge('lost', { search: '?bg=%23123456', defaultBg: 'var(--tl-chroma-key)' });
    expect(screen.getByTestId('connection-lost')).toBeInTheDocument();
  });
});
