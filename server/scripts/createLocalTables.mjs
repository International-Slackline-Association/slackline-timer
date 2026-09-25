// Create the two single-table DynamoDB tables in the LocalStack container
// (docker/docker-compose.yml). Idempotent: existing tables are left alone.
// Mirrors the CDK tables in infra/slackline-stack.ts (PK/SK, PAY_PER_REQUEST;
// the relay table's TTL is a no-op locally). See doc/dev/local-dev.md.

import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4566';

// Names must match what the handlers resolve COMPETITION_TABLE /
// SPEEDLINE_TIMER_TABLE to (the CDK TableName, stage = prod).
const TABLES = [
  process.env.COMPETITION_TABLE ?? 'slackline-timer-v1-competition-prod',
  process.env.SPEEDLINE_TIMER_TABLE ?? 'slackline-timer-v1-relay-prod',
];

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  // LocalStack partitions data by region, so this must match what the app uses
  // (offlineEnv sets AWS_REGION=eu-central-1); a bogus 'local' would hide the
  // tables from the running handlers.
  region: process.env.AWS_REGION ?? 'eu-central-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

const tableSpec = (tableName) => ({
  TableName: tableName,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'PK', AttributeType: 'S' },
    { AttributeName: 'SK', AttributeType: 'S' },
  ],
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the local DynamoDB answers (it can lag the container start). */
const waitForDynamo = async (attempts = 30) => {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (err) {
      if (i === attempts) throw err;
      if (i === 1) console.log(`⏳ Waiting for DynamoDB at ${ENDPOINT} …`);
      await sleep(1000);
    }
  }
};

export const ensureLocalTables = async () => {
  await waitForDynamo();
  const { TableNames = [] } = await client.send(new ListTablesCommand({}));
  for (const tableName of TABLES) {
    if (TableNames.includes(tableName)) {
      console.log(`✅ ${tableName} already exists`);
      continue;
    }
    await client.send(new CreateTableCommand(tableSpec(tableName)));
    console.log(`🆕 created ${tableName}`);
  }
};

// Run directly: `node scripts/createLocalTables.mjs`
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('createLocalTables.mjs')
) {
  ensureLocalTables()
    .then(() => console.log('✨ Local DynamoDB tables ready'))
    .catch((err) => {
      console.error('❌ Failed to create local tables:', err.message);
      console.error(`   Is the container up? Try: npm run db:up`);
      process.exit(1);
    });
}
