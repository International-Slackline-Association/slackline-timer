import { describe, expect, it } from 'vitest';

import { assertBucketIsOurs } from '../../internals/deployToS3.mjs';

/**
 * The gate in front of `s3 sync --delete`. The bucket NAME comes from the
 * stack, but says nothing about which account it resolves in;
 * `--expected-bucket-owner` is what turns "a bucket by this name answered" into
 * "our bucket answered". These pin that the flag is always sent — dropping it,
 * or making it conditional on an env var, downgrades the check silently at the
 * one point where files start being deleted.
 *
 * The AWS CLI is injected as `run`, so nothing spawns a process.
 */
describe('assertBucketIsOurs', () => {
  const ok = () => '';

  it('always sends --expected-bucket-owner with the account', () => {
    let argv: string[] = [];
    assertBucketIsOurs('ui-bucket', {
      account: '123456789012',
      run: (args) => {
        argv = args;
        return ok();
      },
    });

    expect(argv).toEqual([
      's3api',
      'head-bucket',
      '--bucket',
      'ui-bucket',
      '--expected-bucket-owner',
      '123456789012',
    ]);
  });

  it('passes the profile and region through to the CLI', () => {
    let opts: { profile?: string; region?: string } | undefined;
    assertBucketIsOurs('ui-bucket', {
      account: '123456789012',
      profile: 'deploy-profile',
      region: 'eu-central-1',
      run: (_args, o) => {
        opts = o;
        return ok();
      },
    });

    expect(opts).toMatchObject({ profile: 'deploy-profile', region: 'eu-central-1' });
  });

  it('refuses the sync when the bucket is absent or owned by another account', () => {
    expect(() =>
      assertBucketIsOurs('ui-bucket', {
        account: '123456789012',
        run: () => {
          throw new Error('An error occurred (403) when calling the HeadBucket operation');
        },
      }),
    ).toThrow(/refusing to sync/);
  });

  it('names the bucket and the expected account in the refusal', () => {
    // The operator has to be able to tell a wrong-account hit from a missing
    // bucket without re-running the CLI by hand.
    expect(() =>
      assertBucketIsOurs('ui-bucket', {
        account: '123456789012',
        run: () => {
          throw new Error('403');
        },
      }),
    ).toThrow(/s3:\/\/ui-bucket is owned by account 123456789012/);
  });
});
