import { execFileSync } from 'node:child_process';

import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';

import { ddb } from 'core/aws/clients';
import type { AuthContext } from 'core/http';

/**
 * Shared plumbing for the *.int.test.ts suites — the only tests that talk to a
 * real (local) DynamoDB. env.setup.ts has already pointed `core/aws/clients` at
 * the container; here we add: a reachability probe so the suites self-skip when
 * the container is down (CI without Docker), idempotent table creation, fake
 * API-Gateway-v2 events for driving the Lambda handlers, and per-partition
 * cleanup so tests stay isolated on the shared local table.
 */

const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:4566';

export const COMPETITION_TABLE =
  process.env.COMPETITION_TABLE ?? 'slackline-timer-v1-competition-prod';
export const TIMER_TABLE = process.env.SPEEDLINE_TIMER_TABLE ?? 'slackline-timer-v1-relay-prod';

// Low-level client for control-plane ops (ListTables/CreateTable); the document
// client `ddb` from core handles the data-plane reads/writes under test.
const control = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: process.env.AWS_REGION ?? 'local',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  maxAttempts: 1, // fail fast when the container is down — no retry/backoff storm
});

/**
 * Is the local DynamoDB answering?
 *
 * Resolved **synchronously** (a short-lived child does the request) so the
 * suites can `describe.skipIf(!isDynamoReachable())` at collection time without
 * a top-level await — important because CI runs the server tests with no Docker
 * (`npm run test:coverage`), and those suites must self-skip, not fail. The
 * result is cached on the env for the worker's remaining files.
 *
 * The probe issues a real **ListTables** rather than a bare TCP connect, because
 * LocalStack loads DynamoDB *lazily*: a freshly recreated container answers the
 * edge port (and reports the service `available`) while the first actual request
 * blocks ~1.8 s spinning the service up. A TCP connect passed instantly, so that
 * cold start was charged to whichever integration test ran first, and it blew
 * vitest's default 5 s timeout — a red suite on a fresh container, and only
 * there. Warming it here puts the cost at collection time, where no timeout
 * applies. `npm run db:init` warms it incidentally, which is why local runs that
 * follow the documented flow never saw this.
 *
 * Still fails fast when the container is genuinely down: a closed port refuses
 * the connection immediately, exactly as the TCP probe did.
 */
export const isDynamoReachable = (): boolean => {
  if (process.env.__DYNAMO_REACHABLE !== undefined) {
    return process.env.__DYNAMO_REACHABLE === 'true';
  }
  const url = new URL(ENDPOINT);
  // Raw http: the SDK is ESM-only from this sync child's perspective, and a
  // hand-rolled ListTables needs no credentials against LocalStack.
  const probe = `
const req = require('http').request(
  { host: ${JSON.stringify(url.hostname)}, port: ${Number(url.port) || 4566}, method: 'POST', path: '/',
    headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': 'DynamoDB_20120810.ListTables',
               Authorization: 'AWS4-HMAC-SHA256 Credential=local/20200101/${
                 process.env.AWS_REGION ?? 'local'
               }/dynamodb/aws4_request' } },
  (res) => { res.resume(); res.on('end', () => process.exit(res.statusCode === 200 ? 0 : 1)); },
);
req.setTimeout(20000, () => process.exit(1));
req.on('error', () => process.exit(1));
req.end('{}');`;
  let ok: boolean;
  try {
    execFileSync(process.execPath, ['-e', probe], { stdio: 'ignore' });
    ok = true;
  } catch {
    ok = false;
  }
  process.env.__DYNAMO_REACHABLE = ok ? 'true' : 'false';
  return ok;
};

const tableSpec = (tableName: string) => ({
  TableName: tableName,
  BillingMode: 'PAY_PER_REQUEST' as const,
  AttributeDefinitions: [
    { AttributeName: 'PK', AttributeType: 'S' as const },
    { AttributeName: 'SK', AttributeType: 'S' as const },
  ],
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' as const },
    { AttributeName: 'SK', KeyType: 'RANGE' as const },
  ],
});

/** Idempotently create both single-tables; mirrors scripts/createLocalTables.mjs. */
export const ensureTables = async (): Promise<void> => {
  const { TableNames = [] } = await control.send(new ListTablesCommand({}));
  for (const tableName of [COMPETITION_TABLE, TIMER_TABLE]) {
    if (TableNames.includes(tableName)) continue;
    try {
      await control.send(new CreateTableCommand(tableSpec(tableName)));
    } catch (e) {
      // A parallel test worker may have won the race — that's fine.
      if (!(e instanceof ResourceInUseException)) throw e;
    }
  }
};

/** Delete every item under a partition key, so a test's compId/session is clean. */
export const clearPartition = async (table: string, pk: string): Promise<void> => {
  const page = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk },
    }),
  );
  await Promise.all(
    (page.Items ?? []).map((item) =>
      ddb.send(new DeleteCommand({ TableName: table, Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
};

// --- Fake API Gateway v2 events ---------------------------------------------

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthContext>;
type HandlerEvent = Parameters<Handler>[0];

export interface EventOpts {
  routeKey: string;
  /** Defaults to admin (compId '*'); pass 'reader' to test scoped read tokens. */
  role?: 'admin' | 'reader';
  /** The reader's scoped competition; defaults to pathParameters.compId. */
  authCompId?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  /** JSON body; stringified for you. Omit for GET/DELETE. */
  body?: unknown;
}

/** Build the minimal slice of an APIGW-v2 + Lambda-authorizer event the handlers read. */
export const apiEvent = (opts: EventOpts): HandlerEvent => {
  const role = opts.role ?? 'admin';
  const compId = opts.authCompId ?? (role === 'admin' ? '*' : (opts.pathParameters?.compId ?? '*'));
  return {
    routeKey: opts.routeKey,
    requestContext: { authorizer: { lambda: { role, compId } } },
    pathParameters: opts.pathParameters,
    queryStringParameters: opts.queryStringParameters,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  } as unknown as HandlerEvent;
};

export interface HandlerResult<T = unknown> {
  statusCode: number;
  body: T;
}

/** Invoke a handler with a fake event and return its parsed JSON response. */
export const callHandler = async <T = unknown>(
  handler: Handler,
  opts: EventOpts,
): Promise<HandlerResult<T>> => {
  const result = await handler(apiEvent(opts), {} as Context, () => undefined);
  const structured = result as APIGatewayProxyStructuredResultV2;
  return {
    statusCode: structured.statusCode ?? 200,
    body: (structured.body ? JSON.parse(structured.body) : undefined) as T,
  };
};
