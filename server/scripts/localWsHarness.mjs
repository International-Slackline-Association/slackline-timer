// Local WebSocket harness — an in-process stand-in for the API Gateway WebSocket
// relay (LocalStack WS + postToConnection needs the Pro license, ADR 0023 phase
// 2). Runs the REAL authorizer / connectionHandler / messageHandler against
// LocalStack DynamoDB. It replicates:
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
// The handlers are bundled once at startup with esbuild, the bundler CDK's
// NodejsFunction uses.
//
// Bind address, Host and Origin checks: lib/harnessGuard.mjs. The Origin check
// is what stops any website from opening ws://127.0.0.1:3001?Authorization=local-dev
// as an operator; Node clients (tests, the SDK's management-API posts) send no
// Origin and pass.

import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer, STATUS_CODES } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';
import { WebSocketServer } from 'ws';

import { harnessGuard } from './lib/harnessGuard.mjs';
import { handleHealthRequest, WS_HARNESS_ID } from './lib/harnessHealth.mjs';
import { applyOfflineEnv } from './offlineEnv.mjs';

// Self-sufficient like the sibling localHttpHarness.mjs: the bundled authorizer
// reads the Cognito env at require time, so a bare `node scripts/localWsHarness.mjs`
// (or a test spawn) must not depend on the caller pre-injecting OFFLINE_ENV.
// applyOfflineEnv's `??=` keeps an already-set value (devApi.mjs, tooling) winning.
applyOfflineEnv();

const WS_PORT = Number(process.env.WS_PORT ?? 3001);
const guard = harnessGuard(WS_PORT);
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

/** Host + Origin gate shared by the management API and the upgrade path. */
const rejectionStatus = (req) => {
  if (!guard.isAllowedHost(req.headers.host)) return 421;
  const { origin } = req.headers;
  if (origin !== undefined && !guard.isAllowedOrigin(origin)) return 403;
  return null;
};

const refuseUpgrade = (socket, status) => {
  socket.write(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
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
    const rejected = rejectionStatus(req);
    if (rejected) {
      res.writeHead(rejected).end();
      return;
    }

    if (handleHealthRequest(req, res, WS_HARNESS_ID)) return;

    const match = /^\/@connections\/(.+)$/.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    let connectionId;
    try {
      connectionId = decodeURIComponent(match[1]);
    } catch {
      res.writeHead(400).end();
      return;
    }
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

  // Authorize + register BEFORE completing the handshake, as API Gateway does:
  // accepting first lets a frame sent on open (`request_state`) race the
  // membership row and get dropped, a race prod cannot have. A denied $connect
  // or a non-200 from connectionHandler rejects the handshake (close-before-open),
  // which the web's auth-denied detection expects (useWebSocket.tsx).
  const upgrade = async (req, socket, head) => {
    const rejected = rejectionStatus(req);
    if (rejected) {
      refuseUpgrade(socket, rejected);
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${WS_PORT}`);
    const queryStringParameters = Object.fromEntries(url.searchParams.entries());
    const connectionId = randomUUID();

    // $connect authorizer (query-param credential, ADR 0022).
    const methodArn = `arn:aws:execute-api:local:000000000000:local/${process.env.STAGE ?? 'prod'}/$connect`;
    const decision = await authorize({ queryStringParameters, methodArn }).catch(() => undefined);
    const allowed = decision?.policyDocument?.Statement?.[0]?.Effect === 'Allow';
    if (!allowed) {
      refuseUpgrade(socket, 401);
      return;
    }

    const connected = await onConnection({
      requestContext: { ...requestContext(connectionId, '$connect'), authorizer: decision.context },
      queryStringParameters,
    });
    if (connected?.statusCode !== 200) {
      refuseUpgrade(socket, connected?.statusCode ?? 500);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(connectionId, ws);

      ws.on('message', (data) => {
        onMessage({
          requestContext: requestContext(connectionId, '$default'),
          queryStringParameters,
          body: data.toString('utf8'),
        }).catch((err) => console.error(`harness: $default for ${connectionId} threw:`, err));
      });

      ws.on('close', () => {
        sockets.delete(connectionId);
        // No queryStringParameters: API Gateway attaches them to $connect only,
        // so a real $disconnect knows just its connectionId and the handler must
        // resolve the session from the reverse map item (core/db.ts). Passing
        // them here would hide a never-reaped-connection bug locally.
        onConnection({
          requestContext: requestContext(connectionId, '$disconnect'),
        }).catch((err) => console.error(`harness: $disconnect for ${connectionId} threw:`, err));
      });
    });
  };

  server.on('upgrade', (req, socket, head) => {
    upgrade(req, socket, head).catch((err) => {
      console.error('harness: $connect threw:', err);
      if (!socket.destroyed) refuseUpgrade(socket, 500);
    });
  });

  server.listen(WS_PORT, guard.bindHost, () => {
    console.log(
      `🔌 local WS relay on ws://${guard.bindHost}:${WS_PORT} (management API on the same port)`,
    );
  });
};

run().catch((err) => {
  console.error('❌ local WS harness failed:', err);
  process.exit(1);
});
