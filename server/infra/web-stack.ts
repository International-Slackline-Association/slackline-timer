import {
  Aws,
  CfnCondition,
  CfnOutput,
  CfnParameter,
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
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

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
