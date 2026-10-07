#!/usr/bin/env node
// CDK app entrypoint (`npx tsx infra/app.ts`, see cdk.json). Three stacks: the
// backend (relay + data plane + photo CDN) in eu-central-2, the web frontend
// (S3 + CloudFront) in eu-central-1, the billing backstop in us-east-1. The
// account resolves from the deploying credentials; the Cognito pool stays in
// eu-central-1 and is verified cross-region.
//
// The construct id IS the CFN stack name. Renaming one on a deployed stack is a
// migration — a new stack + decommission of the old, its RETAIN resources
// re-imported (the commission/decommission READMEs). Every stack name needs a
// live/planned entry in server/scripts/decommission/stacks.json, enforced by
// test/infra/stack-ledger.test.ts.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { App } from 'aws-cdk-lib';

import { BillingStack } from './billing-stack';
import { CognitoConfig, SlacklineTimerV1Stack } from './slackline-stack';
import { SlacklineTimerV1WebStack } from './web-stack';

// Deployment config kept out of the public repo (ADR 0048): the ignored
// repo-root `.env.deploy` (template: `.env.deploy.example`). Absent is fine: CI
// and the infra tests pass CDK context.
const DEPLOY_ENV = fileURLToPath(new URL('../../.env.deploy', import.meta.url));
if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);

/**
 * CDK context (`-c key=value`) → `.env.deploy` / the ambient environment →
 * throw. No default: a wrong Cognito pool would fail at auth time on a live
 * event, not at synth.
 */
function requireDeployConfig(app: App, contextKey: string, envKey: string): string {
  const value = (app.node.tryGetContext(contextKey) as string | undefined) ?? process.env[envKey];
  if (!value) {
    throw new Error(
      `Missing required deployment config "${envKey}" — set it in the repo-root .env.deploy ` +
        `(template: .env.deploy.example) or pass -c ${contextKey}=<value>. See doc/dev/deploy.md.`,
    );
  }
  return value;
}

/**
 * Exported so the ledger test synthesizes the exact stacks the CLI deploys;
 * `context` lets it pass `aws:cdk:bundling-stacks: []` to skip esbuild.
 */
export function createApp(context?: Record<string, unknown>): App {
  const app = new App({ context });
  const stage = (app.node.tryGetContext('stage') as string | undefined) ?? 'prod';
  const account = process.env.CDK_DEFAULT_ACCOUNT;

  // Wrong-profile guard: fail before CFN builds a parallel copy of the backend
  // in a foreign account. Both sides are optional (CI and the ledger test set
  // neither).
  const pinnedAccount = process.env.AWS_ACCOUNT_ID;
  if (pinnedAccount && account && pinnedAccount !== account) {
    throw new Error(
      `AWS account mismatch: the active credentials resolve to ${account}, but AWS_ACCOUNT_ID ` +
        `pins ${pinnedAccount}. Check AWS_PROFILE / .env.deploy — see doc/dev/deploy.md.`,
    );
  }

  // COGNITO_DOMAIN is absent: only the web build consumes it.
  const cognito: CognitoConfig = {
    userPoolId: requireDeployConfig(app, 'cognitoUserPoolId', 'COGNITO_USER_POOL_ID'),
    clientId: requireDeployConfig(app, 'cognitoClientId', 'COGNITO_CLIENT_ID'),
    timerGroup: requireDeployConfig(app, 'cognitoTimerGroup', 'COGNITO_TIMER_GROUP'),
    region: requireDeployConfig(app, 'cognitoRegion', 'COGNITO_REGION'),
  };

  new SlacklineTimerV1Stack(app, 'slackline-timer-v1', {
    stage,
    cognito,
    // One alert address for both topics: the ops alarms here (eu-central-2) and
    // the billing alarm in us-east-1, which reads the same key itself.
    alertEmail: requireDeployConfig(app, 'billingAlertEmail', 'BILLING_ALERT_EMAIL'),
    env: { region: 'eu-central-2', account },
    description: `slackline-timer-v1 backend (${stage}) — WS relay + competition data plane + photo CDN`,
  });

  new SlacklineTimerV1WebStack(app, 'slackline-timer-v1-web', {
    stage,
    env: { region: 'eu-central-1', account },
    description: `slackline-timer-v1 web frontend (${stage}) — S3 + CloudFront`,
  });

  // Cost backstop (ADR 0031 §1). us-east-1: the only region publishing
  // EstimatedCharges, so the alarm + its topic live there; Budgets is global.
  new BillingStack(app, 'slackline-timer-v1-billing', {
    stage,
    env: { region: 'us-east-1', account },
    description: `slackline-timer-v1 cost backstop (${stage}) — Budget + EstimatedCharges alarm`,
  });

  return app;
}

// Main-module guard: importing this file (the ledger test) must not build a
// second app and bundle the Lambdas.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp();
}
