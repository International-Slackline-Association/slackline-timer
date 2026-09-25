import { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelectedCompetitionProvider, useSelectedCompetition } from 'app/state/selectedCompetition';

const STORAGE_KEY = 'speedline.selectedCompId';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectedCompetitionProvider>{children}</SelectedCompetitionProvider>
);

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('useSelectedCompetition', () => {
  it('starts with no selection when storage is empty', () => {
    const { result } = renderHook(() => useSelectedCompetition(), { wrapper });
    expect(result.current.compId).toBeNull();
  });

  it('persists the selection to localStorage', () => {
    const { result } = renderHook(() => useSelectedCompetition(), { wrapper });

    act(() => result.current.setCompId('worlds-2026'));

    expect(result.current.compId).toBe('worlds-2026');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('worlds-2026');
  });

  it('restores the selection from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'euros-2026');
    const { result } = renderHook(() => useSelectedCompetition(), { wrapper });
    expect(result.current.compId).toBe('euros-2026');
  });

  it('clears the selection', () => {
    window.localStorage.setItem(STORAGE_KEY, 'euros-2026');
    const { result } = renderHook(() => useSelectedCompetition(), { wrapper });

    act(() => result.current.setCompId(null));

    expect(result.current.compId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useSelectedCompetition())).toThrow(/SelectedCompetitionProvider/);
  });
});
