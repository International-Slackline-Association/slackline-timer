import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

/**
 * The competition the admin UI is currently operating on. Its `compId` doubles
 * as the relay `sessionId`, so a single selection drives both the data-plane
 * pages (athletes, times, matches) and the live timer (via `useControlSession`).
 * Persisted to localStorage so it survives reloads.
 */

const STORAGE_KEY = 'speedline.selectedCompId';

interface SelectedCompetitionValue {
  /** The selected competition's id, or null when nothing is selected. */
  compId: string | null;
  setCompId: (compId: string | null) => void;
}

const SelectedCompetitionContext = createContext<SelectedCompetitionValue | undefined>(undefined);

const readStored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const SelectedCompetitionProvider = ({ children }: { children: ReactNode }) => {
  const [compId, setCompIdState] = useState<string | null>(readStored);

  const setCompId = useCallback((next: string | null) => {
    setCompIdState(next);
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Private-mode / disabled storage: keep the in-memory selection only.
    }
  }, []);

  return (
    <SelectedCompetitionContext.Provider value={{ compId, setCompId }}>
      {children}
    </SelectedCompetitionContext.Provider>
  );
};

export const useSelectedCompetition = (): SelectedCompetitionValue => {
  const ctx = useContext(SelectedCompetitionContext);
  if (!ctx) {
    throw new Error('useSelectedCompetition must be used within a SelectedCompetitionProvider');
  }
  return ctx;
};
