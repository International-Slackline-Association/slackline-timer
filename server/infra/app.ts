#!/usr/bin/env node
// CDK app entrypoint (run via `npx tsx infra/app.ts`, see cdk.json). Two stacks:
// the backend (relay + data plane + photo CDN) in eu-central-2, and the web
// frontend (S3 + CloudFront) in eu-central-1. The account resolves from the
// deploying credentials. (Cognito also stays in eu-central-1 — the shared ISA
// pool — and is verified cross-region. Only the backend runs in eu-central-2.)
//
// CloudFormation stack names are kebab-case: the construct id IS the stack name
// (no explicit stackName prop). Renaming an id changes only the stack name —
// child resource logical IDs are pathed relative to the stack, so they are
// untouched. On an already-deployed stack this is a NEW CFN stack + a
// decommission of the old one (its RETAIN resources outlive `cdk destroy`, so they
// are re-imported into the new stack): see the commission/decommission script
// READMEs and the ledger server/scripts/decommission/stacks.json.
// Every stack name here must have a live/planned entry in that ledger — enforced
// by test/infra/stack-ledger.test.ts, which synthesizes createApp() below.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { App } from 'aws-cdk-lib';

import { BillingStack } from './billing-stack';
import { SlacklineTimerV1Stack } from './slackline-stack';
import { SlacklineTimerV1WebStack } from './web-stack';

// Deployment config that must NOT live in a public repo — the AWS profile and
// the cost-alert subscriber — is read from an ignored repo-root `.env.deploy`
// (template: `.env.deploy.example`). Loaded here, before any stack is built, so
// `cdk deploy` works without every operator exporting the vars by hand. Absent
// file is fine: CI and the infra tests pass their values as CDK context.
const DEPLOY_ENV = fileURLToPath(new URL('../../.env.deploy', import.meta.url));
if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);

/**
 * Build the CDK app. Exported (rather than inlined at module scope) so the
 * ledger drift-guard test can synthesize the exact same stacks the CLI deploys.
 * `context` lets the test pass `aws:cdk:bundling-stacks: []` to skip esbuild.
 */
export function createApp(context?: Record<string, unknown>): App {
  const app = new App({ context });
  const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'prod';
  const account = process.env.CDK_DEFAULT_ACCOUNT;

  // Wrong-profile guard. `.env.deploy` pins the account these stacks belong to;
  // the account actually deployed to resolves from the ambient credentials. A
  // mismatch means the wrong profile is active — fail here, before CFN starts
  // building a parallel copy of the whole backend in a foreign account. Both
  // sides are optional: CI and the ledger drift-guard test set neither.
  const pinnedAccount = process.env.AWS_ACCOUNT_ID;
  if (pinnedAccount && account && pinnedAccount !== account) {
    throw new Error(
      `AWS account mismatch: the active credentials resolve to ${account}, but AWS_ACCOUNT_ID ` +
        `pins ${pinnedAccount}. Check AWS_PROFILE / .env.deploy — see doc/dev/deploy.md.`,
    );
  }

  new SlacklineTimerV1Stack(app, 'slackline-timer-v1', {
    stage,
    env: { region: 'eu-central-2', account },
    description: `slackline-timer-v1 backend (${stage}) — WS relay + competition data plane + photo CDN`,
  });

  new SlacklineTimerV1WebStack(app, 'slackline-timer-v1-web', {
    stage,
    env: { region: 'eu-central-1', account },
    description: `slackline-timer-v1 web frontend (${stage}) — S3 + CloudFront`,
  });

  // Cost backstop (ADR 0031 §1). Pinned to us-east-1: the CloudWatch
  // EstimatedCharges billing metric is published only there, so the alarm + its
  // SNS topic must live in us-east-1 regardless of where the app runs. The
  // monthly Budget rides along (Budgets is a global service).
  new BillingStack(app, 'slackline-timer-v1-billing', {
    stage,
    env: { region: 'us-east-1', account },
    description: `slackline-timer-v1 cost backstop (${stage}) — Budget + EstimatedCharges alarm`,
  });

  return app;
}

// Entrypoint: construct the app for the CDK CLI (which auto-synths on exit).
// Guarded so importing this module (the ledger drift-guard test) does NOT build
// a second app + stage esbuild assets — the test calls createApp() itself with
// bundling disabled. `cdk synth`/`deploy` run this file as the main module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp();
}
