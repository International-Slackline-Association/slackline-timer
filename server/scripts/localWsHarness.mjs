// Local WebSocket harness — an in-process stand-in for the deployed API Gateway
// WebSocket relay. There is no local WebSocket emulator we rely on (LocalStack
// WS + postToConnection needs the Pro license, ADR 0023, phase 2), so this
// ~purpose-built server runs the REAL relay handlers (authorizer /
// connectionHandler / messageHandler) against LocalStack DynamoDB, with no drift
// from prod. It replicates:
//
//   - $connect    — query-param auth via the authorizer Lambda, then
//                   connectionHandler writes the connection row.
//   - $disconnect — connectionHandler reaps the connection's rows on socket close.
//   - $default    — every inbound frame goes to messageHandler (the fan-out).
//   - the :3001 management API — `POST /@connections/{id}` (and DELETE), the
//     endpoint core/broadcast.ts posts to for the relay + db_update push;
//     a gone connection answers 410 so the handler prunes it (matching real
//     ApiGatewayManagementApi semantics).
//
// The three handlers are TypeScript with path-alias imports, so they are
// bundled once with esbuild at startup and dynamic-imported — the same bundler
// CDK's NodejsFunction uses, so what runs here is what ships.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';
import { WebSocketServer } from 'ws';

import { handleHealthRequest, WS_HARNESS_ID } from './lib/harnessHealth.mjs';
import { applyOfflineEnv } from './offlineEnv.mjs';

// Self-sufficient like the sibling localHttpHarness.mjs: the bundled authorizer
// reads the Cognito env at require time, so a bare `node scripts/localWsHarness.mjs`
// (or a test spawn) must not depend on the caller pre-injecting OFFLINE_ENV.
// applyOfflineEnv's `??=` keeps an already-set value (devApi.mjs, tooling) winning.
applyOfflineEnv();

const WS_PORT = Number(process.env.WS_PORT ?? 3001);
const require = createRequire(import.meta.url);

/** Bundle a handler entry to a temp CJS file and load its `main` export.
 *  CJS (not ESM) output is required: the AWS SDK's bundled deps use dynamic
 *  require(), which esbuild's ESM output cannot satisfy. */
const loadHandler = async (entry, name) => {
  const outfile = join(tmpdir(), `slackline-ws-${name}-${process.pid}.cjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: false,
    external: ['aws-sdk'],
    logLevel: 'error',
    // esbuild reads tsconfig.json for the `core/*` / `@functions/*` aliases.
    tsconfig: 'tsconfig.json',
  });
  delete require.cache[outfile];
  return require(outfile).main;
};

const requestContext = (connectionId, routeKey) => ({
  connectionId,
  routeKey,
  // The handlers don't use domainName/stage offline (they post to
  // WS_API_ENDPOINT), but populate them for shape parity.
  domainName: `127.0.0.1:${WS_PORT}`,
  stage: process.env.STAGE ?? 'prod',
});

const run = async () => {
  const authorize = await loadHandler('src/functions/authorizer/handler.ts', 'authorizer');
  const onConnection = await loadHandler(
    'src/functions/connectionHandler/handler.ts',
    'connection',
  );
  const onMessage = await loadHandler('src/functions/messageHandler/handler.ts', 'message');

  /** connectionId -> live socket. */
  const sockets = new Map();

  // Management API (:3001): the relay/db_update fan-out posts here.
  const server = createServer((req, res) => {
    // Harness-identifying readiness probe (lib/harnessHealth.mjs).
    if (handleHealthRequest(req, res, WS_HARNESS_ID)) return;

    const match = /^\/@connections\/(.+)$/.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const connectionId = decodeURIComponent(match[1]);
    const socket = sockets.get(connectionId);

    if (req.method === 'DELETE') {
      socket?.close();
      res.writeHead(socket ? 204 : 410).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    if (!socket) {
      // Stale connection: 410 → GoneException → broadcastToSession prunes the row.
      res.writeHead(410).end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      socket.send(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200).end();
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  // Authorize + register BEFORE completing the WS handshake, matching API
  // Gateway's ordering: the $connect authorizer and connectionHandler finish
  // before the client's socket ever reaches OPEN. Accepting first (the old
  // `wss.on('connection')` flow) let a message sent the instant the client
  // opened — the preview's `request_state` — race the membership row and the
  // message listener, silently dropping it (a race prod cannot have). A denied
  // $connect now also rejects the handshake outright (close-before-open),
  // which is what the web's auth-denied detection expects (useWebSocket.tsx).
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${WS_PORT}`);
    const queryStringParameters = Object.fromEntries(url.searchParams.entries());
    const connectionId = randomUUID();

    // $connect authorizer (query-param credential, ADR 0022).
    const methodArn = `arn:aws:execute-api:local:000000000000:local/${process.env.STAGE ?? 'prod'}/$connect`;
    const decision = await authorize({ queryStringParameters, methodArn }).catch(() => undefined);
    const allowed = decision?.policyDocument?.Statement?.[0]?.Effect === 'Allow';
    if (!allowed) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    await onConnection({
      requestContext: { ...requestContext(connectionId, '$connect'), authorizer: decision.context },
      queryStringParameters,
    });

    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(connectionId, ws);

      ws.on('message', async (data) => {
        await onMessage({
          requestContext: requestContext(connectionId, '$default'),
          queryStringParameters,
          body: data.toString('utf8'),
        });
      });

      ws.on('close', async () => {
        sockets.delete(connectionId);
        // Deliberately NO queryStringParameters: API Gateway attaches them to
        // $connect only, so a real $disconnect knows just its connectionId and the
        // handler must resolve the session from the reverse map item (core/db.ts).
        // Passing them faked a capability prod lacks — which is why the
        // never-reaped-connection bug could not be reproduced locally.
        await onConnection({
          requestContext: requestContext(connectionId, '$disconnect'),
        });
      });
    });
  });

  server.listen(WS_PORT, '0.0.0.0', () => {
    console.log(`🔌 local WS relay on ws://127.0.0.1:${WS_PORT} (management API on the same port)`);
  });
};

run().catch((err) => {
  console.error('❌ local WS harness failed:', err);
  process.exit(1);
});
