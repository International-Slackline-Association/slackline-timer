import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from './aws/clients';

// Frozen name: this env key is bound to the deployed Lambdas, so changing it is
// an atomic code-plus-deploy, never a string edit (AGENTS.md, "Names that must
// not be renamed").
const SPEEDLINE_TIMER_TABLE = process.env.SPEEDLINE_TIMER_TABLE!;

// Connection-row TTL — a backstop cleanup for rows whose $disconnect was missed
// (an active room also prunes them on the next broadcast's 410). Kept short to
// bound the fan-out cost of accumulated dead connections. It can be this short
// because the keepalive ping heartbeats it (refreshConnectionTtl): the TTL only
// has to outlast the gap between pings, not the 2h max connection life. Clients
// ping every 8 min and API Gateway drops any socket idle >10 min, so a live
// socket refreshes this within every 10-min window — 20 min is 2× that worst
// case, surviving a dropped ping.
export const CONNECTION_TTL_SECONDS = 20 * 60;

const ttlFromNow = () => Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;

/**
 * Reverse map item, connection → session: `PK=CONN#<connectionId>`, `SK=MAP`.
 *
 * API Gateway attaches `queryStringParameters` to `$connect` **only**, so a
 * `$disconnect` event carries nothing but the connectionId — while the forward
 * row is keyed `PK=sessionId`. With no GSI on connectionId this item is the only
 * thing that makes that delete addressable; without it a disconnect cannot be
 * honoured at all and a room drains by TTL alone (the HWC 2026 fan-out timeout).
 *
 * `CONN#…` cannot collide with a session partition: a sessionId is a compId, the
 * `$connect` authorizer admits only sessions that exist as competitions, and a
 * compId is validated `[A-Za-z0-9_-]{1,64}` — no `#` (core/validators.ts). So the
 * fan-out, which queries `PK = <sessionId>`, never sees these items.
 */
const connectionMapPk = (connectionId: string): string => `CONN#${connectionId}`;
const CONNECTION_MAP_SK = 'MAP';

/**
 * Both rows in one transaction: a partial write would leave a forward row the
 * fan-out posts to for a socket API Gateway then refused (a non-2xx `$connect`
 * denies the connection). They share one TTL, so a missed `$disconnect` cannot
 * leak either.
 */
const addConnection = async (params: {
  sessionId: string;
  connectionId: string;
  /** Overlay (read-token) connections may listen but never inject messages. */
  readOnly?: boolean;
}) => {
  const ddb_ttl = ttlFromNow();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: SPEEDLINE_TIMER_TABLE,
            Item: {
              PK: params.sessionId,
              SK: params.connectionId,
              ddb_ttl,
              ...(params.readOnly ? { readOnly: true } : {}),
            },
          },
        },
        {
          Put: {
            TableName: SPEEDLINE_TIMER_TABLE,
            Item: {
              PK: connectionMapPk(params.connectionId),
              SK: CONNECTION_MAP_SK,
              sessionId: params.sessionId,
              ddb_ttl,
            },
          },
        },
      ],
    }),
  );
};

/**
 * Resolve a connection's session from the reverse map. Null when the item is gone
 * (a socket predating this mapping, or already expired/pruned) — the caller then
 * has no key to delete by and leaves the forward row to its TTL.
 */
const getConnectionSession = async (connectionId: string): Promise<string | null> => {
  const result = await ddb.send(
    new GetCommand({
      TableName: SPEEDLINE_TIMER_TABLE,
      Key: { PK: connectionMapPk(connectionId), SK: CONNECTION_MAP_SK },
    }),
  );
  const sessionId = result.Item?.sessionId;
  return typeof sessionId === 'string' ? sessionId : null;
};

/**
 * Heartbeat a live connection's TTL from the keepalive ping — forward row and map
 * item together, so the map can't expire out from under a socket that is still
 * open. Both updates are guarded by attribute_exists(PK) so neither is ever
 * recreated: a ping arriving after the rows TTL-expired or were 410-pruned must
 * NOT resurrect them — a revived forward row is a phantom in every fan-out and
 * would lose its `readOnly` flag (letting an overlay inject), and a revived map
 * item would carry no sessionId at all. The condition failing is expected in that
 * race, so callers swallow the ConditionalCheckFailedException.
 */
const refreshConnectionTtl = async (params: { sessionId: string; connectionId: string }) => {
  const ddb_ttl = ttlFromNow();
  // Independent, not transactional: the map item may legitimately be absent (a
  // socket predating it), and only the forward row's outcome may propagate —
  // losing its heartbeat would evict a live socket 20 min later.
  const [forward] = await Promise.allSettled([
    ddb.send(
      new UpdateCommand({
        TableName: SPEEDLINE_TIMER_TABLE,
        Key: { PK: params.sessionId, SK: params.connectionId },
        UpdateExpression: 'SET ddb_ttl = :ttl',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':ttl': ddb_ttl },
      }),
    ),
    ddb.send(
      new UpdateCommand({
        TableName: SPEEDLINE_TIMER_TABLE,
        Key: { PK: connectionMapPk(params.connectionId), SK: CONNECTION_MAP_SK },
        UpdateExpression: 'SET ddb_ttl = :ttl',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':ttl': ddb_ttl },
      }),
    ),
  ]);
  if (forward.status === 'rejected') throw forward.reason;
};

const getConnection = async (params: { sessionId: string; connectionId: string }) => {
  const result = await ddb.send(
    new GetCommand({
      TableName: SPEEDLINE_TIMER_TABLE,
      Key: {
        PK: params.sessionId,
        SK: params.connectionId,
      },
    }),
  );
  if (!result.Item) return null;
  return {
    sessionId: result.Item.PK as string,
    connectionId: result.Item.SK as string,
    readOnly: result.Item.readOnly === true,
  };
};

/**
 * Drop a connection's forward row **and** its map item. Every deletion path
 * funnels through here ($disconnect, the broadcast 410 prune, reader revocation),
 * so no caller can leave half the pair behind.
 *
 * Two independent deletes, unlike the transactional manager-grant pair
 * (core/competitionDb.ts): each Delete is idempotent and neither row is useful alone,
 * while a transaction would raise TransactionConflictException when two
 * concurrent fan-outs prune the same 410'd connection — turning a benign
 * double-prune into a logged delivery failure.
 */
const removeConnection = async (params: { sessionId: string; connectionId: string }) => {
  await Promise.all([
    ddb.send(
      new DeleteCommand({
        TableName: SPEEDLINE_TIMER_TABLE,
        Key: {
          PK: params.sessionId,
          SK: params.connectionId,
        },
      }),
    ),
    ddb.send(
      new DeleteCommand({
        TableName: SPEEDLINE_TIMER_TABLE,
        Key: { PK: connectionMapPk(params.connectionId), SK: CONNECTION_MAP_SK },
      }),
    ),
  ]);
};

const getAllConnections = async (sessionId: string) => {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: SPEEDLINE_TIMER_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': sessionId,
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...(page.Items ?? []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items.map((item) => ({
    sessionId: item.PK as string,
    connectionId: item.SK as string,
    readOnly: item.readOnly === true,
  }));
};

export const db = {
  addConnection,
  getConnection,
  getConnectionSession,
  removeConnection,
  getAllConnections,
  refreshConnectionTtl,
};
