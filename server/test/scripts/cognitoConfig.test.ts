import { describe, expect, it } from 'vitest';

import { requireConfig } from '../../scripts/cognito/cognitoCommon.mjs';

/**
 * Guards the Cognito scripts' fail-fast (scripts/cognito/cognitoCommon.mjs).
 * Pool id / region / group / client id come from `.env.deploy` or a flag
 * instead of a committed default, which only helps if "neither" is a loud stop
 * naming the variable.
 *
 * Every case passes `opts` explicitly: cognitoCommon loads `.env.deploy` at
 * import, so nothing here may read the ambient environment or the assertions
 * hold in CI but not on an operator box.
 */

const message = (opts: Record<string, string>, ...keys: string[]) => {
  try {
    requireConfig(opts, ...keys);
  } catch (err) {
    return err as Error & { code?: string };
  }
  return undefined;
};

describe('requireConfig', () => {
  it('passes through when every key resolved', () => {
    const opts = { poolId: 'p', region: 'r', group: 'g' };
    expect(requireConfig(opts, 'poolId', 'region', 'group')).toBe(opts);
  });

  it('names the env var AND the flag for each missing key', () => {
    const err = message({ region: 'r' }, 'poolId', 'region', 'group');
    expect(err?.message).toContain('COGNITO_USER_POOL_ID');
    expect(err?.message).toContain('--pool-id');
    expect(err?.message).toContain('COGNITO_TIMER_GROUP');
    expect(err?.message).toContain('--group');
    // The one that DID resolve must not be reported as missing.
    expect(err?.message).not.toContain('COGNITO_REGION');
  });

  it('points at the template rather than just stating the variable', () => {
    expect(message({}, 'clientId')?.message).toContain('.env.deploy.example');
  });

  it('marks the failure as config so runMain skips the SSO hint', () => {
    // A missing variable is not an expired session; the auth hint would send
    // the operator down the wrong path.
    expect(message({}, 'poolId')?.code).toBe('CONFIG');
  });

  it('treats an empty string as unset', () => {
    // `COGNITO_REGION=` in .env.deploy is a half-filled template, not a value —
    // it would otherwise reach the CLI as an empty --region.
    expect(message({ region: '' }, 'region')?.message).toContain('COGNITO_REGION');
  });
});
