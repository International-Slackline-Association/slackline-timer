import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

import { ASYNC_UTIL_TIMEOUT_MS } from './timeouts';

// Testing Library polices `findBy`/`waitFor` with its own ceiling, so raise it
// here for every suite rather than per call site (see ./timeouts.ts).
configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

// jsdom in this setup ships no Web Storage, but the app uses localStorage
// (e.g. the selected-competition state). Provide a minimal in-memory Storage so
// component/hook tests can exercise persistence.
const storageMissing = (): boolean => {
  try {
    return typeof window === 'undefined' || window.localStorage == null;
  } catch {
    // jsdom defines a localStorage getter that throws on an opaque origin.
    return true;
  }
};

if (storageMissing()) {
  const createStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key) => (store.has(key) ? store.get(key)! : null),
      key: (index) => Array.from(store.keys())[index] ?? null,
      removeItem: (key) => void store.delete(key),
      setItem: (key, value) => void store.set(key, String(value)),
    };
  };
  Object.defineProperty(window, 'localStorage', { value: createStorage(), configurable: true });
}

afterEach(() => {
  cleanup();
});
