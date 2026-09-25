import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Tests live in test/, mirroring src/ (see doc/dev/workflow.md), and import
// production code through the tsconfig path aliases — mapped here for vitest.
export default defineConfig({
  resolve: {
    alias: {
      core: fileURLToPath(new URL('./src/core', import.meta.url)),
      '@functions': fileURLToPath(new URL('./src/functions', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    // Points core/aws/clients at the local DynamoDB container before any test
    // module loads, so the *.int.test.ts suites can hit it. Inert for the pure
    // unit tests, which never open a connection. See test/integration/env.setup.ts.
    setupFiles: ['test/integration/env.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**'],
    },
  },
});
