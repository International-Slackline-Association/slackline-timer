import { CfnCondition, CfnParameter, Fn, Stack } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';

// ADR 0031 §5: authored default-OFF; its standing cost rivals the app's idle
// bill. CLOUDFRONT scope only (created in us-east-1): a regional ACL attaches to
// REST APIs only, not HTTP/WebSocket, so API-level WAF needs a CloudFront edge in
// front of the API. Runbook: doc/dev/deploy.md §6.3.

// Per-IP requests per WAF 5-minute window, on the SPA's static assets. A venue
// puts every client behind one NAT, so raise it before enabling during an event
// (doc/dev/deploy.md §6.3).
const RATE_LIMIT_PER_5MIN = 2000;

/**
 * The `WafEnabled` parameter (default false) + its condition. Gate every WAF
 * resource on it so the default deploy synthesizes none.
 */
export function defineWafToggle(stack: Stack): CfnCondition {
  const param = new CfnParameter(stack, 'WafEnabled', {
    type: 'String',
    allowedValues: ['true', 'false'],
    default: 'false',
    description:
      'Provision the (billable) rate-based WAF WebACL. Leave false unless responding to an observed abuse event (ADR 0031 §5).',
  });
  return new CfnCondition(stack, 'WafEnabledCondition', {
    expression: Fn.conditionEquals(param.valueAsString, 'true'),
  });
}

/** `namePrefix` keeps the CloudWatch metric names unique per ACL. */
export function makeRateBasedWebAcl(
  stack: Stack,
  id: string,
  opts: { scope: 'CLOUDFRONT'; namePrefix: string; condition: CfnCondition },
): CfnWebACL {
  const webAcl = new CfnWebACL(stack, id, {
    scope: opts.scope,
    defaultAction: { allow: {} },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: `${opts.namePrefix}-web-acl`,
      sampledRequestsEnabled: true,
    },
    rules: [
      {
        name: 'RateLimitPerIp',
        priority: 0,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: RATE_LIMIT_PER_5MIN,
            aggregateKeyType: 'IP',
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${opts.namePrefix}-rate-limit`,
          sampledRequestsEnabled: true,
        },
      },
      {
        name: 'AWSCommonRules',
        priority: 1,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: 'AWS',
            name: 'AWSManagedRulesCommonRuleSet',
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${opts.namePrefix}-common-rules`,
          sampledRequestsEnabled: true,
        },
      },
    ],
  });
  webAcl.cfnOptions.condition = opts.condition;
  return webAcl;
}
