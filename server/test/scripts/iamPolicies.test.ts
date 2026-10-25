import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { EXTERNAL_POLICIES_KEY } from '../../infra/externalPolicies';

import {
  classifyDenial,
  pickProbeRole,
  planPolicies,
  resolveIntrinsics,
  retainPolicies,
  samePolicyDocument,
  unionDocuments,
} from '../../scripts/iam/lib/iamPolicies.mjs';

const resources = [
  {
    LogicalResourceId: 'ConnectionHandlerFunctionServiceRole1A2B3C4D',
    ResourceType: 'AWS::IAM::Role',
    PhysicalResourceId: 'slackline-timer-v1-ConnectionHandlerFunctionService-MVYHCD69a9xV',
  },
  {
    LogicalResourceId: 'ConnectionHandlerFunctionServiceRoleDefaultPolicy46F951AC',
    ResourceType: 'AWS::IAM::Policy',
    PhysicalResourceId: 'slack-Conne-nomwvnpQJBXY',
  },
  {
    LogicalResourceId: 'TimesFunctionServiceRoleEDA83B47',
    ResourceType: 'AWS::IAM::Role',
    PhysicalResourceId: 'slackline-timer-v1-TimesFunctionServiceRoleEDA83B47-yeW2nSlXBled',
  },
];

describe('pickProbeRole', () => {
  it('returns the physical name of the one role whose logical id has the prefix', () => {
    expect(pickProbeRole(resources, 'ConnectionHandlerFunction')).toBe(
      'slackline-timer-v1-ConnectionHandlerFunctionService-MVYHCD69a9xV',
    );
  });

  it('ignores non-role resources sharing the prefix', () => {
    expect(pickProbeRole(resources, 'ConnectionHandlerFunctionServiceRole')).toBe(
      'slackline-timer-v1-ConnectionHandlerFunctionService-MVYHCD69a9xV',
    );
  });

  it('throws when no role matches', () => {
    expect(() => pickProbeRole(resources, 'Nope')).toThrow(/no AWS::IAM::Role/);
  });

  it('throws when the prefix is ambiguous', () => {
    expect(() => pickProbeRole(resources, '')).toThrow(/2 roles match/);
  });
});

describe('samePolicyDocument', () => {
  const doc = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['dynamodb:PutItem'], Resource: 'arn:x' }],
  };

  it('ignores key order', () => {
    const reordered = {
      Statement: [{ Resource: 'arn:x', Action: ['dynamodb:PutItem'], Effect: 'Allow' }],
      Version: '2012-10-17',
    };
    expect(samePolicyDocument(doc, reordered)).toBe(true);
  });

  it('accepts the URL-encoded string form IAM can return', () => {
    expect(samePolicyDocument(encodeURIComponent(JSON.stringify(doc)), doc)).toBe(true);
  });

  it('sees a changed action', () => {
    const changed = structuredClone(doc);
    changed.Statement[0].Action = ['dynamodb:GetItem'];
    expect(samePolicyDocument(doc, changed)).toBe(false);
  });
});

describe('classifyDenial', () => {
  it('names an SCP denial', () => {
    expect(
      classifyDenial(
        'An error occurred (AccessDenied) when calling the PutRolePolicy operation: User: x is not authorized to perform: iam:PutRolePolicy on resource: role y with an explicit deny in a service control policy: arn:aws:organizations::1:policy/o-1/service_control_policy/p-1',
      ),
    ).toBe('scp');
  });

  it('names an identity-policy denial', () => {
    expect(
      classifyDenial(
        'User: x is not authorized to perform: iam:PutRolePolicy on resource: role y with an explicit deny in an identity-based policy: arn:aws:iam::1:policy/p',
      ),
    ).toBe('identity');
  });

  it('leaves anything else unclassified', () => {
    expect(
      classifyDenial('ExpiredToken: the security token included in the request is expired'),
    ).toBe('other');
  });
});

const ctx = {
  partition: 'aws',
  region: 'eu-central-2',
  account: '111111111111',
  resources: [
    ...resources,
    {
      LogicalResourceId: 'SpeedlineTimerTableDF16FB4F',
      ResourceType: 'AWS::DynamoDB::Table',
      PhysicalResourceId: 'slackline-timer-v1-relay-prod',
    },
    {
      LogicalResourceId: 'PhotosBucket2AC9D1F0',
      ResourceType: 'AWS::S3::Bucket',
      PhysicalResourceId: 'slackline-timer-v1-photos-prod',
    },
    {
      LogicalResourceId: 'WebsocketsApi4FAB1BFB',
      ResourceType: 'AWS::ApiGatewayV2::Api',
      PhysicalResourceId: 'abc123',
    },
  ],
};

describe('resolveIntrinsics', () => {
  it('resolves Ref, the pseudo parameters and Fn::Join', () => {
    expect(
      resolveIntrinsics(
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':execute-api:',
              { Ref: 'AWS::Region' },
              ':',
              { Ref: 'AWS::AccountId' },
              ':',
              { Ref: 'WebsocketsApi4FAB1BFB' },
              '/*',
            ],
          ],
        },
        ctx,
      ),
    ).toBe('arn:aws:execute-api:eu-central-2:111111111111:abc123/*');
  });

  it('builds table and bucket ARNs from Fn::GetAtt', () => {
    expect(resolveIntrinsics({ 'Fn::GetAtt': ['SpeedlineTimerTableDF16FB4F', 'Arn'] }, ctx)).toBe(
      'arn:aws:dynamodb:eu-central-2:111111111111:table/slackline-timer-v1-relay-prod',
    );
    expect(resolveIntrinsics({ 'Fn::GetAtt': ['PhotosBucket2AC9D1F0', 'Arn'] }, ctx)).toBe(
      'arn:aws:s3:::slackline-timer-v1-photos-prod',
    );
  });

  it('walks nested documents and leaves literals alone', () => {
    expect(
      resolveIntrinsics(
        { Statement: [{ Action: 'x', Resource: [{ Ref: 'WebsocketsApi4FAB1BFB' }, 'literal'] }] },
        ctx,
      ),
    ).toEqual({ Statement: [{ Action: 'x', Resource: ['abc123', 'literal'] }] });
  });

  it('refuses what it cannot resolve rather than writing a wrong ARN', () => {
    expect(() => resolveIntrinsics({ Ref: 'Missing' }, ctx)).toThrow(/Missing/);
    expect(() =>
      resolveIntrinsics({ 'Fn::GetAtt': ['WebsocketsApi4FAB1BFB', 'Arn'] }, ctx),
    ).toThrow(/AWS::ApiGatewayV2::Api/);
    expect(() => resolveIntrinsics({ 'Fn::Sub': 'x' }, ctx)).toThrow(/Fn::Sub/);
  });
});

describe('unionDocuments', () => {
  const a = { Effect: 'Allow', Action: 'dynamodb:PutItem', Resource: 'arn:t' };
  const b = { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: 'arn:t' };

  it('keeps every statement of both, once', () => {
    expect(
      unionDocuments(
        { Version: '2012-10-17', Statement: [a] },
        {
          Version: '2012-10-17',
          Statement: [{ Resource: 'arn:t', Action: 'dynamodb:PutItem', Effect: 'Allow' }, b],
        },
      ),
    ).toEqual({ Version: '2012-10-17', Statement: [a, b] });
  });
});

describe('planPolicies', () => {
  const external = {
    ConnectionHandlerFunctionServiceRoleDefaultPolicy46F951AC: {
      PolicyName: 'ConnectionHandlerFunctionServiceRoleDefaultPolicy46F951AC',
      Roles: [{ Ref: 'ConnectionHandlerFunctionServiceRole1A2B3C4D' }],
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'dynamodb:Query',
            Resource: { 'Fn::GetAtt': ['SpeedlineTimerTableDF16FB4F', 'Arn'] },
          },
        ],
      },
    },
  };

  it('resolves each policy onto its role', () => {
    expect(planPolicies(external, ctx)).toEqual([
      {
        roleName: 'slackline-timer-v1-ConnectionHandlerFunctionService-MVYHCD69a9xV',
        policyName: 'ConnectionHandlerFunctionServiceRoleDefaultPolicy46F951AC',
        document: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'dynamodb:Query',
              Resource:
                'arn:aws:dynamodb:eu-central-2:111111111111:table/slackline-timer-v1-relay-prod',
            },
          ],
        },
      },
    ]);
  });

  it('refuses a document past the 10,240-character inline-policy quota', () => {
    const big = structuredClone(external);
    big.ConnectionHandlerFunctionServiceRoleDefaultPolicy46F951AC.PolicyDocument.Statement[0].Action =
      'x'.repeat(10_300);
    expect(() => planPolicies(big, ctx)).toThrow(/10240/);
  });
});

describe('retainPolicies', () => {
  const template = {
    Resources: {
      Role: { Type: 'AWS::IAM::Role', Properties: { a: 1 } },
      PolicyA: { Type: 'AWS::IAM::Policy', Properties: { b: 2 } },
      PolicyB: {
        Type: 'AWS::IAM::Policy',
        Properties: { c: 3 },
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      },
    },
  };

  it('marks only the inline policies Retain, reporting the ones it changed', () => {
    const { template: out, changed } = retainPolicies(template);
    expect(changed).toEqual(['PolicyA']);
    expect(out.Resources.PolicyA).toEqual({
      Type: 'AWS::IAM::Policy',
      Properties: { b: 2 },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    expect(out.Resources.Role).toEqual(template.Resources.Role);
    expect(out.Resources.PolicyB).toEqual(template.Resources.PolicyB);
  });

  it('does not mutate its input', () => {
    retainPolicies(template);
    expect(template.Resources.PolicyA).not.toHaveProperty('DeletionPolicy');
  });
});

describe('syncLambdaPolicies.mjs', () => {
  it('reads the Metadata key infra/externalPolicies.ts writes', () => {
    const script = readFileSync(
      new URL('../../scripts/iam/syncLambdaPolicies.mjs', import.meta.url),
      'utf8',
    );
    expect(script).toContain(`const EXTERNAL_POLICIES_KEY = '${EXTERNAL_POLICIES_KEY}';`);
  });
});
