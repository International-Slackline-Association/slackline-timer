/**
 * The test harness's two async ceilings, kept together because they only make
 * sense against each other: `vitest.config.ts` takes `TEST_TIMEOUT_MS`,
 * `test/setup.ts` hands `ASYNC_UTIL_TIMEOUT_MS` to Testing Library.
 *
 * Query-heavy suites poll React Query fetches through `findBy`/`waitFor`, and
 * under the CPU contention of the full root `npm test` a round trip can miss a
 * tight ceiling. Testing Library governs those waits with its own 1 s
 * `asyncUtilTimeout`, which vitest's `testTimeout` does not touch — so raising
 * only one leaves every suite on the tighter of the two.
 */
export const TEST_TIMEOUT_MS = 15_000;

/**
 * Stays under `TEST_TIMEOUT_MS` so an exhausted wait fails as Testing Library's
 * "unable to find element" (which prints the DOM) rather than as an opaque
 * vitest test timeout.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 10_000;
