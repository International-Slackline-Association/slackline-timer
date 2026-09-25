import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Extension-explicit so the specifier also resolves under Vite's
// `configLoader: 'native'`, which has no esbuild pre-bundle to guess it.
import { TEST_TIMEOUT_MS } from './test/timeouts.ts';

// Separate from vite.config.ts on purpose: tests don't need vite-plugin-checker
// (it runs tsc in a worker and fights the test runner). `tsconfigPaths` keeps the
// `app/...` import alias working inside tests.
//
// Tests live in test/, mirroring src/ (see doc/dev/workflow.md).
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // Mirrors vite.config.ts: `app/manual` imports the published manual out of
  // `doc/user/` at the repo root, above this package's default allow-list.
  server: { fs: { allow: ['..'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    // Raised off the 5s default for query-heavy suites; the ceiling only bites
    // on a genuine hang, so healthy runs are unaffected. Paired with Testing
    // Library's own ceiling in ./test/timeouts.ts.
    testTimeout: TEST_TIMEOUT_MS,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
