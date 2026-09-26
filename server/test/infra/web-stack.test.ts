import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';

import { SlacklineTimerV1WebStack } from '../../infra/web-stack';

const app = new App();
const stack = new SlacklineTimerV1WebStack(app, 'slackline-timer-v1-web', {
  stage: 'prod',
  env: { region: 'eu-central-1', account: '111111111111' },
});
const template = Template.fromStack(stack);

describe('web frontend stack', () => {
  it('serves a private bucket named for the stage', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'slackline-timer-v1-ui-prod',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('rewrites SPA deep links (403/404) to the app shell with a 200', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: '/index.html',
          }),
        ]),
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  it('exports the deploy targets (bucket, distribution id, url)', () => {
    template.hasOutput('WebBucketName', Match.anyValue());
    template.hasOutput('WebDistributionId', Match.anyValue());
    template.hasOutput('WebUrl', Match.anyValue());
  });

  // ADR 0031 §5 — the CLOUDFRONT-scoped WAF WebACL (provisioned in the us-east-1
  // billing stack) attaches only when ops passes its ARN via WafWebAclArn. Default
  // empty → the distribution stays un-associated (no WAF, no standing cost).
  it('accepts a default-empty WafWebAclArn parameter and attaches it only when set', () => {
    template.hasParameter('WafWebAclArn', { Type: 'String', Default: '' });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        WebACLId: {
          'Fn::If': ['WafWebAclProvided', { Ref: 'WafWebAclArn' }, { Ref: 'AWS::NoValue' }],
        },
      }),
    });
  });
});
