// Local HTTP data plane — an in-process stand-in for the deployed API Gateway
// HTTP API (CDK has no local Lambda/HTTP emulator; running the stack inside
// LocalStack needs the Pro license, ADR 0023, phase 2). It runs the REAL
// data-plane handlers (and the real httpAuthorizer) in-process on :3002 against
// LocalStack DynamoDB + S3, so there is no drift from prod beyond the
// event-construction here (the sibling of localWsHarness.mjs, which does the
// same for the WebSocket relay).
//
// The only prod behaviour it synthesizes is the APIGatewayProxyEventV2 shape;
// the authorizer context comes from running the REAL httpAuthorizer, so the
// reader plane is exercisable locally — read tokens stay read-only, revocation is
// honored, requireAdmin 403s, forAudience strips PII. The one deliberate
// divergence: a bare request with no Authorization header falls back to a
// hard-coded admin context so tooling (curl, integration probes) keeps working.
//
// Handlers are TypeScript with path-alias imports, so each is bundled once with
// esbuild at startup and dynamic-imported as CJS — see localWsHarness.mjs
// loadHandler for why CJS and not ESM.

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';

import { handleHealthRequest, HTTP_HARNESS_ID } from './lib/harnessHealth.mjs';
import { applyOfflineEnv } from './offlineEnv.mjs';

applyOfflineEnv();

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3002);
const require = createRequire(import.meta.url);

// Fallback for bare tooling requests that carry no Authorization header (curl,
// integration probes): run as an operator (admin, all comps). A request that
// *does* carry a credential is resolved by the real httpAuthorizer instead.
const ADMIN_AUTH = { role: 'admin', compId: '*' };

const loadHandler = async (entry, name) => {
  const outfile = join(tmpdir(), `slackline-http-${name}-${process.pid}.cjs`);
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
    tsconfig: 'tsconfig.json',
  });
  delete require.cache[outfile];
  return require(outfile).main;
};

// Route table — one entry per data-plane HTTP route, mirroring the CDK HTTP
// routes in infra/slackline-stack.ts. `path` is the API Gateway route template; the
// matcher derives params from `{name}` segments and the routeKey is
// `${method} ${path}` exactly as the handlers compare it. Literal-segment
// routes (…/matches/seed) are listed before their parameterised sibling
// (…/matches/{matchId}) and matched first, so the literal wins.
const ROUTES = [
  ['competitions', 'POST', '/competitions'],
  ['competitions', 'GET', '/competitions'],
  ['competitions', 'GET', '/competitions/{compId}'],
  ['competitions', 'PUT', '/competitions/{compId}'],
  ['competitions', 'POST', '/competitions/{compId}/revoke-read-tokens'],

  ['athletes', 'GET', '/competitions/{compId}/athletes'],
  ['athletes', 'POST', '/competitions/{compId}/athletes'],
  ['athletes', 'GET', '/competitions/{compId}/athletes/{athleteId}'],
  ['athletes', 'PUT', '/competitions/{compId}/athletes/{athleteId}'],
  ['athletes', 'DELETE', '/competitions/{compId}/athletes/{athleteId}'],

  ['times', 'GET', '/competitions/{compId}/times'],
  ['times', 'POST', '/competitions/{compId}/times'],
  ['times', 'PUT', '/competitions/{compId}/times/{timeId}'],
  ['times', 'DELETE', '/competitions/{compId}/times/{timeId}'],

  ['matches', 'GET', '/competitions/{compId}/matches'],
  ['matches', 'POST', '/competitions/{compId}/matches/seed'],
  ['matches', 'POST', '/competitions/{compId}/matches/advance'],
  ['matches', 'POST', '/competitions/{compId}/matches'],
  ['matches', 'PUT', '/competitions/{compId}/matches/{matchId}'],
  ['matches', 'DELETE', '/competitions/{compId}/matches/{matchId}'],

  ['scores', 'GET', '/competitions/{compId}/scores'],
  ['scores', 'POST', '/competitions/{compId}/scores'],
  ['scores', 'PUT', '/competitions/{compId}/scores/{scoreId}'],
  ['scores', 'DELETE', '/competitions/{compId}/scores/{scoreId}'],

  ['rankings', 'GET', '/competitions/{compId}/rankings/{round}'],

  ['photoUpload', 'POST', '/competitions/{compId}/photo-uploads'],
  ['createReadToken', 'POST', '/competitions/{compId}/read-tokens'],

  ['managers', 'GET', '/competitions/{compId}/managers'],
  ['managers', 'POST', '/competitions/{compId}/managers'],
  ['managers', 'DELETE', '/competitions/{compId}/managers/{sub}'],
];

const compileRoute = ([fn, method, path]) => ({
  fn,
  method,
  routeKey: `${method} ${path}`,
  segs: path.split('/').filter(Boolean),
});

/** Match method + path segments against a compiled route, returning its path params or null. */
const matchRoute = (route, method, segs) => {
  if (route.method !== method || route.segs.length !== segs.length) return null;
  const params = {};
  for (let i = 0; i < route.segs.length; i++) {
    const tpl = route.segs[i];
    if (tpl.startsWith('{') && tpl.endsWith('}')) {
      params[tpl.slice(1, -1)] = decodeURIComponent(segs[i]);
    } else if (tpl !== segs[i]) {
      return null;
    }
  }
  return params;
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () =>
      resolve(chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined),
    );
  });

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const run = async () => {
  const handlerNames = [...new Set(ROUTES.map(([fn]) => fn))];
  const [authorize, ...handlerMains] = await Promise.all([
    loadHandler('src/functions/httpAuthorizer/handler.ts', 'httpAuthorizer'),
    ...handlerNames.map((name) => loadHandler(`src/functions/${name}/handler.ts`, name)),
  ]);
  const handlers = Object.fromEntries(handlerNames.map((name, i) => [name, handlerMains[i]]));
  const routes = ROUTES.map(compileRoute);

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    // CORS preflight — the harness serves the browser dev server cross-origin.
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end();
      return;
    }
    res.setHeader('access-control-allow-origin', '*');

    // Harness-identifying readiness probe (lib/harnessHealth.mjs).
    if (handleHealthRequest(req, res, HTTP_HARNESS_ID)) return;

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${HTTP_PORT}`);
    const segs = url.pathname.split('/').filter(Boolean);

    let matched;
    let pathParameters;
    for (const route of routes) {
      const params = matchRoute(route, method, segs);
      if (params) {
        matched = route;
        pathParameters = params;
        break;
      }
    }
    if (!matched) {
      sendJson(res, 404, { message: `no route for ${method} ${url.pathname}` });
      return;
    }

    const body = await readBody(req);
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
    );

    let auth = ADMIN_AUTH;
    if (headers.authorization ?? headers.Authorization) {
      const decision = await authorize({ headers, routeArn: matched.routeKey });
      if (!decision?.isAuthorized) {
        sendJson(res, 403, { message: 'unauthorized' });
        return;
      }
      auth = decision.context;
    }

    const event = {
      version: '2.0',
      routeKey: matched.routeKey,
      rawPath: url.pathname,
      rawQueryString: url.search.replace(/^\?/, ''),
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      pathParameters,
      requestContext: {
        http: { method, path: url.pathname },
        authorizer: { lambda: auth },
      },
      body,
      isBase64Encoded: false,
    };

    try {
      const result = await handlers[matched.fn](event, {}, () => undefined);
      res.writeHead(result.statusCode ?? 200, {
        'content-type': 'application/json',
        ...result.headers,
        'access-control-allow-origin': '*',
      });
      res.end(result.body ?? '');
    } catch (err) {
      console.error(`handler ${matched.fn} threw for ${matched.routeKey}:`, err);
      sendJson(res, 500, { message: 'harness: handler threw', error: String(err) });
    }
  });

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🌐 local HTTP data plane on http://127.0.0.1:${HTTP_PORT} (SAM-free harness)`);
  });
};

run().catch((err) => {
  console.error('❌ local HTTP harness failed:', err);
  process.exit(1);
});
