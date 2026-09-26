import { describe, expect, it } from 'vitest';

import { requireOutputs, stackOutputs } from '../../internals/stackOutputs.mjs';

/**
 * Guards the deploy tooling's stack-output resolver
 * (web/internals/stackOutputs.mjs). The deploy uploads with `s3 sync --delete`,
 * so every failure mode here is one where the alternative — a stale literal, a
 * partial map, an empty string — is indistinguishable from a correct value at
 * the point where files start being deleted.
 *
 * The AWS CLI is injected as `run`, so nothing spawns a process.
 */

const describeStacks = (outputs: Record<string, string>) =>
  JSON.stringify({
    Stacks: [
      {
        StackName: 'a-stack',
        Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
          OutputKey,
          OutputValue,
        })),
      },
    ],
  });

const WEB = { stackName: 'a-web-stack', region: 'eu-central-1' };

describe('stackOutputs', () => {
  it('asks the right stack in the right region and maps the outputs', () => {
    const calls: { args: string[]; opts?: { profile?: string; region?: string } }[] = [];
    const run = (args: string[], opts?: { profile?: string; region?: string }) => {
      calls.push({ args, opts });
      return describeStacks({ WebBucketName: 'a-bucket', WebDistributionId: 'ABC123' });
    };

    const outputs = stackOutputs('a-web-stack', { region: 'eu-central-1', profile: 'p', run });

    expect(outputs).toEqual({ WebBucketName: 'a-bucket', WebDistributionId: 'ABC123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'a-web-stack',
      '--output',
      'json',
    ]);
    // Region and profile travel as CLI options, not in the command — the two
    // stacks this deploy reads live in different regions.
    expect(calls[0].opts).toEqual({ region: 'eu-central-1', profile: 'p' });
  });

  it('names the stack and region when the CLI fails', () => {
    const run = () => {
      throw new Error('An error occurred (ValidationError): Stack does not exist');
    };
    expect(() => stackOutputs('a-web-stack', { region: 'eu-central-1', run })).toThrow(
      /a-web-stack \(eu-central-1\).*Stack does not exist/s,
    );
  });

  it('throws when the stack is absent from the payload', () => {
    const run = () => JSON.stringify({ Stacks: [] });
    expect(() => stackOutputs('a-web-stack', { region: 'eu-central-1', run })).toThrow(
      /a-web-stack \(eu-central-1\) does not exist/,
    );
  });

  it('throws on an unparseable payload instead of reporting no outputs', () => {
    const run = () => 'Unable to locate credentials';
    expect(() => stackOutputs('a-web-stack', { region: 'eu-central-1', run })).toThrow(
      /no parseable JSON/,
    );
  });

  it('returns an empty map for a stack that publishes nothing', () => {
    const run = () => JSON.stringify({ Stacks: [{ StackName: 'a-stack' }] });
    expect(stackOutputs('a-web-stack', { region: 'eu-central-1', run })).toEqual({});
  });
});

describe('requireOutputs', () => {
  it('returns only the requested outputs', () => {
    const outputs = { WebBucketName: 'a-bucket', WebDistributionId: 'ABC123', WebUrl: 'https://x' };
    expect(requireOutputs(outputs, ['WebBucketName', 'WebDistributionId'], WEB)).toEqual({
      WebBucketName: 'a-bucket',
      WebDistributionId: 'ABC123',
    });
  });

  it('names every missing output and what the stack does publish', () => {
    const err = () => requireOutputs({ WebUrl: 'https://x' }, ['WebBucketName'], WEB);
    expect(err).toThrow(/publishes no WebBucketName output/);
    expect(err).toThrow(/publishes: WebUrl/);
    expect(err).toThrow(/cdk deploy a-web-stack/);
  });

  it('reports an empty stack as publishing nothing rather than an empty list', () => {
    expect(() => requireOutputs({}, ['WebBucketName'], WEB)).toThrow(/publishes: none/);
  });

  it('treats a blank output as missing', () => {
    // An empty bucket name reaching `s3 sync --delete` is the accident this
    // module exists to prevent.
    expect(() => requireOutputs({ WebBucketName: '   ' }, ['WebBucketName'], WEB)).toThrow(
      /publishes no WebBucketName output/,
    );
  });

  it('trims the values it does return', () => {
    expect(requireOutputs({ WebBucketName: 'a-bucket\n' }, ['WebBucketName'], WEB)).toEqual({
      WebBucketName: 'a-bucket',
    });
  });
});
