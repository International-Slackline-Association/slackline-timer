import {
  Aws,
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

// Security review M6, slice 1. The enforced CSP carries only directives that need
// no deployment origins; the full policy is in Report-Only until the build-time
// meta CSP (slice 2) enforces exact origins. No surface is framed: OBS / vMix
// browser sources load overlays top-level.
export const WEB_CSP_ENFORCED = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  // Only form submissions: the Hosted-UI sign-in is a window.location navigation
  // (Amplify signInWithRedirect) and the admin forms preventDefault into fetch.
  "form-action 'self'",
].join('; ');

// Browser-console reports only (no report endpoint). connect-src stays generic
// (https:/wss:) because the API, WS, Cognito and S3 origins are deploy outputs;
// the 127.0.0.1/localhost entries are the H2R bridge on the operator machine.
export const WEB_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  // MUI/emotion inject <style> tags at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "worker-src 'none'",
].join('; ');

export interface SlacklineTimerV1WebStackProps extends StackProps {
  stage: string;
}

/**
 * The web frontend hosting: a private S3 bucket served through CloudFront (OAC),
 * its own stack in eu-central-1 (the backend runs in eu-central-2 — see
 * infra/app.ts). `vite build` output is synced to the bucket by
 * web/internals/deployToS3.mjs; SPA deep links (403/404) rewrite to /index.html
 * so react-router handles them client-side.
 */
export class SlacklineTimerV1WebStack extends Stack {
  constructor(scope: Construct, id: string, props: SlacklineTimerV1WebStackProps) {
    super(scope, id, props);
    const { stage } = props;

    // Default-OFF WAF attach point (ADR 0031 §5): ops passes the us-east-1
    // CLOUDFRONT WebACL ARN at deploy time. Empty keeps no WAF association.
    // Full enable flow is centralized in infra/waf.ts + doc/dev/deploy.md §6.3.
    const wafWebAclArn = new CfnParameter(this, 'WafWebAclArn', {
      type: 'String',
      default: '',
      description:
        'CLOUDFRONT-scoped WAF WebACL ARN (from the billing stack WebAclArn output) to front the web dist. Empty = no WAF (ADR 0031 §5).',
    });
    const webAclId = Fn.conditionIf(
      new CfnCondition(this, 'WafWebAclProvided', {
        expression: Fn.conditionNot(Fn.conditionEquals(wafWebAclArn.valueAsString, '')),
      }).logicalId,
      wafWebAclArn.valueAsString,
      Aws.NO_VALUE,
    ).toString();

    const bucket = new Bucket(this, 'WebBucket', {
      bucketName: `slackline-timer-v1-ui-${stage}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // Build artifacts are rebuildable, so destroy should remove the bucket too.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new ResponseHeadersPolicy(this, 'WebSecurityHeaders', {
      responseHeadersPolicyName: `slackline-timer-v1-web-security-${stage}`,
      comment: 'HSTS, nosniff, no framing, same-origin referrer, CSP (M6)',
      securityHeadersBehavior: {
        // includeSubDomains off: the host is a *.cloudfront.net name we do not own.
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          preload: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        contentSecurityPolicy: { contentSecurityPolicy: WEB_CSP_ENFORCED, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Content-Security-Policy-Report-Only',
            value: WEB_CSP_REPORT_ONLY,
            override: true,
          },
        ],
      },
    });

    const distribution = new Distribution(this, 'WebDistribution', {
      comment: `slackline-timer-v1 web frontend (${stage})`,
      priceClass: PriceClass.PRICE_CLASS_100,
      webAclId,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: CachedMethods.CACHE_GET_HEAD,
        compress: true,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
      },
      // SPA: unknown paths are react-router routes, not real objects — serve the
      // app shell with a 200 so client-side routing takes over.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    new CfnOutput(this, 'WebBucketName', {
      description: 'S3 bucket holding the built web app (deployToS3.mjs target).',
      value: bucket.bucketName,
    });
    new CfnOutput(this, 'WebDistributionId', {
      description: 'CloudFront distribution id (deployToS3.mjs cache invalidation).',
      value: distribution.distributionId,
    });
    new CfnOutput(this, 'WebUrl', {
      description: 'Frontend URL — register as a Cognito callback + logout URL.',
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
