import { CfnCondition, CfnParameter, Fn, Stack } from 'aws-cdk-lib';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';

// ADR 0031 §5: authored default-OFF. Baseline posture is API throttling + Budgets;
// WAF is provisioned only during observed abuse because its standing monthly cost
// can rival the app's idle bill. Shared rule set for REGIONAL (API Gateway) and
// CLOUDFRONT (must be created in us-east-1). Enable/disable runbook: doc/dev/deploy.md §6.3.

// Per-IP request budget over the WAF 5-minute window. Sized well above a live
// admin + ~15 overlays refreshing on db_update (a browser source behind one NAT
// makes a few requests per refresh), far below a flood — the same posture as the
// API GW throttle, but per-source and only active when enabled.
const RATE_LIMIT_PER_5MIN = 2000;

/**
 * A CfnParameter("WafEnabled": true|false, default false) + the matching
 * CfnCondition. Gate every WAF resource on the returned condition
 * (`cfnResource.cfnOptions.condition = enabled`) so the default deploy synthesizes
 * NO WAF resources — no standing cost until ops flips the flag.
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

/**
 * The rate-based WebACL for one `scope` — see the header for where each scope
 * must be created. `condition` gates the resource (nothing synthesizes at the
 * defaults); `namePrefix` keeps the CloudWatch metric names unique per scope,
 * since one account can carry both.
 */
export function makeRateBasedWebAcl(
  stack: Stack,
  id: string,
  opts: { scope: 'REGIONAL' | 'CLOUDFRONT'; namePrefix: string; condition: CfnCondition },
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
