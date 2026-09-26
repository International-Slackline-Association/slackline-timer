import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { OFFLINE_ENV } from '../../scripts/offlineEnv.mjs';

/**
 * Guards the offline harness env (scripts/offlineEnv.mjs). Local dev bypasses
 * Cognito entirely, so it needs no deployed pool id — and a real, account-scoped
 * one on every contributor's laptop is what ADR 0048 removes.
 *
 * That the placeholders are not deployed ids is pinned repo-wide by
 * test/repo/no-committed-endpoints.test.ts; what is specific here is the shape
 * constraint and the escape hatch.
 */

describe('offlineEnv keeps local dev off the real pool', () => {
  it('resolves a pool id the Cognito verifier will accept', () => {
    // The real authorizers run in-process under the local harnesses, and
    // CognitoJwtVerifier.create() validates the `<region>_<id>` shape at module
    // load — a free-form placeholder kills `npm run dev` at startup with an
    // error pointing nowhere near this file.
    expect(OFFLINE_ENV.COGNITO_USER_POOL_ID).toMatch(/^[a-z]{2}-[a-z]+-\d_\w+$/);
  });

  it('lets an exported value override every Cognito id', async () => {
    // The placeholders are a default, not a wall: pointing local at a real pool
    // (to replay a genuine IdToken) must stay possible.
    const src = await readFile(new URL('../../scripts/offlineEnv.mjs', import.meta.url), 'utf8');
    for (const key of ['COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'COGNITO_TIMER_GROUP']) {
      expect(src).toContain(`${key}: process.env.${key} ??`);
    }
  });
});
