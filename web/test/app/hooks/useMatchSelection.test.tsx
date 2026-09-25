import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('app/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/api/client')>();
  return { ...actual, apiFetch: apiFetchMock };
});

import { useMatchSelection, type MatchSelectionConfig } from 'app/hooks/useMatchSelection';
import type { Match, TimeRound } from 'app/types';

const COMP = 'c1';

const speedMatch = (matchId: string, athlete1Id: string, athlete2Id: string): Match => ({
  matchId,
  compId: COMP,
  discipline: 'speed',
  round: 'final',
  gender: 'male',
  position: 0,
  athlete1Id,
  athlete2Id,
});

// m1/m2 are final-round; m3 is a quarter — so the round filter has something to
// exclude and the confirm-on-round-change path has a different round to move to.
const MATCHES = [
  speedMatch('m1', 'a1', 'a2'),
  speedMatch('m2', 'a3', 'a4'),
  { ...speedMatch('m3', 'a5', 'a6'), round: 'quarter' as const },
];

const wrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

/** Spies for every mode-cascade callback, so each test asserts what fired. */
const cascades = () => ({
  onSelectionReset: vi.fn(),
  onMatchFilled: vi.fn(),
  onMatchCleared: vi.fn(),
  onGenderApplied: vi.fn(),
});

const renderSelection = (config: Partial<MatchSelectionConfig<TimeRound>> = {}) => {
  const spies = cascades();
  const rendered = renderHook(
    () =>
      useMatchSelection<TimeRound>(COMP, {
        discipline: 'speed',
        initialRound: 'qualification',
        ...spies,
        ...config,
      }),
    { wrapper: wrapper() },
  );
  return { ...rendered, spies };
};

/** A selection with the matches list loaded and match m1 (a1 vs a2) selected. */
const matchSelection = async () => {
  const rendered = renderSelection();
  await waitFor(() => expect(rendered.result.current.matches.isSuccess).toBe(true));
  act(() => rendered.result.current.selectMatch('m1'));
  return rendered;
};

describe('useMatchSelection', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockImplementation((path: string) => {
      if (path.includes('/matches?')) return Promise.resolve(MATCHES);
      return Promise.reject(new Error(`unrouted GET ${path}`));
    });
  });

  it('starts on the configured round with empty slots and no match link', () => {
    const { result } = renderSelection({ initialRound: 'training' });

    expect(result.current.round).toBe('training');
    expect(result.current.athletes).toEqual({ 1: '', 2: '' });
    expect(result.current.selectedGender).toBe('male');
    expect(result.current.selectedMatchId).toBe('');
    expect(result.current.pendingChange).toBeNull();
  });

  it('roundMatches lists only the current round’s matches', async () => {
    const { result } = renderSelection();
    await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

    expect(result.current.roundMatches).toEqual([]);

    act(() => result.current.setRound('final'));
    expect(result.current.roundMatches.map((m) => m.matchId)).toEqual(['m1', 'm2']);
  });

  describe('selectMatch', () => {
    it('autofills the slots and round from the match and resets the seed guard', async () => {
      const { result, spies } = await matchSelection();

      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(result.current.round).toBe('final');
      expect(result.current.seededMatchId.current).toBeNull();
      // Selection-context change fires the mode reset, then the post-fill cascade.
      expect(spies.onSelectionReset).toHaveBeenCalledTimes(1);
      expect(spies.onMatchFilled).toHaveBeenCalledTimes(1);
    });

    it('clearing the link keeps the slots and never fires the fill cascade', async () => {
      const { result, spies } = await matchSelection();

      act(() => result.current.selectMatch(''));

      expect(result.current.selectedMatchId).toBe('');
      // A manual (off-bracket) run must not be disrupted by clearing the link.
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
      expect(spies.onSelectionReset).toHaveBeenCalledTimes(2);
      expect(spies.onMatchFilled).toHaveBeenCalledTimes(1);
    });
  });

  it('findMatch resolves a fetched match by id', async () => {
    const { result } = renderSelection();
    await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

    expect(result.current.findMatch('m2')?.athlete1Id).toBe('a3');
    expect(result.current.findMatch('nope')).toBeUndefined();
  });

  describe('confirm-guarded round change (ADR 0033)', () => {
    it('changes the round immediately when no match is selected', async () => {
      const { result } = renderSelection();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));

      act(() => result.current.requestRound('quarter'));

      expect(result.current.round).toBe('quarter');
      expect(result.current.pendingChange).toBeNull();
    });

    it('defers a round change while a match is selected, then confirms it', async () => {
      const { result, spies } = await matchSelection();

      act(() => result.current.requestRound('quarter'));
      expect(result.current.pendingChange).toEqual({ kind: 'round', round: 'quarter' });
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');

      act(() => result.current.confirmPendingChange());
      expect(result.current.round).toBe('quarter');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      // The orphaned match clears through clearMatch: reset + cleared cascades.
      expect(spies.onSelectionReset).toHaveBeenCalledTimes(2);
      expect(spies.onMatchCleared).toHaveBeenCalledTimes(1);
    });

    it('cancelling a round change leaves the round and match untouched', async () => {
      const { result } = await matchSelection();

      act(() => result.current.requestRound('quarter'));
      act(() => result.current.cancelPendingChange());

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.round).toBe('final');
      expect(result.current.selectedMatchId).toBe('m1');
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });
  });

  describe('confirm-guarded gender change (cascading filters)', () => {
    it('switches immediately with no match selected, clearing the slots', async () => {
      const { result, spies } = renderSelection();
      await waitFor(() => expect(result.current.matches.isSuccess).toBe(true));
      act(() => result.current.setAthletes({ 1: 'a1', 2: '' }));

      act(() => result.current.requestGender('female'));

      // The picks came from the male-filtered list — off-filter now, cleared.
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      expect(spies.onGenderApplied).toHaveBeenCalledTimes(1);
    });

    it('a same-value gender request is a no-op (never pends)', async () => {
      const { result } = await matchSelection();

      act(() => result.current.requestGender('male'));

      expect(result.current.pendingChange).toBeNull();
      expect(result.current.athletes).toEqual({ 1: 'a1', 2: 'a2' });
    });

    it('defers a gender change while a match is selected, then confirms it', async () => {
      const { result, spies } = await matchSelection();

      act(() => result.current.requestGender('female'));
      expect(result.current.pendingChange).toEqual({ kind: 'gender', gender: 'female' });
      expect(result.current.selectedGender).toBe('male');

      act(() => result.current.confirmPendingChange());
      expect(result.current.selectedGender).toBe('female');
      expect(result.current.pendingChange).toBeNull();
      expect(result.current.selectedMatchId).toBe('');
      expect(result.current.athletes).toEqual({ 1: '', 2: '' });
      expect(spies.onGenderApplied).toHaveBeenCalledTimes(1);
      expect(spies.onMatchCleared).toHaveBeenCalledTimes(1);
    });
  });
});
