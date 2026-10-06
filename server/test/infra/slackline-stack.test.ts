import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../infra/app';
import { CognitoConfig, SlacklineTimerV1Stack } from '../../infra/slackline-stack';
import { OFFLINE_ENV } from '../../scripts/offlineEnv.mjs';

// Machine-checked documentation of what the stack synthesizes: the invariants
// asserted here (retention, public access, grants, authorizer cache keys, the
// route surface) are the ones a refactor must not move. Synthesized once —
// the bundling-stacks context short-circuits NodejsFunction's esbuild step, so
// this runs on the template alone, no assets built.
// Cognito is deployment config, not source (see infra/app.ts) — fixture values
// keep synth hermetic and let the assertions below prove the props reach the
// Lambda env, which committed literals could not.
const COGNITO: CognitoConfig = {
  userPoolId: 'eu-central-1_testpool',
  clientId: 'test-client-id',
  timerGroup: 'timeradmin',
  region: 'eu-central-1',
};

const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
const ALERT_EMAIL = 'ops-alerts@example.org';
const stack = new SlacklineTimerV1Stack(app, 'slackline-timer-v1', {
  stage: 'prod',
  cognito: COGNITO,
  alertEmail: ALERT_EMAIL,
  env: { region: 'eu-central-2', account: '111111111111' },
});
const template = Template.fromStack(stack);

const LAMBDA_COUNT = 13;
// HTTP routes in the surface table (the WS system routes excluded).
const HTTP_ROUTE_COUNT = 30;

// A function role's grants land in its ServiceRoleDefaultPolicy; table ARNs are
// Fn::GetAtt refs carrying the table's logical id ('SpeedlineTimerTable' relay /
// 'CompetitionTable'), so substring checks pin which tables a role can touch.
const fnPolicy = (fnLogicalId: string): string => {
  const policies = template.findResources('AWS::IAM::Policy');
  const key = Object.keys(policies).find((id) =>
    id.startsWith(`${fnLogicalId}ServiceRoleDefaultPolicy`),
  );
  expect(key, `default policy for ${fnLogicalId}`).toBeDefined();
  return JSON.stringify(policies[key!].Properties.PolicyDocument);
};

interface PolicyStatementJson {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
}

const statementsOf = (fnLogicalId: string): PolicyStatementJson[] =>
  (JSON.parse(fnPolicy(fnLogicalId)) as { Statement: PolicyStatementJson[] }).Statement;

// The actions a role is allowed on resources whose serialised ARN contains
// `resourceRef` (a table/bucket logical id, or an ARN fragment).
const actionsOn = (fnLogicalId: string, resourceRef: string): string[] =>
  statementsOf(fnLogicalId)
    .filter((st) => st.Effect === 'Allow' && JSON.stringify(st.Resource).includes(resourceRef))
    .flatMap((st) => [st.Action].flat())
    .sort();

const tableByName = (tableName: string) => {
  const tables = template.findResources('AWS::DynamoDB::Table');
  const entry = Object.values(tables).find((t) => t.Properties.TableName === tableName);
  expect(entry, tableName).toBeDefined();
  return entry!;
};

describe('DynamoDB tables', () => {
  it('keeps both tables retained + deletion-protected (PK/SK single-table)', () => {
    for (const tableName of [
      'slackline-timer-v1-relay-prod',
      'slackline-timer-v1-competition-prod',
    ]) {
      template.hasResource('AWS::DynamoDB::Table', {
        DeletionPolicy: 'Retain',
        Properties: Match.objectLike({
          TableName: tableName,
          DeletionProtectionEnabled: true,
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }),
      });
    }
  });

  // M5: deletion protection does not undo a bad seed/advance or a bulk delete;
  // relay rows are 20-min ephemera and stay without PITR.
  it('enables 35-day PITR on the competition table only', () => {
    expect(
      tableByName('slackline-timer-v1-competition-prod').Properties
        .PointInTimeRecoverySpecification,
    ).toEqual({ PointInTimeRecoveryEnabled: true, RecoveryPeriodInDays: 35 });
    expect(
      tableByName('slackline-timer-v1-relay-prod').Properties.PointInTimeRecoverySpecification,
    ).toBeUndefined();
  });

  it('expires relay connection rows via the ddb_ttl attribute', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'slackline-timer-v1-relay-prod',
      TimeToLiveSpecification: { AttributeName: 'ddb_ttl', Enabled: true },
    });
  });
});

describe('photo CDN', () => {
  it('never exposes the photos bucket publicly', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        BucketName: 'slackline-timer-v1-photos-prod',
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      }),
    });
  });

  // Housekeeping insurance against orphaned content-hashed upload keys (an
  // athlete's replaced photo is never dereferenced). Time-based expiry scoped
  // to the photos/ prefix, well beyond the event access window.
  it('expires stale photos/ objects after 90 days', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'slackline-timer-v1-photos-prod',
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            Prefix: 'photos/',
            ExpirationInDays: 90,
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          }),
        ]),
      },
    });
  });

  it('serves reads only via signed URLs (trusted key group, GET/HEAD, https)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          TrustedKeyGroups: [Match.anyValue()],
          AllowedMethods: ['GET', 'HEAD'],
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  it('attaches the managed SECURITY_HEADERS response headers policy', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Comment: Match.stringLikeRegexp('athlete photos'),
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: '67f7725c-6f97-4210-82d7-5512b31e9d03',
        }),
      }),
    });
  });

  it('grants s3:PutObject to the photoUpload function only', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const putObjectPolicies = Object.keys(policies).filter((logicalId) =>
      JSON.stringify(policies[logicalId].Properties.PolicyDocument).includes('s3:PutObject'),
    );
    expect(putObjectPolicies).toHaveLength(1);
    expect(putObjectPolicies[0]).toContain('PhotoUploadFunction');
  });

  // grantPut would add PutObjectLegalHold/Retention/Tagging on bucket/*, each
  // signable into the presigned POST.
  it('scopes photoUpload to exactly s3:PutObject on photos/*', () => {
    const s3Statements = statementsOf('PhotoUploadFunction').filter((st) =>
      [st.Action].flat().some((a) => a.startsWith('s3:')),
    );
    expect(s3Statements).toHaveLength(1);
    expect(s3Statements[0].Action).toBe('s3:PutObject');
    const resource = JSON.stringify(s3Statements[0].Resource);
    expect(resource).toContain('PhotosBucket');
    expect(resource).toContain('/photos/*');
  });
});

describe('Lambdas', () => {
  it(`synthesizes ${LAMBDA_COUNT} functions, each with its own 30-day log group`, () => {
    template.resourceCountIs('AWS::Lambda::Function', LAMBDA_COUNT);
    template.resourceCountIs('AWS::Logs::LogGroup', LAMBDA_COUNT);
    for (const logGroup of Object.values(template.findResources('AWS::Logs::LogGroup'))) {
      expect(logGroup.Properties.RetentionInDays).toBe(30);
    }
  });

  // Physical names are explicit kebab-case (handler-folder slug), not the
  // synthesized SlacklineTimerV1Stack-<idBase><hash>, so ops can find a function
  // or log group by name. Construct ids (CFN logical IDs) stay PascalCase.
  it('gives each function + log group an explicit kebab-case physical name', () => {
    const dirs = [
      'authorizer',
      'connectionHandler',
      'messageHandler',
      'httpAuthorizer',
      'competitions',
      'athletes',
      'times',
      'matches',
      'scores',
      'rankings',
      'photoUpload',
      'createReadToken',
      'managers',
    ];
    for (const dir of dirs) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `slackline-timer-v1-${dir}-prod`,
      });
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: `/aws/lambda/slackline-timer-v1-${dir}-prod`,
      });
    }
  });

  it('gives every function the base env, incl. the WS fan-out endpoint', () => {
    for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
      expect(Object.keys(fn.Properties.Environment.Variables)).toEqual(
        expect.arrayContaining([
          'COGNITO_USER_POOL_ID',
          'COGNITO_CLIENT_ID',
          'COGNITO_TIMER_GROUP',
          'SPEEDLINE_TIMER_TABLE',
          'COMPETITION_TABLE',
          'PHOTOS_BUCKET',
          'PHOTO_CDN_DOMAIN',
          'PHOTO_KEY_PAIR_ID',
          'WS_API_ENDPOINT',
        ]),
      );
    }
  });

  it('enables source maps at runtime so bundled maps resolve stack traces', () => {
    for (const [id, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
      expect(fn.Properties.Environment.Variables.NODE_OPTIONS, id).toBe('--enable-source-maps');
    }
  });

  // The runtime is a maintenance liability, not just a config value: an
  // unnoticed EOL version keeps deploying green while going unpatched (nodejs20
  // sat here past its end-of-life). Pin it so the bump is a deliberate edit.
  it('runs every function on the same supported Node runtime', () => {
    for (const [id, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
      expect(fn.Properties.Runtime, id).toBe('nodejs24.x');
    }
  });

  it('grants relay access + WS fan-out to messageHandler and the db_update writers', () => {
    const writers = [
      'CompetitionsFunction',
      'AthletesFunction',
      'TimesFunction',
      'MatchesFunction',
      'ScoresFunction',
    ];
    for (const id of ['MessageHandlerFunction', ...writers]) {
      const doc = fnPolicy(id);
      expect(doc, id).toContain('SpeedlineTimerTable');
      expect(doc, id).toContain('execute-api:ManageConnections');
    }
    for (const id of writers) {
      expect(fnPolicy(id), id).toContain('CompetitionTable');
    }
    expect(fnPolicy('MessageHandlerFunction')).not.toContain('CompetitionTable');
  });

  // core/broadcast.ts only lists a session's rows (db.getAllConnections → Query)
  // and prunes stale ones (db.removeConnection → DeleteItem).
  it('limits the writers to relay Query + DeleteItem', () => {
    for (const id of [
      'CompetitionsFunction',
      'AthletesFunction',
      'TimesFunction',
      'MatchesFunction',
      'ScoresFunction',
    ]) {
      expect(actionsOn(id, 'SpeedlineTimerTable'), id).toEqual([
        'dynamodb:DeleteItem',
        'dynamodb:Query',
      ]);
    }
  });

  // Grant items share the COMP# partition with every other entity, so a narrower
  // grant would need per-SK-prefix key conditions.
  it('keeps managers full read-write on the competition table', () => {
    const actions = actionsOn('ManagersFunction', 'CompetitionTable');
    for (const a of ['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query'])
      expect(actions).toContain(a);
  });

  // ADR 0053: a grant revoke closes the sub's sockets via core/broadcast.ts
  // disconnectSession — list the session (Query), close (ManageConnections),
  // prune a 410'd row (DeleteItem). Nothing else on the relay.
  it('limits managers to relay Query + DeleteItem plus ManageConnections', () => {
    expect(actionsOn('ManagersFunction', 'SpeedlineTimerTable')).toEqual([
      'dynamodb:DeleteItem',
      'dynamodb:Query',
    ]);
    expect(fnPolicy('ManagersFunction')).toContain('execute-api:ManageConnections');
  });

  // L3: core/offline.ts gates the offline branches (incl. the `local-dev`
  // operator bypass) at runtime; this pins that no offline-only key reaches a
  // deployed function. Derived from scripts/offlineEnv.mjs so a new offline key
  // is covered automatically; the allowlist is the keys prod sets too.
  it('carries no offline-harness-only env key on any function', () => {
    const SHARED_WITH_PROD = new Set([
      'SPEEDLINE_TIMER_TABLE',
      'COMPETITION_TABLE',
      'COGNITO_USER_POOL_ID',
      'COGNITO_CLIENT_ID',
      'COGNITO_TIMER_GROUP',
      'WS_API_ENDPOINT',
      'PHOTOS_BUCKET',
    ]);
    const offlineOnly = Object.keys(OFFLINE_ENV).filter((k) => !SHARED_WITH_PROD.has(k));
    expect(offlineOnly).toEqual(
      expect.arrayContaining([
        'IS_OFFLINE',
        'DYNAMODB_ENDPOINT',
        'S3_ENDPOINT',
        'READ_TOKEN_SECRET',
        'PHOTO_PRIVATE_KEY',
      ]),
    );
    for (const [id, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
      const keys = Object.keys(fn.Properties.Environment.Variables);
      expect(
        keys.filter((k) => offlineOnly.includes(k)),
        id,
      ).toEqual([]);
    }
  });

  it('keeps read-only roles free of writes and WS fan-out', () => {
    for (const id of [
      'AuthorizerFunction',
      'HttpAuthorizerFunction',
      'RankingsFunction',
      'PhotoUploadFunction',
      'CreateReadTokenFunction',
    ]) {
      const doc = fnPolicy(id);
      expect(doc, id).toContain('CompetitionTable');
      expect(doc, id).toContain('dynamodb:GetItem');
      expect(doc, id).not.toContain('dynamodb:PutItem');
      expect(doc, id).not.toContain('dynamodb:DeleteItem');
      expect(doc, id).not.toContain('SpeedlineTimerTable');
      expect(doc, id).not.toContain('execute-api:ManageConnections');
    }
  });

  it('injects secrets as SSM parameter names only, never values (ADR 0025)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    for (const [id, fn] of Object.entries(fns)) {
      const vars = fn.Properties.Environment.Variables;
      expect(vars, id).not.toHaveProperty('READ_TOKEN_SECRET');
      expect(vars, id).not.toHaveProperty('PHOTO_PRIVATE_KEY');
    }
    const varsOf = (prefix: string) => {
      const key = Object.keys(fns).find((id) => id.startsWith(prefix));
      expect(key, `function ${prefix}`).toBeDefined();
      return fns[key!].Properties.Environment.Variables;
    };
    for (const id of ['AuthorizerFunction', 'HttpAuthorizerFunction', 'CreateReadTokenFunction']) {
      expect(varsOf(id).READ_TOKEN_SECRET_PARAM, id).toBe('/slackline-timer-v1/read-token-secret');
    }
    for (const id of ['AthletesFunction', 'RankingsFunction']) {
      expect(varsOf(id).PHOTO_PRIVATE_KEY_PARAM, id).toBe('/slackline-timer-v1/photo-private-key');
    }
  });

  it('grants ssm:GetParameter to the secret consumers only', () => {
    const consumers = [
      'AuthorizerFunction',
      'HttpAuthorizerFunction',
      'CreateReadTokenFunction',
      'AthletesFunction',
      'RankingsFunction',
    ];
    const nonConsumers = [
      'ConnectionHandlerFunction',
      'MessageHandlerFunction',
      'CompetitionsFunction',
      'TimesFunction',
      'MatchesFunction',
      'ScoresFunction',
      'PhotoUploadFunction',
      'ManagersFunction',
    ];
    for (const id of consumers) expect(fnPolicy(id), id).toContain('ssm:GetParameter');
    for (const id of nonConsumers) expect(fnPolicy(id), id).not.toContain('ssm:GetParameter');
  });

  it('scopes connectionHandler to relay connection rows only', () => {
    const doc = fnPolicy('ConnectionHandlerFunction');
    expect(doc).toContain('SpeedlineTimerTable');
    expect(doc).toContain('dynamodb:PutItem');
    expect(doc).toContain('dynamodb:DeleteItem');
    // A $disconnect knows only its connectionId, so it reads the reverse map item
    // to resolve the session before deleting the pair (core/db.ts).
    expect(doc).toContain('dynamodb:GetItem');
    expect(doc).not.toContain('CompetitionTable');
    expect(doc).not.toContain('execute-api:ManageConnections');
  });

  // ADR 0031 §3 reserved-concurrency caps, applied now that eu-central-2 is at the
  // standard 1000 pool: authorizers 50, the relay messageHandler 100 (its own
  // larger cap after HWC 2026 — see the stack), the 5 entity writers 25, everything
  // else unreserved. Sum = 2×50 + 100 + 5×25 = 325, leaving 675 free.
  it('applies ADR 0031 §3 reserved-concurrency caps (authorizers 50, messageHandler 100, writers 25)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const reservedFor = (idBase: string): number | undefined => {
      const key = Object.keys(fns).find((id) => id.startsWith(idBase));
      expect(key, idBase).toBeDefined();
      return fns[key!].Properties.ReservedConcurrentExecutions;
    };
    for (const idBase of ['AuthorizerFunction', 'HttpAuthorizerFunction'])
      expect(reservedFor(idBase), idBase).toBe(50);
    expect(reservedFor('MessageHandlerFunction'), 'MessageHandlerFunction').toBe(100);
    for (const idBase of [
      'CompetitionsFunction',
      'AthletesFunction',
      'TimesFunction',
      'MatchesFunction',
      'ScoresFunction',
    ])
      expect(reservedFor(idBase), idBase).toBe(25);
    for (const idBase of [
      'ConnectionHandlerFunction',
      'RankingsFunction',
      'PhotoUploadFunction',
      'CreateReadTokenFunction',
      'ManagersFunction',
    ])
      expect(reservedFor(idBase), idBase).toBeUndefined();
  });
});

describe('WebSocket relay', () => {
  // WS authorizers have no result TTL (ADR 0022 status note); the identity
  // sources make API Gateway 401 a $connect missing either param before the
  // authorizer Lambda runs.
  it('requires BOTH query params as identity sources (401 before the Lambda)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'REQUEST',
      IdentitySource: [
        'route.request.querystring.Authorization',
        'route.request.querystring.sessionId',
      ],
    });
  });

  it('routes on $request.body.action with the three system routes', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'slackline-timer-v1-ws-prod',
      ProtocolType: 'WEBSOCKET',
      RouteSelectionExpression: '$request.body.action',
    });
  });

  // ADR 0031 §2 (resized 2026-07-23) — the WS stage bucket also meters the
  // outbound PostToConnection fan-out, so it must clear fanout-N posts per
  // relayed message (HWC 2026 measured ~300 posts/s peak, ~2000 burst on an
  // overlay mass-reconnect), while staying under the 2500 rps account cap.
  it('throttles the default route at 2000 rps / 2000 burst', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      ApiId: Match.anyValue(),
      DefaultRouteSettings: {
        ThrottlingRateLimit: 2000,
        ThrottlingBurstLimit: 2000,
      },
    });
  });

  it('carries no per-route throttles on the WS stage', () => {
    const wsStages = template.findResources('AWS::ApiGatewayV2::Stage', {
      Properties: { ApiId: { Ref: Match.stringLikeRegexp('^WebsocketsApi') } },
    });
    const [ws] = Object.values(wsStages);
    expect(ws).toBeDefined();
    expect(ws.Properties.RouteSettings).toBeUndefined();
  });
});

describe('HTTP data plane', () => {
  it('caches the request authorizer for 60s (read-token revocation lag bound)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      Name: 'timerHttpAuthorizer',
      AuthorizerType: 'REQUEST',
      IdentitySource: ['$request.header.Authorization'],
      AuthorizerResultTtlInSeconds: 60,
      EnableSimpleResponses: true,
    });
  });

  // ADR 0031 §2 — the stage default now meters only requests matching no route;
  // every route carries its own bucket (below).
  it('throttles the default stage at 20 rps / 40 burst', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      DefaultRouteSettings: {
        ThrottlingRateLimit: 20,
        ThrottlingBurstLimit: 40,
      },
    });
  });

  const httpStage = () => {
    const stages = template.findResources('AWS::ApiGatewayV2::Stage', {
      Properties: { ApiId: { Ref: Match.stringLikeRegexp('^HttpApi') } },
    });
    const entries = Object.entries(stages);
    expect(entries).toHaveLength(1);
    const [logicalId, res] = entries[0];
    return {
      logicalId,
      dependsOn: (res.DependsOn ?? []) as string[],
      routeSettings: res.Properties.RouteSettings as Record<
        string,
        { ThrottlingRateLimit: number; ThrottlingBurstLimit: number }
      >,
    };
  };
  const httpRoutes = () =>
    Object.entries(template.findResources('AWS::ApiGatewayV2::Route')).filter(
      ([, r]) => !String(r.Properties.RouteKey).startsWith('$'),
    );

  // M1: per-route buckets so an overlay-read flood cannot drain the writes. The
  // numbers are pinned literally; re-sizing them is a deliberate test edit.
  it('throttles every route by class (write 10/20, read 30/60, roster 5/10, admin 2/5)', () => {
    const C = '/competitions';
    const WRITE = { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 };
    const READ = { ThrottlingRateLimit: 30, ThrottlingBurstLimit: 60 };
    const ROSTER = { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 };
    const ADMIN = { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 };
    expect(httpStage().routeSettings).toEqual({
      [`GET ${C}`]: READ,
      [`GET ${C}/{compId}`]: READ,
      [`GET ${C}/{compId}/athletes`]: READ,
      [`GET ${C}/{compId}/athletes/{athleteId}`]: READ,
      [`GET ${C}/{compId}/times`]: READ,
      [`GET ${C}/{compId}/scores`]: READ,
      [`GET ${C}/{compId}/matches`]: READ,
      [`GET ${C}/{compId}/rankings/{round}`]: READ,
      [`POST ${C}/{compId}/times`]: WRITE,
      [`PUT ${C}/{compId}/times/{timeId}`]: WRITE,
      [`DELETE ${C}/{compId}/times/{timeId}`]: WRITE,
      [`POST ${C}/{compId}/scores`]: WRITE,
      [`PUT ${C}/{compId}/scores/{scoreId}`]: WRITE,
      [`DELETE ${C}/{compId}/scores/{scoreId}`]: WRITE,
      [`POST ${C}/{compId}/matches`]: WRITE,
      [`PUT ${C}/{compId}/matches/{matchId}`]: WRITE,
      [`DELETE ${C}/{compId}/matches/{matchId}`]: WRITE,
      [`POST ${C}/{compId}/athletes`]: ROSTER,
      [`PUT ${C}/{compId}/athletes/{athleteId}`]: ROSTER,
      [`DELETE ${C}/{compId}/athletes/{athleteId}`]: ROSTER,
      [`POST ${C}/{compId}/photo-uploads`]: ROSTER,
      [`POST ${C}`]: ADMIN,
      [`PUT ${C}/{compId}`]: ADMIN,
      [`POST ${C}/{compId}/revoke-read-tokens`]: ADMIN,
      [`POST ${C}/{compId}/read-tokens`]: ADMIN,
      [`POST ${C}/{compId}/matches/seed`]: ADMIN,
      [`POST ${C}/{compId}/matches/advance`]: ADMIN,
      [`GET ${C}/{compId}/managers`]: ADMIN,
      [`POST ${C}/{compId}/managers`]: ADMIN,
      [`DELETE ${C}/{compId}/managers/{sub}`]: ADMIN,
    });
  });

  it('keys RouteSettings by exactly the synthesized HTTP route keys', () => {
    const routeKeys = httpRoutes().map(([, r]) => r.Properties.RouteKey as string);
    expect(routeKeys).toHaveLength(HTTP_ROUTE_COUNT);
    expect(Object.keys(httpStage().routeSettings).sort()).toEqual(routeKeys.sort());
  });

  // A RouteSettings key naming a route CFN has not created yet fails the deploy
  // ("Unable to find Route by key").
  it('makes the HTTP stage depend on every HTTP route', () => {
    const { dependsOn } = httpStage();
    for (const [logicalId, r] of httpRoutes()) {
      expect(dependsOn, r.Properties.RouteKey as string).toContain(logicalId);
    }
  });

  it('exposes exactly the documented route surface', () => {
    const C = '/competitions';
    const expected = [
      // WS system routes
      '$connect',
      '$disconnect',
      '$default',
      // competitions
      `POST ${C}`,
      `GET ${C}`,
      `GET ${C}/{compId}`,
      `PUT ${C}/{compId}`,
      `POST ${C}/{compId}/revoke-read-tokens`,
      // athletes
      `GET ${C}/{compId}/athletes`,
      `POST ${C}/{compId}/athletes`,
      `GET ${C}/{compId}/athletes/{athleteId}`,
      `PUT ${C}/{compId}/athletes/{athleteId}`,
      `DELETE ${C}/{compId}/athletes/{athleteId}`,
      // times
      `GET ${C}/{compId}/times`,
      `POST ${C}/{compId}/times`,
      `PUT ${C}/{compId}/times/{timeId}`,
      `DELETE ${C}/{compId}/times/{timeId}`,
      // matches (incl. bracket seeding/advancement)
      `GET ${C}/{compId}/matches`,
      `POST ${C}/{compId}/matches`,
      `POST ${C}/{compId}/matches/seed`,
      `POST ${C}/{compId}/matches/advance`,
      `PUT ${C}/{compId}/matches/{matchId}`,
      `DELETE ${C}/{compId}/matches/{matchId}`,
      // scores
      `GET ${C}/{compId}/scores`,
      `POST ${C}/{compId}/scores`,
      `PUT ${C}/{compId}/scores/{scoreId}`,
      `DELETE ${C}/{compId}/scores/{scoreId}`,
      // rankings / photos / read tokens
      `GET ${C}/{compId}/rankings/{round}`,
      `POST ${C}/{compId}/photo-uploads`,
      `POST ${C}/{compId}/read-tokens`,
      // managers (per-competition ACL)
      `GET ${C}/{compId}/managers`,
      `POST ${C}/{compId}/managers`,
      `DELETE ${C}/{compId}/managers/{sub}`,
    ];
    const actual = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (r) => r.Properties.RouteKey as string,
    );
    expect(actual.sort()).toEqual([...expected].sort());
    expect(expected.filter((k) => !k.startsWith('$'))).toHaveLength(HTTP_ROUTE_COUNT);
  });

  // L13: defaultAuthorizer covers every route today; this pins it so a route
  // added with HttpNoneAuthorizer (or an override) fails.
  it('authorizes every HTTP route with the custom request authorizer', () => {
    const authorizers = template.findResources('AWS::ApiGatewayV2::Authorizer', {
      Properties: { Name: 'timerHttpAuthorizer' },
    });
    const [httpAuthorizerId] = Object.keys(authorizers);
    expect(httpAuthorizerId).toBeDefined();
    const httpRoutes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).filter(
      (r) => !String(r.Properties.RouteKey).startsWith('$'),
    );
    expect(httpRoutes).toHaveLength(HTTP_ROUTE_COUNT);
    for (const r of httpRoutes) {
      expect(r.Properties.AuthorizationType, r.Properties.RouteKey).toBe('CUSTOM');
      expect(r.Properties.AuthorizerId, r.Properties.RouteKey).toEqual({ Ref: httpAuthorizerId });
    }
  });

  it('authorizes WS $connect only; $disconnect/$default ride the admitted socket', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'));
    const byKey = (key: string) => {
      const route = routes.find((r) => r.Properties.RouteKey === key);
      expect(route, key).toBeDefined();
      return route!.Properties;
    };
    expect(byKey('$connect').AuthorizationType).toBe('CUSTOM');
    expect(byKey('$connect').AuthorizerId).toBeDefined();
    for (const key of ['$disconnect', '$default']) {
      expect(byKey(key).AuthorizationType ?? 'NONE', key).toBe('NONE');
    }
  });
});

// H3: a regional WAF ACL cannot attach to HTTP or WebSocket APIs (REST only), so
// the backend carries none; the default-OFF CLOUDFRONT ACL for the web
// distribution lives in the billing stack.
describe('AWS WAF', () => {
  it('provisions no WAFv2 resource and no WafEnabled parameter in the backend', () => {
    const { Resources, Parameters } = template.toJSON() as {
      Resources: Record<string, { Type: string }>;
      Parameters?: Record<string, unknown>;
    };
    const wafTypes = Object.values(Resources)
      .map((r) => r.Type)
      .filter((t) => t.startsWith('AWS::WAFv2::'));
    expect(wafTypes).toEqual([]);
    expect(Object.keys(Parameters ?? {})).not.toContain('WafEnabled');
  });
});

// L10: early warning for relay/authorizer throttling, relay errors, data-plane
// 5xx and log-ingest cost, on a topic in the stack's own region (alarm actions
// cannot cross regions; the billing topic is us-east-1).
describe('operational alarms', () => {
  const alarms = () =>
    Object.values(template.findResources('AWS::CloudWatch::Alarm')).map(
      (a) => a.Properties as Record<string, unknown>,
    );
  const alarmNamed = (name: string) => {
    const alarm = alarms().find((a) => a.AlarmName === `slackline-timer-v1-${name}-prod`);
    expect(alarm, name).toBeDefined();
    return alarm!;
  };
  const opsTopicId = () => {
    const topics = template.findResources('AWS::SNS::Topic', {
      Properties: { TopicName: 'slackline-timer-v1-ops-prod' },
    });
    const ids = Object.keys(topics);
    expect(ids).toHaveLength(1);
    return ids[0];
  };
  // `fnRef` for CDK Match assertions, `refTo` for vitest toMatchObject.
  const fnRef = (prefix: string) => ({ Ref: Match.stringLikeRegexp(`^${prefix}[0-9A-F]{8}$`) });
  const refTo = (prefix: string) => ({ Ref: expect.stringMatching(`^${prefix}[0-9A-F]{8}$`) });
  const lambdaStat = (id: string, fnPrefix: string, metricName: string, period: number) =>
    Match.objectLike({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/Lambda',
          MetricName: metricName,
          Dimensions: [{ Name: 'FunctionName', Value: fnRef(fnPrefix) }],
        },
        Period: period,
        Stat: 'Sum',
      },
      ReturnData: false,
    });
  const logStat = (id: string, logGroupPrefix: string) =>
    Match.objectLike({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: 'AWS/Logs',
          MetricName: 'IncomingBytes',
          Dimensions: [{ Name: 'LogGroupName', Value: fnRef(logGroupPrefix) }],
        },
        Period: 3600,
        Stat: 'Sum',
      },
      ReturnData: false,
    });

  it('subscribes the alert email to an ops topic in the backend region', () => {
    const topicId = opsTopicId();
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: ALERT_EMAIL,
      TopicArn: { Ref: topicId },
    });
  });

  it('synthesizes exactly five alarms, each notifying the ops topic and quiet on no data', () => {
    const topicId = opsTopicId();
    expect(alarms()).toHaveLength(5);
    for (const a of alarms()) {
      expect(a.AlarmActions, String(a.AlarmName)).toEqual([{ Ref: topicId }]);
      expect(a.TreatMissingData, String(a.AlarmName)).toBe('notBreaching');
      expect(a.EvaluationPeriods, String(a.AlarmName)).toBe(1);
      expect(a.DatapointsToAlarm, String(a.AlarmName)).toBe(1);
    }
  });

  it('alarms on any messageHandler throttle within 1 min', () => {
    expect(alarmNamed('message-handler-throttles')).toMatchObject({
      Namespace: 'AWS/Lambda',
      MetricName: 'Throttles',
      Dimensions: [{ Name: 'FunctionName', Value: refTo('MessageHandlerFunction') }],
      Statistic: 'Sum',
      Period: 60,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  it('alarms on any WS + HTTP authorizer throttle within 5 min', () => {
    const alarm = alarmNamed('authorizer-throttles');
    expect(alarm).toMatchObject({
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'slackline-timer-v1-authorizer-throttles-prod',
      Metrics: [
        Match.objectLike({ Expression: 'FILL(ws, 0) + FILL(http, 0)', ReturnData: true }),
        lambdaStat('ws', 'AuthorizerFunction', 'Throttles', 300),
        lambdaStat('http', 'HttpAuthorizerFunction', 'Throttles', 300),
      ],
    });
  });

  it('alarms on any messageHandler error within 5 min', () => {
    expect(alarmNamed('message-handler-errors')).toMatchObject({
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      Dimensions: [{ Name: 'FunctionName', Value: refTo('MessageHandlerFunction') }],
      Statistic: 'Sum',
      Period: 300,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  it('alarms on 5 or more HTTP API 5xx within 5 min', () => {
    expect(alarmNamed('http-api-5xx')).toMatchObject({
      Namespace: 'AWS/ApiGateway',
      MetricName: '5xx',
      Dimensions: [{ Name: 'ApiId', Value: refTo('HttpApi') }],
      Statistic: 'Sum',
      Period: 300,
      Threshold: 5,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    });
  });

  it('alarms when relay + authorizer log ingest exceeds 1 GiB in an hour', () => {
    expect(alarmNamed('log-ingest')).toMatchObject({
      Threshold: 1024 ** 3,
      ComparisonOperator: 'GreaterThanThreshold',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'slackline-timer-v1-log-ingest-prod',
      Metrics: [
        Match.objectLike({
          Expression: 'FILL(msg, 0) + FILL(wsAuth, 0) + FILL(httpAuth, 0)',
          ReturnData: true,
        }),
        logStat('msg', 'MessageHandlerFunctionLogGroup'),
        logStat('wsAuth', 'AuthorizerFunctionLogGroup'),
        logStat('httpAuth', 'HttpAuthorizerFunctionLogGroup'),
      ],
    });
  });
});

describe('outputs', () => {
  it('exports the three endpoints the web app + docs reference', () => {
    template.hasOutput('HttpApiUrl', Match.anyValue());
    template.hasOutput('WebsocketUrl', Match.anyValue());
    template.hasOutput('PhotoCdnDomain', Match.anyValue());
  });

  // The web build's CSP connect-src allows exactly this origin (ADR 0054), so
  // it must be the host createPresignedPost returns as `url`:
  // `https://<bucket>.s3.<region>.amazonaws.com/`, the bucket's regional name.
  it('exports the photo upload origin as the bucket regional domain', () => {
    template.hasOutput('PhotoUploadOrigin', {
      Value: {
        'Fn::Join': [
          '',
          [
            'https://',
            { 'Fn::GetAtt': [Match.stringLikeRegexp('^PhotosBucket'), 'RegionalDomainName'] },
          ],
        ],
      },
    });
  });
});

// Assert-the-rule (same shape as the ADR 0025 "no secret values in env" test
// above): the Cognito pool identity enters through stack props, and a missing
// key must stop `cdk synth` rather than fall back to a literal. A re-hardcoded
// pool id would still satisfy the value assertions, so the fail-fast half is
// what pins the rule — keep both.
describe('Cognito identity is deployment config, never a committed literal', () => {
  const CONTEXT_KEYS = {
    COGNITO_USER_POOL_ID: 'cognitoUserPoolId',
    COGNITO_CLIENT_ID: 'cognitoClientId',
    COGNITO_TIMER_GROUP: 'cognitoTimerGroup',
    COGNITO_REGION: 'cognitoRegion',
  } as const;
  type CognitoEnvKey = keyof typeof CONTEXT_KEYS;
  const ENV_KEYS = Object.keys(CONTEXT_KEYS) as CognitoEnvKey[];

  const FIXTURES: Record<CognitoEnvKey, string> = {
    COGNITO_USER_POOL_ID: COGNITO.userPoolId,
    COGNITO_CLIENT_ID: COGNITO.clientId,
    COGNITO_TIMER_GROUP: COGNITO.timerGroup,
    COGNITO_REGION: COGNITO.region,
  };

  it('injects the resolved values into every function env under the frozen key names', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(fns)).toHaveLength(LAMBDA_COUNT);
    for (const [id, fn] of Object.entries(fns)) {
      const vars = fn.Properties.Environment.Variables as Record<string, string>;
      for (const key of ENV_KEYS) {
        expect(vars[key], `${id}.${key}`).toBe(FIXTURES[key]);
      }
    }
  });

  // COGNITO_DOMAIN is the web build's business (the hosted-UI redirect);
  // carrying it here would grow the Lambda contract for nothing.
  it('does not leak the web-only hosted-UI domain into the Lambda contract', () => {
    for (const [id, fn] of Object.entries(template.findResources('AWS::Lambda::Function'))) {
      expect(fn.Properties.Environment.Variables, id).not.toHaveProperty('COGNITO_DOMAIN');
    }
  });

  it('scopes the managers ListUsers grant to the resolved pool, in the deploy account', () => {
    expect(fnPolicy('ManagersFunction')).toContain(
      `arn:aws:cognito-idp:${COGNITO.region}:111111111111:userpool/${COGNITO.userPoolId}`,
    );
  });

  // The real app (createApp), not a hand-built stack: the resolution lives in
  // infra/app.ts. app.ts loads `.env.deploy` at import on an operator machine,
  // so each case deletes the env keys rather than assume they are unset.
  const synthApp = (context: Record<string, unknown>) =>
    createApp({
      'aws:cdk:bundling-stacks': [],
      billingAlertEmail: 'billing-alerts@example.org',
      ...context,
    });

  const cognitoContext = (omit?: CognitoEnvKey) =>
    Object.fromEntries(
      ENV_KEYS.filter((k) => k !== omit).map((k) => [CONTEXT_KEYS[k], FIXTURES[k]]),
    );

  it.each(ENV_KEYS)('fails synth with an actionable error when %s is absent', (missing) => {
    const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
    for (const k of ENV_KEYS) delete process.env[k];
    try {
      expect(() => synthApp(cognitoContext(missing))).toThrow(
        new RegExp(`Missing required deployment config "${missing}"[\\s\\S]*\\.env\\.deploy`),
      );
      expect(() => synthApp(cognitoContext(missing))).toThrow(
        new RegExp(`-c ${CONTEXT_KEYS[missing]}=`),
      );
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  });

  it('accepts the values from CDK context, and from the environment as the fallback', () => {
    const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
    for (const k of ENV_KEYS) delete process.env[k];
    try {
      expect(() => synthApp(cognitoContext())).not.toThrow();
      for (const k of ENV_KEYS) process.env[k] = FIXTURES[k];
      expect(() => synthApp({})).not.toThrow();
    } finally {
      for (const k of ENV_KEYS) delete process.env[k];
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  });
});
