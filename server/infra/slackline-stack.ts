import * as path from 'node:path';

import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  CfnRoute,
  CfnStage,
  HttpStage,
  type ThrottleSettings,
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
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  Alarm,
  ComparisonOperator,
  type IMetric,
  MathExpression,
  Metric,
  Stats,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

// SSM parameter names; all three must exist before the first deploy. The two
// secrets are SecureString and reach the Lambdas as *names* only, fetched +
// decrypted at runtime (core/secrets.ts, ADR 0025) — CFN rejects ssm-secure in
// env blocks and plaintext env vars leak via GetFunctionConfiguration. The
// public key is not a secret and resolves at deploy into the CloudFront key.
const READ_TOKEN_SECRET_PARAM = '/slackline-timer-v1/read-token-secret';
const PHOTO_PUBLIC_KEY_PARAM = '/slackline-timer-v1/photo-public-key';
const PHOTO_PRIVATE_KEY_PARAM = '/slackline-timer-v1/photo-private-key';

/**
 * The shared ISA user pool. Not secret but account-specific, so deployment
 * config resolved in infra/app.ts, never committed (ADR 0048).
 *
 * Does NOT vary with `stage`: a dev stack (`cdk watch`) gets its own
 * tables/APIs/buckets but the same pool.
 */
export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  timerGroup: string;
  /**
   * The pool's home region (the backend may run in another). The managers
   * Lambda pins its Cognito client to this to resolve email→sub.
   */
  region: string;
}

// For the managers Lambda's ListUsers grant. The account is the one being
// deployed to, so the grant is sound only when the backend deploys INTO the
// pool's account (ADR 0045); a foreign-account pool needs an assumed
// cross-account role, not a different literal here.
const cognitoPoolArn = (scope: Construct, cognito: CognitoConfig): string =>
  `arn:aws:cognito-idp:${cognito.region}:${Stack.of(scope).account}:userpool/${cognito.userPoolId}`;

export interface SlacklineTimerV1StackProps extends StackProps {
  stage: string;
  cognito: CognitoConfig;
  /** Subscribed to the ops alarm topic (defineAlarms); the billing stack's address. */
  alertEmail: string;
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
    const { stage, cognito, alertEmail } = props;

    const tables = defineTables(this, stage);
    const photoCdn = definePhotoCdn(this, stage);
    const fns = defineFunctions(this, stage, tables, photoCdn, cognito);
    const wsStage = defineWsRelay(this, stage, fns);
    const httpApi = defineHttpApi(this, stage, fns);
    defineAlarms(this, stage, fns, httpApi, alertEmail);

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
    // The web build's CSP connect-src (ADR 0054): the host createPresignedPost
    // returns as the upload `url`.
    new CfnOutput(this, 'PhotoUploadOrigin', {
      description: 'Origin the browser POSTs presigned photo uploads to.',
      value: `https://${photoCdn.bucket.bucketRegionalDomainName}`,
    });
  }
}

// ── DynamoDB ──────────────────────────────────────────────────────────────────
// Relay table: connection rows, TTL-expired. Competition single-table:
// athletes/times/matches/scores/meta (SK layout in src/core/keys.ts). Both stay
// on-demand (ADR 0031 §4) and RETAIN + deletion-protected, so `cdk destroy`
// leaves them as unmanaged orphans — see server/scripts/decommission/stacks.json.
// Only the competition table has PITR: deletion protection does not undo a bad
// seed/advance or bulk delete, while relay rows live CONNECTION_TTL_SECONDS
// (core/db.ts). Restore runbook: doc/dev/deploy.md §6.4.

interface Tables {
  relay: Table;
  competition: Table;
}

function defineTables(stack: Stack, stage: string): Tables {
  // Frozen logical id `SpeedlineTimerTable` (and env key `SPEEDLINE_TIMER_TABLE`):
  // a logical-id rename replaces the resource, and RETAIN would orphan the live
  // table.
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
    pointInTimeRecoverySpecification: {
      pointInTimeRecoveryEnabled: true,
      recoveryPeriodInDays: 35,
    },
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
    // A replaced photo's content-hashed key is never deleted, and lifecycle can
    // only expire by age. Signed URLs never outlive the event window
    // (core/eventWindow.ts), so 90 days covers athletes entered weeks ahead.
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
      // Managed (no per-policy cost, flat-rate-plan compatible): `nosniff` keeps
      // a non-image body uploaded under an image Content-Type from rendering.
      responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
      trustedKeyGroups: [keyGroup],
    },
  });
  return { bucket, publicKey, distribution };
}

// ── Lambdas ───────────────────────────────────────────────────────────────────
// One per src/functions/ folder, plus their grants. Only a secret's consumers
// get its parameter name in env + ssm:GetParameter (ADR 0025).

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
  /** Everything that posts to or closes WS connections: messageHandler, the writers, managers. */
  connectionManagers: NodejsFunction[];
}

function defineFunctions(
  stack: Stack,
  stage: string,
  tables: Tables,
  photoCdn: PhotoCdn,
  cognito: CognitoConfig,
): Fns {
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
    // The COGNITO_* keys are the frozen runtime contract (src/types/environment.d.ts;
    // read by the authorizers, the managers Lambda and core/cognitoUsers.ts); only
    // the values are deployment config.
    COGNITO_USER_POOL_ID: cognito.userPoolId,
    COGNITO_CLIENT_ID: cognito.clientId,
    COGNITO_TIMER_GROUP: cognito.timerGroup,
    COGNITO_REGION: cognito.region,
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
    // Kebab-case physical names so ops can find a function or its logs by name;
    // construct ids stay PascalCase (CFN logical ids).
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
      // CPU scales with memory: at 128 the messageHandler fan-out and the JWT
      // verifies ran past the 10s timeout on busy rooms. 256 doubles the CPU at
      // ~flat cost (2x rate, ~half the wall time).
      memorySize: 256,
      timeout: Duration.seconds(opts.timeout ?? 20),
      // ADR 0031 §3; sizes below.
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

  // Reserved-concurrency caps: each a blast-radius ceiling and a guaranteed floor
  // (sizing + the HWC 2026 evidence: ADR 0031 §3). messageHandler has its own,
  // larger cap: a reconnect burst lands dozens of fan-outs that each hold a slot
  // up to the 10s timeout. Writers are also bounded by HTTP_ROUTE_THROTTLE.
  // Total 2×50 + 100 + 5×25 = 325 of the 1000 pool (AWS keeps ≥100 unreserved).
  const AUTHORIZER_CONCURRENCY = 50; // authorizer + httpAuthorizer
  const MESSAGE_HANDLER_CONCURRENCY = 100; // the WS relay fan-out — its own, larger cap
  const BROADCASTER_CONCURRENCY = 25; // the 5 entity writers

  // Relay handlers. Both authorizers only verify a JWT (JWKS fetch on cold start).
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
  // Unreserved, like createReadToken: a rare operator click needs no floor.
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

  // Grants are per need, not per role. Beyond the relay handlers, the relay table
  // reaches only the writers + managers, whose core/broadcast.ts calls (db_update,
  // the revoke socket closes of ADR 0026/0053) Query a session's rows and Delete
  // stale ones. connectionHandler also reads back the reverse-map item a
  // $disconnect needs to resolve its session (core/db.ts).
  const writers = [competitions, athletes, times, matches, scores];
  const relayClients = [...writers, managers];
  tables.relay.grantReadWriteData(connection);
  tables.relay.grantReadWriteData(message);
  for (const fn of relayClients) {
    tables.relay.grant(fn, 'dynamodb:Query', 'dynamodb:DeleteItem');
  }
  for (const fn of writers) {
    tables.competition.grantReadWriteData(fn);
  }
  for (const fn of [authorizer, httpAuthorizer, rankings, photoUpload, createReadToken]) {
    tables.competition.grantReadData(fn);
  }
  // managers writes grant items and resolves email→sub in the ISA pool; it
  // publishes no db_update, so it stays out of `writers`.
  tables.competition.grantReadWriteData(managers);
  managers.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['cognito-idp:ListUsers'],
      resources: [cognitoPoolArn(managers, cognito)],
    }),
  );
  // Only photoUpload signs presigned POSTs — no other function gets s3:PutObject.
  // Exactly PutObject on the upload prefix: grantPut would add the legal-hold/
  // retention/tagging variants on the whole bucket, all signable into a POST.
  photoUpload.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [photoCdn.bucket.arnForObjects('photos/*')],
    }),
  );
  // The default aws/ssm KMS key decrypts via-service: no kms:Decrypt grant needed.
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
    connectionManagers: [message, ...relayClients],
  };
}

// ── WebSocket relay ───────────────────────────────────────────────────────────
// Both query params are identity sources: a $connect missing either is rejected
// with 401 before the authorizer Lambda runs. WS authorizers have no result TTL,
// so nothing is cached across sessionIds (ADR 0022).

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
    // This bucket ALSO meters the outbound PostToConnection fan-out (N posts per
    // relayed frame). Just under the 2500 rps account cap; storms are fixed by
    // damping + 429 retry (src/core/broadcast.ts), not more headroom here
    // (ADR 0031 §2).
    throttle: { rateLimit: 2000, burstLimit: 2000 },
  });

  // The cross-wiring that keeps this one stack: the endpoint exists only once
  // the stage does.
  for (const fn of fns.all) {
    fn.addEnvironment('WS_API_ENDPOINT', wsStage.callbackUrl);
  }
  for (const fn of fns.connectionManagers) {
    wsApi.grantManageConnections(fn);
  }
  return wsStage;
}

// Per-route HTTP throttles (ADR 0031 §2), one rate (rps) / burst bucket per
// route key, so an overlay-read flood cannot drain the time/score writes. First
// estimates; re-size runbook: doc/dev/deploy.md §6.2.
//   write  — a time/score/match write per run or judged heat; seedRemote replays
//            them back-to-back (backing off on 429, scripts/lib/seedClient.mjs).
//   read   — every console + overlay refetches its queries on each db_update.
//   roster — athlete POST/PUT/DELETE and the photo presign before each one:
//            seedRemote enters a whole roster sequentially (~2–5 req/s with
//            photos), faster than the one-click admin bucket allows.
//   admin  — one-click operator actions (competition create/edit, read-token
//            mint/revoke, bracket seed/advance, manager grants).
const HTTP_ROUTE_THROTTLE = {
  write: { rateLimit: 10, burstLimit: 20 },
  read: { rateLimit: 30, burstLimit: 60 },
  roster: { rateLimit: 5, burstLimit: 10 },
  admin: { rateLimit: 2, burstLimit: 5 },
} as const satisfies Record<string, ThrottleSettings>;

// ── HTTP data plane ───────────────────────────────────────────────────────────
// Custom request authorizer (ADR 0004): Cognito IdToken → admin (timeradmin) or
// comp-scoped manager (ADR 0045), or an event read token → reader.

function defineHttpApi(stack: Stack, stage: string, fns: Fns): HttpApi {
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
    // ADR 0031 §2. Every route has its own bucket (HTTP_ROUTE_THROTTLE), so this
    // meters only requests that match no route.
    throttle: { rateLimit: 20, burstLimit: 40 },
  });

  // test/infra/slackline-stack.test.ts pins the exact route set and a
  // RouteSettings entry per route key. An integration's logical id derives from
  // the first route bound to it, so reordering a function's first route replaces
  // its integration.
  const { GET, POST, PUT, DELETE } = HttpMethod;
  const { read, write, roster, admin } = HTTP_ROUTE_THROTTLE;
  const C = '/competitions';
  const surface: {
    fn: NodejsFunction;
    integrationId: string;
    routes: { path: string; methods: HttpMethod[]; throttle: ThrottleSettings }[];
  }[] = [
    {
      fn: fns.competitions,
      integrationId: 'CompetitionsIntegration',
      routes: [
        { path: C, methods: [POST], throttle: admin },
        { path: C, methods: [GET], throttle: read },
        { path: `${C}/{compId}`, methods: [GET], throttle: read },
        { path: `${C}/{compId}`, methods: [PUT], throttle: admin },
        { path: `${C}/{compId}/revoke-read-tokens`, methods: [POST], throttle: admin },
      ],
    },
    {
      fn: fns.athletes,
      integrationId: 'AthletesIntegration',
      routes: [
        { path: `${C}/{compId}/athletes`, methods: [GET], throttle: read },
        { path: `${C}/{compId}/athletes`, methods: [POST], throttle: roster },
        { path: `${C}/{compId}/athletes/{athleteId}`, methods: [GET], throttle: read },
        { path: `${C}/{compId}/athletes/{athleteId}`, methods: [PUT, DELETE], throttle: roster },
      ],
    },
    {
      fn: fns.times,
      integrationId: 'TimesIntegration',
      routes: [
        { path: `${C}/{compId}/times`, methods: [GET], throttle: read },
        { path: `${C}/{compId}/times`, methods: [POST], throttle: write },
        { path: `${C}/{compId}/times/{timeId}`, methods: [PUT, DELETE], throttle: write },
      ],
    },
    {
      fn: fns.matches,
      integrationId: 'MatchesIntegration',
      routes: [
        { path: `${C}/{compId}/matches`, methods: [GET], throttle: read },
        { path: `${C}/{compId}/matches`, methods: [POST], throttle: write },
        { path: `${C}/{compId}/matches/seed`, methods: [POST], throttle: admin },
        { path: `${C}/{compId}/matches/advance`, methods: [POST], throttle: admin },
        { path: `${C}/{compId}/matches/{matchId}`, methods: [PUT, DELETE], throttle: write },
      ],
    },
    {
      fn: fns.scores,
      integrationId: 'ScoresIntegration',
      routes: [
        { path: `${C}/{compId}/scores`, methods: [GET], throttle: read },
        { path: `${C}/{compId}/scores`, methods: [POST], throttle: write },
        { path: `${C}/{compId}/scores/{scoreId}`, methods: [PUT, DELETE], throttle: write },
      ],
    },
    {
      fn: fns.rankings,
      integrationId: 'RankingsIntegration',
      routes: [{ path: `${C}/{compId}/rankings/{round}`, methods: [GET], throttle: read }],
    },
    {
      fn: fns.photoUpload,
      integrationId: 'PhotoUploadIntegration',
      routes: [{ path: `${C}/{compId}/photo-uploads`, methods: [POST], throttle: roster }],
    },
    {
      fn: fns.createReadToken,
      integrationId: 'CreateReadTokenIntegration',
      routes: [{ path: `${C}/{compId}/read-tokens`, methods: [POST], throttle: admin }],
    },
    {
      fn: fns.managers,
      integrationId: 'ManagersIntegration',
      routes: [
        { path: `${C}/{compId}/managers`, methods: [GET, POST], throttle: admin },
        { path: `${C}/{compId}/managers/{sub}`, methods: [DELETE], throttle: admin },
      ],
    },
  ];
  const cfnStage = httpStage.node.defaultChild as CfnStage;
  const routeSettings: Record<
    string,
    { ThrottlingRateLimit?: number; ThrottlingBurstLimit?: number }
  > = {};
  for (const { fn, integrationId, routes } of surface) {
    const integration = new HttpLambdaIntegration(integrationId, fn);
    for (const r of routes) {
      const created = httpApi.addRoutes({ path: r.path, methods: r.methods, integration });
      // RouteSettings naming a route that does not exist yet fails the deploy
      // ("Unable to find Route by key"), and CDK infers no stage→route order.
      for (const route of created)
        cfnStage.addResourceDependency(route.node.defaultChild as CfnRoute);
      for (const method of r.methods) {
        routeSettings[`${method} ${r.path}`] = {
          ThrottlingRateLimit: r.throttle.rateLimit,
          ThrottlingBurstLimit: r.throttle.burstLimit,
        };
      }
    }
  }
  // The L2 HttpStage exposes only the stage-wide `throttle`. RouteSettings is a
  // JSON-typed L1 property, so the CFN key casing is passed through verbatim.
  cfnStage.routeSettings = routeSettings;
  return httpApi;
}

// ── Operational alarms ────────────────────────────────────────────────────────
// Early warning for the failure modes found only by log forensics after HWC 2026
// (relay throttling, authorizer starvation) and for log-ingest cost, which the
// billing alarm sees 6–24 h late. Alarm actions must target a topic in the
// alarm's region, so this topic is separate from the us-east-1 billing topic;
// both subscribe the same address. An unconfirmed email subscription drops
// every notification (deploy.md §6.5).

// Log ingest per hour across the relay + authorizer log groups. Ingest bills
// ~$0.6/GB, so 1 GiB/h left running crosses the $55 budget in ~4 days, while the
// billing alarm lags 6–24 h.
const LOG_INGEST_ALARM_BYTES_PER_HOUR = 1024 ** 3;

function defineAlarms(
  stack: Stack,
  stage: string,
  fns: Fns,
  httpApi: HttpApi,
  alertEmail: string,
): void {
  const topic = new Topic(stack, 'OpsAlarmTopic', {
    topicName: `slackline-timer-v1-ops-${stage}`,
    displayName: 'slackline-timer-v1 ops alarms',
  });
  topic.addSubscription(new EmailSubscription(alertEmail));
  const notify = new SnsAction(topic);

  const alarm = (
    id: string,
    name: string,
    description: string,
    metric: IMetric,
    threshold: number,
    comparisonOperator = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  ): void => {
    new Alarm(stack, id, {
      alarmName: `slackline-timer-v1-${name}-${stage}`,
      alarmDescription: description,
      metric,
      threshold,
      comparisonOperator,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      // Idle stages publish nothing; no data is the healthy state.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);
  };

  // A throttled messageHandler invocation is a dropped relay frame (start/stop
  // included), so one is worth a page.
  alarm(
    'MessageHandlerThrottlesAlarm',
    'message-handler-throttles',
    'messageHandler hit its reserved concurrency: relay frames are being dropped before fan-out.',
    fns.message.metricThrottles({ period: Duration.minutes(1), statistic: Stats.SUM }),
    1,
  );
  // FILL: a sum over a series with no datapoint at a timestamp is itself missing.
  alarm(
    'AuthorizerThrottlesAlarm',
    'authorizer-throttles',
    'A WS or HTTP authorizer hit its reserved concurrency: logins / API calls are being refused.',
    new MathExpression({
      expression: 'FILL(ws, 0) + FILL(http, 0)',
      usingMetrics: {
        ws: fns.authorizer.metricThrottles({ statistic: Stats.SUM }),
        http: fns.httpAuthorizer.metricThrottles({ statistic: Stats.SUM }),
      },
      label: 'Authorizer throttles',
      period: Duration.minutes(5),
    }),
    1,
  );
  alarm(
    'MessageHandlerErrorsAlarm',
    'message-handler-errors',
    'messageHandler invocations failed (uncaught error or timeout).',
    fns.message.metricErrors({ period: Duration.minutes(5), statistic: Stats.SUM }),
    1,
  );
  alarm(
    'HttpApi5xxAlarm',
    'http-api-5xx',
    'The HTTP data plane returned 5xx responses.',
    httpApi.metricServerError({ period: Duration.minutes(5), statistic: Stats.SUM }),
    5,
  );
  const incomingBytes = (fn: NodejsFunction): Metric =>
    new Metric({
      namespace: 'AWS/Logs',
      metricName: 'IncomingBytes',
      dimensionsMap: { LogGroupName: fn.logGroup.logGroupName },
      statistic: Stats.SUM,
    });
  alarm(
    'LogIngestAlarm',
    'log-ingest',
    'More than 1 GiB/h of logs ingested by messageHandler + the authorizers (log-cost runaway).',
    new MathExpression({
      expression: 'FILL(msg, 0) + FILL(wsAuth, 0) + FILL(httpAuth, 0)',
      usingMetrics: {
        msg: incomingBytes(fns.message),
        wsAuth: incomingBytes(fns.authorizer),
        httpAuth: incomingBytes(fns.httpAuthorizer),
      },
      label: 'Relay + authorizer log ingest (bytes)',
      period: Duration.hours(1),
    }),
    LOG_INGEST_ALARM_BYTES_PER_HOUR,
    ComparisonOperator.GREATER_THAN_THRESHOLD,
  );
}
