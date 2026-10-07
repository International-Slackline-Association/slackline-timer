// Local HTTP data plane — an in-process stand-in for the API Gateway HTTP API
// (running the stack in LocalStack needs the Pro license, ADR 0023 phase 2).
// Runs the REAL data-plane handlers on :3002 against LocalStack DynamoDB + S3.
//
// Only the APIGatewayProxyEventV2 shape is synthesized; the authorizer context
// comes from the REAL httpAuthorizer, so read tokens stay read-only, revocation
// is honored, requireAdmin 403s, forAudience strips PII. A request without an
// Authorization header is a 401, as in prod; tooling sends the `local-dev` dummy.
// Bind address, Host and Origin checks: lib/harnessGuard.mjs.
//
// Handlers are TypeScript with path-alias imports, so each is bundled once with
// esbuild at startup and dynamic-imported as CJS — see localWsHarness.mjs
// loadHandler for why CJS and not ESM.

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';

import { harnessGuard } from './lib/harnessGuard.mjs';
import { handleHealthRequest, HTTP_HARNESS_ID } from './lib/harnessHealth.mjs';
import { applyOfflineEnv } from './offlineEnv.mjs';

applyOfflineEnv();

const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3002);
const guard = harnessGuard(HTTP_PORT);
const require = createRequire(import.meta.url);

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

/** Match method + decoded path segments against a compiled route, returning its path params or null. */
const matchRoute = (route, method, segs) => {
  if (route.method !== method || route.segs.length !== segs.length) return null;
  const params = {};
  for (let i = 0; i < route.segs.length; i++) {
    const tpl = route.segs[i];
    if (tpl.startsWith('{') && tpl.endsWith('}')) {
      params[tpl.slice(1, -1)] = segs[i];
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

/** Split the path into segments, decoding each; null on a malformed `%` escape. */
const decodeSegments = (pathname) => {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
};

const run = async () => {
  const handlerNames = [...new Set(ROUTES.map(([fn]) => fn))];
  const [authorize, ...handlerMains] = await Promise.all([
    loadHandler('src/functions/httpAuthorizer/handler.ts', 'httpAuthorizer'),
    ...handlerNames.map((name) => loadHandler(`src/functions/${name}/handler.ts`, name)),
  ]);
  const handlers = Object.fromEntries(handlerNames.map((name, i) => [name, handlerMains[i]]));
  const routes = ROUTES.map(compileRoute);

  const serve = async (req, res) => {
    if (!guard.isAllowedHost(req.headers.host)) {
      sendJson(res, 421, { message: 'unexpected Host header' });
      return;
    }
    const { origin } = req.headers;
    if (origin !== undefined && !guard.isAllowedOrigin(origin)) {
      sendJson(res, 403, { message: 'origin not allowed' });
      return;
    }
    if (origin !== undefined) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }

    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    if (handleHealthRequest(req, res, HTTP_HARNESS_ID)) return;

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${HTTP_PORT}`);
    const segs = decodeSegments(url.pathname);
    if (!segs) {
      sendJson(res, 400, { message: 'malformed path encoding' });
      return;
    }

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

    if (!headers.authorization) {
      sendJson(res, 401, { message: 'Unauthorized' });
      return;
    }
    const decision = await authorize({ headers, routeArn: matched.routeKey });
    if (!decision?.isAuthorized) {
      sendJson(res, 403, { message: 'Forbidden' });
      return;
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
        authorizer: { lambda: decision.context },
      },
      body,
      isBase64Encoded: false,
    };

    const result = await handlers[matched.fn](event, {}, () => undefined);
    res.writeHead(result.statusCode ?? 200, {
      'content-type': 'application/json',
      ...result.headers,
    });
    res.end(result.body ?? '');
  };

  const server = createServer((req, res) => {
    serve(req, res).catch((err) => {
      console.error(`harness: ${req.method} ${req.url} failed:`, err);
      if (res.headersSent) res.end();
      else sendJson(res, 500, { message: 'harness: request failed', error: String(err) });
    });
  });

  server.listen(HTTP_PORT, guard.bindHost, () => {
    console.log(
      `🌐 local HTTP data plane on http://${guard.bindHost}:${HTTP_PORT} (SAM-free harness)`,
    );
  });
};

run().catch((err) => {
  console.error('❌ local HTTP harness failed:', err);
  process.exit(1);
});
