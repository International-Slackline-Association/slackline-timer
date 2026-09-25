import { readFileSync } from 'node:fs';

import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../infra/app';

// The decommission ledger (server/scripts/decommission/stacks.json) is the durable
// record of every stack + the RETAIN/orphan resources that outlive `cdk destroy`.
// This test makes it self-enforcing: it synthesizes the REAL app and fails if a
// synthesized stack has no live/planned ledger entry (a stack was added/renamed
// without recording it), or if a RETAIN resource is missing from that entry's
// `orphans` (a retained resource was added that a teardown would leak). So the
// info the user must keep about each stack cannot silently drift as code changes.

interface Orphans {
  dynamodbTables: string[];
  s3Buckets: string[];
  ssmParams: string[];
  cloudfrontDistributions: string[];
  logGroupPrefixes: string[];
}
interface LedgerEntry {
  name: string;
  region: string;
  status: 'live' | 'planned' | 'retiring' | 'retired';
  orphans: Orphans;
}

const ledger = JSON.parse(
  readFileSync(new URL('../../scripts/decommission/stacks.json', import.meta.url), 'utf8'),
) as { stacks: LedgerEntry[] };

// Every stack the CLI would deploy, by its CFN stack name. bundling-stacks:[]
// short-circuits NodejsFunction's esbuild via Template.fromStack (same trick as
// slackline-stack.test.ts) — no assets built, no cdk.out written.
const app = createApp({
  'aws:cdk:bundling-stacks': [],
  // Deployment config, never committed — a fixture value keeps synth hermetic.
  billingAlertEmail: 'billing-alerts@example.org',
});
const stacks = app.node.children.filter((c): c is Stack => c instanceof Stack);

// Physical names of every RETAIN resource in a stack's template, by kind.
function retained(stack: Stack) {
  const resources = Template.fromStack(stack).toJSON().Resources as Record<
    string,
    { Type: string; DeletionPolicy?: string; Properties: Record<string, unknown> }
  >;
  const tables: string[] = [];
  const buckets: string[] = [];
  for (const res of Object.values(resources ?? {})) {
    if (res.DeletionPolicy !== 'Retain') continue;
    if (res.Type === 'AWS::DynamoDB::Table') tables.push(res.Properties.TableName as string);
    if (res.Type === 'AWS::S3::Bucket') buckets.push(res.Properties.BucketName as string);
  }
  return { tables, buckets };
}

// Synthesized once at module scope, the same placement slackline-stack.test.ts
// uses: `Template.fromStack` over all three stacks is the expensive part, and at
// import time it sits outside vitest's per-test timeout. Inside the test body it
// ran to ~3s alone but blew the 5s default under full-suite parallel load.
const retainedByStack = new Map(stacks.map((s) => [s.stackName, retained(s)]));

describe('decommission ledger (stacks.json) is complete', () => {
  it('has a live/planned entry for every synthesized stack, listing its RETAIN resources', () => {
    for (const stack of stacks) {
      const entry = ledger.stacks.find((s) => s.name === stack.stackName);
      expect(entry, `stacks.json has no entry named '${stack.stackName}'`).toBeDefined();
      expect(
        ['live', 'planned'],
        `entry '${stack.stackName}' is status '${entry!.status}' but the code still synthesizes it`,
      ).toContain(entry!.status);

      const { tables, buckets } = retainedByStack.get(stack.stackName)!;
      for (const t of tables) {
        expect(
          entry!.orphans.dynamodbTables,
          `RETAIN table '${t}' missing from ledger orphans of '${stack.stackName}'`,
        ).toContain(t);
      }
      for (const b of buckets) {
        expect(
          entry!.orphans.s3Buckets,
          `RETAIN bucket '${b}' missing from ledger orphans of '${stack.stackName}'`,
        ).toContain(b);
      }
    }
  });

  it('has no live/planned entry for a stack the code no longer synthesizes', () => {
    const synthesized = new Set(stacks.map((s) => s.stackName));
    for (const entry of ledger.stacks) {
      if (entry.status === 'live' || entry.status === 'planned') {
        expect(
          synthesized.has(entry.name),
          `ledger entry '${entry.name}' is ${entry.status} but no stack synthesizes it — mark it retiring/retired or fix the name`,
        ).toBe(true);
      }
    }
  });
});
