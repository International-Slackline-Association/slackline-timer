// Table-existence preflight for the local seed writers (seedLocal.mjs and the
// self-seeding e2e tooling). A LocalStack container that was recreated without
// `npm run db:init` comes up with NO tables, so every seed write 500s while the
// harness itself answers /health fine — the generic "is the backend up?" hint
// then misleads (the backend IS up). DescribeTable each expected table and point
// the failure straight at `npm run db:init` when one is missing.

import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Must mirror createLocalTables.mjs / offlineEnv.mjs (the CDK TableName, stage
// = prod) — those are what the running handlers read from.
export const LOCAL_TABLES = [
  process.env.COMPETITION_TABLE ?? 'slackline-timer-v1-competition-prod',
  process.env.SPEEDLINE_TIMER_TABLE ?? 'slackline-timer-v1-relay-prod',
];

/**
 * Whether an API base URL targets the local harness — the only case where the
 * LocalStack table check applies (seeders can also point at a deployed stage).
 */
export const isLocalApi = (api) => {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(api).hostname);
  } catch {
    return false;
  }
};

/**
 * Names of the expected tables the local DynamoDB does NOT have. Throws when
 * the container itself is unreachable (a different failure — `npm run db:up`).
 */
export const missingLocalTables = async ({
  endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:4566',
  tables = LOCAL_TABLES,
} = {}) => {
  const client = new DynamoDBClient({
    endpoint,
    // LocalStack partitions data by region, so this must match what the app
    // uses (offlineEnv sets AWS_REGION=eu-central-1) — a mismatched region
    // would read real tables as missing (the createLocalTables.mjs gotcha).
    region: process.env.AWS_REGION ?? 'eu-central-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    maxAttempts: 1, // fail fast when the container is down — no retry storm
  });
  const missing = [];
  for (const tableName of tables) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err) {
      if (err?.name !== 'ResourceNotFoundException') throw err;
      missing.push(tableName);
    }
  }
  return missing;
};

/**
 * The seed-failure diagnosis: when `api` is the local harness and a table is
 * missing, return a message naming it and pointing at `npm run db:init`; null
 * otherwise (remote target, all tables present, or DynamoDB unreachable —
 * those cases keep the caller's own "is the backend up?" message).
 */
export const seedTableHint = async ({ api, endpoint, tables } = {}) => {
  if (!isLocalApi(api)) return null;
  let missing;
  try {
    missing = await missingLocalTables({ endpoint, tables });
  } catch {
    return null;
  }
  if (missing.length === 0) return null;
  return (
    `DynamoDB table(s) missing in the LocalStack container: ${missing.join(', ')}.\n` +
    'A recreated container comes up empty — run `npm run db:init`, then re-run the seed.'
  );
};
