import { describe, expect, it } from 'vitest';

import {
  classifyDenial,
  pickProbeRole,
  samePolicyDocument,
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
