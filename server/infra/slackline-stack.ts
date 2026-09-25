import * as path from 'node:path';

import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpStage,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
  WebSocketLambdaAuthorizer,
} from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {
  HttpLambdaIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  Distribution,
  KeyGroup,
  PriceClass,
  PublicKey,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

import { defineWafToggle, makeRateBasedWebAcl } from './waf';

// SSM parameter names; all three must exist before the first deploy. The two
// secrets are SecureString and reach the Lambdas as *names* only, fetched +
// decrypted at runtime (core/secrets.ts, ADR 0025) — CFN rejects ssm-secure in
// env blocks and plaintext env vars leak via GetFunctionConfiguration. The
// public key is not a secret and resolves at deploy into the CloudFront key.
const READ_TOKEN_SECRET_PARAM = '/slackline-timer-v1/read-token-secret';
const PHOTO_PUBLIC_KEY_PARAM = '/slackline-timer-v1/photo-public-key';
const PHOTO_PRIVATE_KEY_PARAM = '/slackline-timer-v1/photo-private-key';

// Cognito (ISA shared user pool). Pool/client IDs are not secrets. These do NOT
// vary with `stage` — a non-prod stage (e.g. a `cdk watch` dev stack) gets its
// own tables/APIs/buckets but still authenticates against prod Cognito.
// Introduce a per-stage config map here if that ever changes.
const COGNITO = {
  COGNITO_USER_POOL_ID: 'eu-central-1_iGaYGKeyJ',
  COGNITO_CLIENT_ID: 'ds5av12gno4uf6vktmml11pll',
  COGNITO_TIMER_GROUP: 'timeradmin',
  // The pool's home region (the backend may run in another). The managers
  // Lambda pins its Cognito client to this to resolve email→sub.
  COGNITO_REGION: 'eu-central-1',
};

// ARN of the shared ISA pool, for the managers Lambda's ListUsers grant. Pool
// ids are account-scoped (see server/scripts/cognito/cognitoCommon.mjs), and the
// owning account is deliberately not committed — it is taken from the account
// being deployed to, which is the same one by construction: the in-stack grant
// is sound only when the backend deploys INTO the pool's account (ADR 0045). A
// pool in a foreign account needs an assumed cross-account role, not a
// different literal here.
const cognitoPoolArn = (scope: Construct): string =>
  `arn:aws:cognito-idp:${COGNITO.COGNITO_REGION}:${Stack.of(scope).account}:userpool/${COGNITO.COGNITO_USER_POOL_ID}`;

export interface SlacklineTimerV1StackProps extends StackProps {
  stage: string;
}

/**
 * The whole backend as one stack (ADR 0023); the deployed topology is diagrammed
 * in doc/dev/architecture.md ("The two planes"). The constructor is a table of
 * contents — each define* function below owns one section and declares what it
 * needs from the others via parameters, which is why this is one stack rather
 * than per-domain constructs: every function needs the WS stage callback URL,
 * and several need the photo resources, so the cross-wiring is the design.
 */
export class SlacklineTimerV1Stack extends Stack {
  constructor(scope: Construct, id: string, props: SlacklineTimerV1StackProps) {
    super(scope, id, props);
    const { stage } = props;

    const tables = defineTables(this, stage);
    const photoCdn = definePhotoCdn(this, stage);
    const fns = defineFunctions(this, stage, tables, photoCdn);
    const wsStage = defineWsRelay(this, stage, fns);
    const { httpApi, httpStage } = defineHttpApi(this, stage, fns);
    defineWaf(this, stage, wsStage, httpStage);

    new CfnOutput(this, 'HttpApiUrl', {
      description: 'Competition data-plane HTTP API base URL.',
      value: `https://${httpApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage}`,
    });
    new CfnOutput(this, 'WebsocketUrl', {
      description: 'WebSocket relay URL (wss).',
      value: wsStage.url,
    });
    new CfnOutput(this, 'PhotoCdnDomain', {
      description: 'CloudFront domain serving signed photo URLs.',
      value: photoCdn.distribution.distributionDomainName,
    });
  }
}

// ── DynamoDB ──────────────────────────────────────────────────────────────────
// Relay table: connection rows, TTL-expired. Competition single-table:
// athletes/times/matches/scores/meta (SK layout in src/core/keys.ts). Both stay
// on-demand (ADR 0031 §4) and RETAIN + deletion-protected, so `cdk destroy`
// leaves them as unmanaged orphans — see server/scripts/decommission/stacks.json.

interface Tables {
  relay: Table;
  competition: Table;
}

function defineTables(stack: Stack, stage: string): Tables {
  // Logical id kept as `SpeedlineTimerTable` (and the `SPEEDLINE_TIMER_TABLE` env
  // key) despite the slackline-timer-v1 rename: renaming a logical id replaces the
  // resource, and this table is RETAIN — a rename would orphan the live relay data
  // for a cosmetic change. Physical/console name is already slackline-timer-v1-*.
  const relay = new Table(stack, 'SpeedlineTimerTable', {
    tableName: `slackline-timer-v1-relay-${stage}`,
    partitionKey: { name: 'PK', type: AttributeType.STRING },
    sortKey: { name: 'SK', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    timeToLiveAttribute: 'ddb_ttl',
    deletionProtection: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const competition = new Table(stack, 'CompetitionTable', {
    tableName: `slackline-timer-v1-competition-${stage}`,
    partitionKey: { name: 'PK', type: AttributeType.STRING },
    sortKey: { name: 'SK', type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    deletionProtection: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  return { relay, competition };
}

// ── Photo CDN ─────────────────────────────────────────────────────────────────
// Never-public bucket; reads only through CloudFront (OAC + trusted key group,
// signed URLs that expire with the event); writes only via presigned POSTs from
// photoUpload.

interface PhotoCdn {
  bucket: Bucket;
  publicKey: PublicKey;
  distribution: Distribution;
}

function definePhotoCdn(stack: Stack, stage: string): PhotoCdn {
  const bucket = new Bucket(stack, 'PhotosBucket', {
    bucketName: `slackline-timer-v1-photos-${stage}`,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.RETAIN,
    // Housekeeping insurance: content-hashed upload keys are never dereferenced
    // when an athlete's photo is replaced, so orphans accumulate forever. S3
    // lifecycle is time-based (it can't see which keys an athlete row still
    // references), so we expire on age instead. The event-scoped access model
    // caps a photo's useful life at the competition window (signed URLs die
    // ≤10 days after the event, core/eventWindow.ts); 90 days sits well beyond
    // that even allowing for athletes entered weeks ahead of the event, so any
    // object this old is certainly unreferenced. Free control, no standing cost.
    lifecycleRules: [
      {
        id: 'expire-stale-photos',
        enabled: true,
        prefix: 'photos/',
        expiration: Duration.days(90),
        abortIncompleteMultipartUploadAfter: Duration.days(1),
      },
    ],
    cors: [
      {
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethods.POST],
        allowedHeaders: ['*'],
        maxAge: 3600,
      },
    ],
  });
  const publicKey = new PublicKey(stack, 'PhotosPublicKey', {
    publicKeyName: `slackline-timer-v1-photos-${stage}`,
    encodedKey: StringParameter.valueForStringParameter(stack, PHOTO_PUBLIC_KEY_PARAM),
    comment: 'Verifies signed photo URLs minted by the read Lambdas',
  });
  const keyGroup = new KeyGroup(stack, 'PhotosKeyGroup', {
    keyGroupName: `slackline-timer-v1-photos-${stage}`,
    items: [publicKey],
    comment: 'Trusted key group for the photo distribution',
  });
  const distribution = new Distribution(stack, 'PhotosDistribution', {
    comment: `slackline-timer-v1 athlete photos (${stage}) — signed URLs only`,
    priceClass: PriceClass.PRICE_CLASS_100,
    defaultBehavior: {
      origin: S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      cachedMethods: CachedMethods.CACHE_GET_HEAD,
      compress: true,
      // Keys are content-hashed, so long edge caching is safe.
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      trustedKeyGroups: [keyGroup],
    },
  });
  return { bucket, publicKey, distribution };
}

// ── Lambdas ───────────────────────────────────────────────────────────────────
// One folder per function under src/functions/; this section builds all thirteen
// plus their table/bucket/parameter grants. Secrets stay per-function (least
// exposure): only a consumer gets the parameter name in env + ssm:GetParameter
// on it (ADR 0025).

interface Fns {
  authorizer: NodejsFunction;
  connection: NodejsFunction;
  message: NodejsFunction;
  httpAuthorizer: NodejsFunction;
  competitions: NodejsFunction;
  athletes: NodejsFunction;
  times: NodejsFunction;
  matches: NodejsFunction;
  scores: NodejsFunction;
  rankings: NodejsFunction;
  photoUpload: NodejsFunction;
  createReadToken: NodejsFunction;
  managers: NodejsFunction;
  all: NodejsFunction[];
  /** messageHandler + the five entity writers — everything that posts to WS connections. */
  broadcasters: NodejsFunction[];
}

function defineFunctions(stack: Stack, stage: string, tables: Tables, photoCdn: PhotoCdn): Fns {
  const readTokenSecretParam = StringParameter.fromSecureStringParameterAttributes(
    stack,
    'ReadTokenSecretParam',
    { parameterName: READ_TOKEN_SECRET_PARAM },
  );
  const photoPrivateKeyParam = StringParameter.fromSecureStringParameterAttributes(
    stack,
    'PhotoPrivateKeyParam',
    { parameterName: PHOTO_PRIVATE_KEY_PARAM },
  );

  // Base env applied to every function. WS_API_ENDPOINT is added once the WS
  // stage exists (defineWsRelay).
  const baseEnv: Record<string, string> = {
    ...COGNITO,
    AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
    // Load the bundled .js.map (sourceMap: true below) so runtime stack traces
    // point at the TS source instead of bundle offsets.
    NODE_OPTIONS: '--enable-source-maps',
    SPEEDLINE_TIMER_TABLE: tables.relay.tableName,
    COMPETITION_TABLE: tables.competition.tableName,
    PHOTOS_BUCKET: photoCdn.bucket.bucketName,
    PHOTO_CDN_DOMAIN: photoCdn.distribution.distributionDomainName,
    PHOTO_KEY_PAIR_ID: photoCdn.publicKey.publicKeyId,
  };

  const makeFn = (
    idBase: string,
    dir: string,
    opts: { timeout?: number; env?: Record<string, string>; reservedConcurrency?: number } = {},
  ): NodejsFunction => {
    // One LogGroup per function, 30-day retention. Explicit kebab-case physical
    // names (functionName / logGroupName) so ops can find a function or its logs
    // by name; construct ids stay PascalCase (CFN logical IDs).
    const logGroup = new LogGroup(stack, `${idBase}LogGroup`, {
      logGroupName: `/aws/lambda/slackline-timer-v1-${dir}-${stage}`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    return new NodejsFunction(stack, idBase, {
      functionName: `slackline-timer-v1-${dir}-${stage}`,
      entry: path.join(__dirname, `../src/functions/${dir}/handler.ts`),
      handler: 'main',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.X86_64,
      // Lambda CPU scales with memory; 128 (the floor) starves the CPU-bound
      // work here — the messageHandler's PostToConnection fan-out and the
      // authorizers' JWT verify — which pushed the 10s messageHandler past its
      // timeout on busy rooms. 256 doubles the CPU slice at the next tier up
      // (duration-billed cost stays ~flat: 2x rate, ~half the wall time).
      memorySize: 256,
      timeout: Duration.seconds(opts.timeout ?? 20),
      // Reserved-concurrency cap (ADR 0031 §3): a per-function blast-radius
      // ceiling that doubles as a guaranteed floor. Sizes + headroom math sit
      // where the caps are passed, below.
      reservedConcurrentExecutions: opts.reservedConcurrency,
      environment: { ...baseEnv, ...(opts.env ?? {}) },
      logGroup,
      bundling: {
        minify: false,
        sourceMap: true,
        target: 'node24',
        // Bundle the pinned @aws-sdk v3 rather than defer to the runtime's copy.
        externalModules: [],
      },
    });
  };

  // ADR 0031 §3 reserved-concurrency caps (the eu-central-2 concurrent-executions
  // quota is the standard 1000). Each cap is both a blast-radius ceiling and a
  // guaranteed floor — the broadcaster group cannot be starved out of the pool by a
  // db_update refetch storm. The relay's messageHandler carries its OWN, larger
  // cap: at HWC 2026 (a 241-connection room) the shared 25 sat pegged for the whole
  // event and Lambda-throttled ~3,275 inbound frames (start/stop/selection/
  // request_state dropped before any fan-out ran), because a reconnect burst lands
  // dozens of simultaneous fan-outs that each hold their slot for up to the 10s
  // timeout. 100 absorbs that burst; the 5 entity writers stay at 25 (a write flood
  // is already bounded by the 20 rps HTTP-stage throttle). Total reserved =
  // 2×50 + 100 + 5×25 = 325, leaving 675 of the 1000 pool unreserved (AWS ≥100).
  const AUTHORIZER_CONCURRENCY = 50; // authorizer + httpAuthorizer
  const MESSAGE_HANDLER_CONCURRENCY = 100; // the WS relay fan-out — its own, larger cap
  const BROADCASTER_CONCURRENCY = 25; // the 5 entity writers

  // Relay handlers. Both authorizers just verify a JWT (JWKS fetch on cold
  // start), so they share the 10s timeout.
  const authorizer = makeFn('AuthorizerFunction', 'authorizer', {
    timeout: 10,
    reservedConcurrency: AUTHORIZER_CONCURRENCY,
    env: { READ_TOKEN_SECRET_PARAM },
  });
  const connection = makeFn('ConnectionHandlerFunction', 'connectionHandler', {
    timeout: 10,
  });
  const message = makeFn('MessageHandlerFunction', 'messageHandler', {
    timeout: 10,
    reservedConcurrency: MESSAGE_HANDLER_CONCURRENCY,
  });

  // Data-plane handlers.
  const httpAuthorizer = makeFn('HttpAuthorizerFunction', 'httpAuthorizer', {
    timeout: 10,
    reservedConcurrency: AUTHORIZER_CONCURRENCY,
    env: { READ_TOKEN_SECRET_PARAM },
  });
  const competitions = makeFn('CompetitionsFunction', 'competitions', {
    reservedConcurrency: BROADCASTER_CONCURRENCY,
  });
  const athletes = makeFn('AthletesFunction', 'athletes', {
    reservedConcurrency: BROADCASTER_CONCURRENCY,
    env: { PHOTO_PRIVATE_KEY_PARAM },
  });
  const times = makeFn('TimesFunction', 'times', {
    reservedConcurrency: BROADCASTER_CONCURRENCY,
  });
  const matches = makeFn('MatchesFunction', 'matches', {
    reservedConcurrency: BROADCASTER_CONCURRENCY,
  });
  const scores = makeFn('ScoresFunction', 'scores', {
    reservedConcurrency: BROADCASTER_CONCURRENCY,
  });
  const rankings = makeFn('RankingsFunction', 'rankings', {
    env: { PHOTO_PRIVATE_KEY_PARAM },
  });
  const photoUpload = makeFn('PhotoUploadFunction', 'photoUpload');
  const createReadToken = makeFn('CreateReadTokenFunction', 'createReadToken', {
    env: { READ_TOKEN_SECRET_PARAM },
  });
  // Unreserved, like the other infrequent admin actions (createReadToken): a
  // manager grant is a rare operator click, so it draws from the unreserved pool
  // rather than pinning a concurrency floor.
  const managers = makeFn('ManagersFunction', 'managers');

  const all = [
    authorizer,
    connection,
    message,
    httpAuthorizer,
    competitions,
    athletes,
    times,
    matches,
    scores,
    rankings,
    photoUpload,
    createReadToken,
    managers,
  ];

  // Grants are per need, not per role. The relay table reaches beyond the relay
  // handlers only to the five entity writers, whose core/broadcast.ts db_update
  // fan-out reads + prunes connection rows (their ManageConnections grant
  // follows in defineWsRelay). The authorizers, rankings, photoUpload and
  // createReadToken only ever read the competition table (getCompetition /
  // list*); connectionHandler writes its own connection rows and reads back the
  // reverse map item a $disconnect needs to resolve its session (core/db.ts).
  const writers = [competitions, athletes, times, matches, scores];
  tables.relay.grantReadWriteData(connection);
  tables.relay.grantReadWriteData(message);
  for (const fn of writers) {
    tables.relay.grantReadWriteData(fn);
    tables.competition.grantReadWriteData(fn);
  }
  for (const fn of [authorizer, httpAuthorizer, rankings, photoUpload, createReadToken]) {
    tables.competition.grantReadData(fn);
  }
  // The managers Lambda reads + writes grant items on the competition table and
  // resolves email→sub against the shared ISA Cognito pool. It does not touch
  // the relay (no db_update broadcast), so it stays out of `writers`.
  tables.competition.grantReadWriteData(managers);
  managers.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['cognito-idp:ListUsers'],
      resources: [cognitoPoolArn(managers)],
    }),
  );
  // Only photoUpload signs presigned POSTs — no other function gets s3:PutObject.
  photoCdn.bucket.grantPut(photoUpload);
  // Secret reads (core/secrets.ts runtime fetch): each SecureString is readable
  // only by its consumers. The default aws/ssm KMS key decrypts via-service, so
  // no kms:Decrypt grant is needed.
  for (const fn of [authorizer, httpAuthorizer, createReadToken]) {
    readTokenSecretParam.grantRead(fn);
  }
  for (const fn of [athletes, rankings]) {
    photoPrivateKeyParam.grantRead(fn);
  }

  return {
    authorizer,
    connection,
    message,
    httpAuthorizer,
    competitions,
    athletes,
    times,
    matches,
    scores,
    rankings,
    photoUpload,
    createReadToken,
    managers,
    all,
    broadcasters: [message, ...writers],
  };
}

// ── WebSocket relay ───────────────────────────────────────────────────────────
// Both query params feed the authorizer decision and so are the cache key — a
// cached result must never carry across a different sessionId (ADR 0022).

function defineWsRelay(stack: Stack, stage: string, fns: Fns): WebSocketStage {
  const wsApi = new WebSocketApi(stack, 'WebsocketsApi', {
    apiName: `slackline-timer-v1-ws-${stage}`,
    routeSelectionExpression: '$request.body.action',
    connectRouteOptions: {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', fns.connection),
      authorizer: new WebSocketLambdaAuthorizer('WsAuthorizer', fns.authorizer, {
        identitySource: [
          'route.request.querystring.Authorization',
          'route.request.querystring.sessionId',
        ],
      }),
    },
    disconnectRouteOptions: {
      integration: new WebSocketLambdaIntegration('DisconnectIntegration', fns.connection),
    },
    defaultRouteOptions: {
      integration: new WebSocketLambdaIntegration('DefaultIntegration', fns.message),
    },
  });
  const wsStage = new WebSocketStage(stack, 'WebsocketsStage', {
    webSocketApi: wsApi,
    stageName: stage,
    autoDeploy: true,
    // Default-route throttling (ADR 0031 §2). This bucket meters not just inbound
    // $connect/$default but ALSO the outbound PostToConnection fan-out — every
    // relayed message consumes fanout-N posts. Sized for inbound connects only
    // (10/20) it silently 429-dropped fan-out posts mid-event (HWC 2026), and even
    // 500/1000 was out-run by a 67-connection reconnect storm (the request_state ×
    // snapshot × selection amplification: failed=59/67 for ~6s). 2000/2000 sits
    // just under the 2500 rps account cap — the account limit is the real ceiling
    // now; the residual stage throttle keeps the WAF-less cost guardrail shape.
    // The durable fix for storms is damping the amplification + retrying 429s in
    // src/core/broadcast.ts, not more headroom here.
    throttle: { rateLimit: 2000, burstLimit: 2000 },
  });

  // db_update broadcast endpoint (base env on every function) + fan-out
  // permission for the functions that actually publish. This is the
  // cross-wiring that keeps the backend one stack: the env var can only be
  // patched in after the stage exists.
  for (const fn of fns.all) {
    fn.addEnvironment('WS_API_ENDPOINT', wsStage.callbackUrl);
  }
  for (const fn of fns.broadcasters) {
    wsApi.grantManageConnections(fn);
  }
  return wsStage;
}

// ── HTTP data plane ───────────────────────────────────────────────────────────
// Custom request authorizer: Cognito IdToken+timeradmin → admin, or an event
// read token → reader. The native JWT authorizer can't check cognito:groups.

function defineHttpApi(
  stack: Stack,
  stage: string,
  fns: Fns,
): { httpApi: HttpApi; httpStage: HttpStage } {
  const httpAuthorizer = new HttpLambdaAuthorizer('TimerHttpAuthorizer', fns.httpAuthorizer, {
    authorizerName: 'timerHttpAuthorizer',
    responseTypes: [HttpLambdaResponseType.SIMPLE],
    identitySource: ['$request.header.Authorization'],
    // Cached per Authorization value — upper bound on read-token revocation lag.
    resultsCacheTtl: Duration.seconds(60),
  });
  const httpApi = new HttpApi(stack, 'HttpApi', {
    apiName: `slackline-timer-v1-http-${stage}`,
    createDefaultStage: false,
    defaultAuthorizer: httpAuthorizer,
    corsPreflight: {
      allowOrigins: ['*'],
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: [
        CorsHttpMethod.GET,
        CorsHttpMethod.POST,
        CorsHttpMethod.PUT,
        CorsHttpMethod.DELETE,
        CorsHttpMethod.OPTIONS,
      ],
      maxAge: Duration.hours(1),
    },
  });
  const httpStage = new HttpStage(stack, 'HttpStage', {
    httpApi,
    stageName: stage,
    autoDeploy: true,
    // Default-stage throttling (ADR 0031 §2): the request authorizer does per-hit
    // DynamoDB getCompetition + JWKS/HMAC verify, so a flood bills that Lambda +
    // DB before the deny. ~20 rps / 40 burst sits well above a live admin + ~15
    // overlays refreshing on db_update, far below a flood. No usage plans / API
    // keys (ADR 0022(c)). Behavioural smoke owed post-deploy.
    throttle: { rateLimit: 20, burstLimit: 40 },
  });

  // The whole API surface as one table: one integration per function, reused
  // across its routes. Guarded by test/infra/slackline-stack.test.ts, which
  // asserts the exact synthesized route set.
  const { GET, POST, PUT, DELETE } = HttpMethod;
  const C = '/competitions';
  const surface: {
    fn: NodejsFunction;
    integrationId: string;
    routes: { path: string; methods: HttpMethod[] }[];
  }[] = [
    {
      fn: fns.competitions,
      integrationId: 'CompetitionsIntegration',
      routes: [
        { path: C, methods: [POST, GET] },
        { path: `${C}/{compId}`, methods: [GET, PUT] },
        { path: `${C}/{compId}/revoke-read-tokens`, methods: [POST] },
      ],
    },
    {
      fn: fns.athletes,
      integrationId: 'AthletesIntegration',
      routes: [
        { path: `${C}/{compId}/athletes`, methods: [GET, POST] },
        { path: `${C}/{compId}/athletes/{athleteId}`, methods: [GET, PUT, DELETE] },
      ],
    },
    {
      fn: fns.times,
      integrationId: 'TimesIntegration',
      routes: [
        { path: `${C}/{compId}/times`, methods: [GET, POST] },
        { path: `${C}/{compId}/times/{timeId}`, methods: [PUT, DELETE] },
      ],
    },
    {
      fn: fns.matches,
      integrationId: 'MatchesIntegration',
      routes: [
        { path: `${C}/{compId}/matches`, methods: [GET, POST] },
        { path: `${C}/{compId}/matches/seed`, methods: [POST] },
        { path: `${C}/{compId}/matches/advance`, methods: [POST] },
        { path: `${C}/{compId}/matches/{matchId}`, methods: [PUT, DELETE] },
      ],
    },
    {
      fn: fns.scores,
      integrationId: 'ScoresIntegration',
      routes: [
        { path: `${C}/{compId}/scores`, methods: [GET, POST] },
        { path: `${C}/{compId}/scores/{scoreId}`, methods: [PUT, DELETE] },
      ],
    },
    {
      fn: fns.rankings,
      integrationId: 'RankingsIntegration',
      routes: [{ path: `${C}/{compId}/rankings/{round}`, methods: [GET] }],
    },
    {
      fn: fns.photoUpload,
      integrationId: 'PhotoUploadIntegration',
      routes: [{ path: `${C}/{compId}/photo-uploads`, methods: [POST] }],
    },
    {
      fn: fns.createReadToken,
      integrationId: 'CreateReadTokenIntegration',
      routes: [{ path: `${C}/{compId}/read-tokens`, methods: [POST] }],
    },
    {
      fn: fns.managers,
      integrationId: 'ManagersIntegration',
      routes: [
        { path: `${C}/{compId}/managers`, methods: [GET, POST] },
        { path: `${C}/{compId}/managers/{sub}`, methods: [DELETE] },
      ],
    },
  ];
  for (const { fn, integrationId, routes } of surface) {
    const integration = new HttpLambdaIntegration(integrationId, fn);
    for (const r of routes) {
      httpApi.addRoutes({ path: r.path, methods: r.methods, integration });
    }
  }
  return { httpApi, httpStage };
}

// ── AWS WAF (regional) ──────────────────────────────────────────────────────────
// ADR 0031 §5: a parameter-flagged, default-OFF rate-based WebACL fronting the two
// regional API Gateway endpoints (the HTTP data plane + the WS relay), gated on the
// WafEnabled parameter so a normal deploy provisions NO WAF resources and carries no
// standing cost. The CloudFront-scoped counterpart for the web dist lives in the
// us-east-1 billing stack (CLOUDFRONT-scope WAF is us-east-1-only). Ops flips this on
// only on an observed abuse event — enable runbook: doc/dev/deploy.md §6.3 + infra/waf.ts.
// Behavioural verification (burst → block) is owed post-enable (guardrail-deploy-smoke).

function defineWaf(
  stack: Stack,
  stage: string,
  wsStage: WebSocketStage,
  httpStage: HttpStage,
): void {
  const enabled = defineWafToggle(stack);
  const webAcl = makeRateBasedWebAcl(stack, 'RegionalWebAcl', {
    scope: 'REGIONAL',
    namePrefix: `slackline-timer-v1-${stage}`,
    condition: enabled,
  });

  // API Gateway v2 stage ARNs (WAF associates with the stage, not the API):
  // arn:aws:apigateway:<region>::/apis/<apiId>/stages/<stageName>. Both stages
  // share the region/partition; only apiId + stageName differ.
  const stageArn = (apiId: string): string =>
    `arn:${stack.partition}:apigateway:${stack.region}::/apis/${apiId}/stages/${stage}`;

  for (const [id, apiId] of [
    ['HttpApiWafAssociation', httpStage.api.apiId],
    ['WsApiWafAssociation', wsStage.api.apiId],
  ] as const) {
    const assoc = new CfnWebACLAssociation(stack, id, {
      resourceArn: stageArn(apiId),
      webAclArn: webAcl.attrArn,
    });
    assoc.cfnOptions.condition = enabled;
  }
}
