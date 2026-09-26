import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useQueryParams, useRelaySessionId } from 'app/hooks/useQueryParams';

const at = (search: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/preview${search}`]}>{children}</MemoryRouter>
  );
  return renderHook(() => useQueryParams(), { wrapper }).result;
};

const relaySessionAt = (search: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/stream/timer${search}`]}>{children}</MemoryRouter>
  );
  return renderHook(() => useRelaySessionId(), { wrapper }).result;
};

describe('useQueryParams', () => {
  it('parses all four params from the URL', () => {
    const { current } = at('?timer=2&sessionId=comp-1&bottomMargin=48&sideMargin=32');
    expect(current).toEqual({
      timerId: 2,
      sessionId: 'comp-1',
      bottomMargin: 48,
      sideMargin: 32,
    });
  });

  it('defaults timerId to 1 and sessionId to "default" when absent', () => {
    const { current } = at('');
    expect(current.timerId).toBe(1);
    expect(current.sessionId).toBe('default');
    expect(current.bottomMargin).toBeUndefined();
    expect(current.sideMargin).toBeUndefined();
  });

  it('keeps a zero margin instead of dropping it', () => {
    const { current } = at('?bottomMargin=0&sideMargin=0');
    expect(current.bottomMargin).toBe(0);
    expect(current.sideMargin).toBe(0);
  });

  it('re-derives on navigation, dropping params no longer present in the URL', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/preview?sessionId=comp-1&sideMargin=32']}>
        {children}
      </MemoryRouter>
    );
    const { result } = renderHook(() => ({ params: useQueryParams(), navigate: useNavigate() }), {
      wrapper,
    });

    expect(result.current.params.sessionId).toBe('comp-1');
    expect(result.current.params.sideMargin).toBe(32);

    // Navigate to a URL without sideMargin: the old effect-based hook left the
    // stale value stuck; the derived hook must clear it.
    act(() => result.current.navigate('/preview?sessionId=comp-2'));

    expect(result.current.params.sessionId).toBe('comp-2');
    expect(result.current.params.sideMargin).toBeUndefined();
  });
});

describe('useRelaySessionId', () => {
  // The regression: a /stream/timer overlay is addressed by ?compId= and its read
  // token is scoped to that compId, so the relay session must resolve to compId —
  // not the "default" sessionId fallback that made the $connect authorizer reject
  // the handshake and blank the overlay.
  it('prefers ?compId= (the broadcast overlay convention)', () => {
    expect(relaySessionAt('?compId=worlds-2026&token=abc').current).toBe('worlds-2026');
  });

  it('falls back to ?sessionId= (the projector convention)', () => {
    expect(relaySessionAt('?sessionId=worlds-2026').current).toBe('worlds-2026');
  });

  it('prefers compId over sessionId when both are present', () => {
    expect(relaySessionAt('?compId=comp-a&sessionId=comp-b').current).toBe('comp-a');
  });

  it('defaults to "default" when neither is present', () => {
    expect(relaySessionAt('').current).toBe('default');
  });
});
