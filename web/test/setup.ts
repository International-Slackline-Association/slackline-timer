import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

import { ASYNC_UTIL_TIMEOUT_MS } from './timeouts';

// `src/app/constants.ts` throws at module load on a missing VITE_APP_* value,
// and Vite loads no .env file for mode "test", so without a baseline every
// suite that transitively imports it (anything touching app/auth) fails on
// import. Unroutable junk: a test that means to reach the network has to say
// so. The suites exercising the rule stub their own env
// (test/app/constants.test.ts).
const BASELINE_ENV: Record<string, string> = {
  VITE_APP_WS_URL: 'ws://test.invalid/ws',
  VITE_APP_API_URL: 'http://test.invalid/api',
  VITE_APP_COGNITO_USER_POOL_ID: 'test-region_testpool',
  VITE_APP_COGNITO_CLIENT_ID: 'test-client-id',
  VITE_APP_COGNITO_DOMAIN: 'auth.test.invalid',
  VITE_APP_COGNITO_TIMER_GROUP: 'timeradmin',
};

for (const [key, value] of Object.entries(BASELINE_ENV)) {
  process.env[key] ??= value;
}

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
