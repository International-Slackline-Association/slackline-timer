/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getConfig, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ASYNC_UTIL_TIMEOUT_MS, TEST_TIMEOUT_MS } from './timeouts';

/** Testing Library's stock `asyncUtilTimeout`; clearing it is the whole point. */
const LIBRARY_DEFAULT_MS = 1_000;

const RELATIVE_IMPORT = /^import[^']*'(\.[^']*)'/gm;

describe('async test ceilings', () => {
  // Deliberately real time: nothing short of an actual slow resolution proves
  // `test/setup.ts` reached this suite, and it is the one wait the whole
  // harness rests on. Fake timers wouldn't do — Testing Library only detects
  // jest's, so `waitFor` would poll a clock vitest has frozen and hang.
  it('lets a bare waitFor outlast the library default', async () => {
    let arrived = false;
    setTimeout(() => {
      arrived = true;
    }, LIBRARY_DEFAULT_MS + 100);

    await waitFor(() => expect(arrived).toBe(true));
  });

  it('keeps an exhausted wait reportable as a query failure', () => {
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeGreaterThan(LIBRARY_DEFAULT_MS);
    expect(ASYNC_UTIL_TIMEOUT_MS).toBeLessThan(TEST_TIMEOUT_MS);
  });

  // Nothing else covers this file's imports: it is in no tsconfig `include`
  // and in no Vite module graph, so neither `checkTs` nor a test run resolves
  // them. Vite's `configLoader: 'native'` (slated to become the default) takes
  // specifiers literally, where today's esbuild pre-bundle guesses the
  // extension for them.
  it('keeps vitest.config.ts imports resolvable without a pre-bundle', () => {
    const source = readFileSync(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');
    const specifiers = Array.from(source.matchAll(RELATIVE_IMPORT), ([, specifier]) => specifier);

    expect(specifiers).not.toHaveLength(0);
    for (const specifier of specifiers) expect(specifier).toMatch(/\.[cm]?tsx?$/);
  });
});
