/**
 * Vitest setupFile for the integration suite. It runs **before** any test
 * module (and therefore before `core/aws/clients.ts` reads these at import
 * time), pointing the DynamoDB document client at the LocalStack container from
 * docker/docker-compose.yml. See doc/dev/local-dev.md.
 *
 * The table names match what the handlers resolve COMPETITION_TABLE /
 * SPEEDLINE_TIMER_TABLE to (the CDK TableName, stage = prod) and what
 * scripts/createLocalTables.mjs creates.
 *
 * Pure unit tests never touch the client, so setting these globally is inert
 * for them; only the *.int.test.ts files actually open connections, and those
 * skip themselves when the container is down (see helpers.ts).
 */

// A developer/CI-exported value (e.g. a non-default DYNAMODB_ENDPOINT) wins.
process.env.DYNAMODB_ENDPOINT ??= 'http://localhost:4566';
process.env.AWS_REGION ??= 'local';
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
process.env.COMPETITION_TABLE ??= 'slackline-timer-v1-competition-prod';
process.env.SPEEDLINE_TIMER_TABLE ??= 'slackline-timer-v1-relay-prod';
