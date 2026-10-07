import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

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

// M6 slice 1: security headers on every web response. The enforced CSP is
// deployment-free; the full policy is Report-Only until the build-time CSP lands.
describe('web security headers', () => {
  const policy = () => {
    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
    const entries = Object.entries(policies);
    expect(entries).toHaveLength(1);
    const [id, res] = entries[0];
    return { id, config: res.Properties.ResponseHeadersPolicyConfig as Record<string, unknown> };
  };

  it('attaches the custom policy to the default behavior', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: { Ref: policy().id },
        }),
      }),
    });
  });

  it('sends HSTS 1 y, nosniff, DENY framing, same-origin referrer and the enforced CSP', () => {
    expect(policy().config.SecurityHeadersConfig).toEqual({
      StrictTransportSecurity: {
        AccessControlMaxAgeSec: 31536000,
        IncludeSubdomains: false,
        Preload: false,
        Override: true,
      },
      ContentTypeOptions: { Override: true },
      FrameOptions: { FrameOption: 'DENY', Override: true },
      ReferrerPolicy: { ReferrerPolicy: 'same-origin', Override: true },
      ContentSecurityPolicy: {
        ContentSecurityPolicy:
          "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
        Override: true,
      },
    });
  });

  it('sends the generic CSP as Report-Only', () => {
    expect(policy().config.CustomHeadersConfig).toEqual({
      Items: [
        {
          Header: 'Content-Security-Policy-Report-Only',
          Value:
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: https:; " +
            "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*; " +
            "font-src 'self' data:; media-src 'self' data:; worker-src 'none'",
          Override: true,
        },
      ],
    });
  });
});
