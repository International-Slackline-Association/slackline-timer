import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { BillingStack } from '../../infra/billing-stack';

// The cost backstop (ADR 0031 §1). Invariants pinned here: the $55 (≈€50)
// monthly Budget with 50/80/100% actual+forecast notifications, the us-east-1
// EstimatedCharges alarm at the same USD ceiling, and both routing to one SNS
// email topic. USD is the single currency of truth — AWS Budgets rejects EUR in
// this account. A silent revert of the ceiling or a dropped notification tier
// fails CI.
const NOTIFY_EMAIL = 'billing-alerts@example.org';
const app = new App({ context: { billingAlertEmail: NOTIFY_EMAIL } });
const stack = new BillingStack(app, 'slackline-timer-v1-billing', {
  stage: 'prod',
  env: { region: 'us-east-1', account: '111111111111' },
});
const template = Template.fromStack(stack);

describe('SNS alert topic', () => {
  it('has one topic subscribed by the ops email', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: NOTIFY_EMAIL,
    });
  });
});

describe('monthly cost Budget', () => {
  it('caps monthly cost at $55 (≈€50)', () => {
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: 55, Unit: 'USD' },
      }),
    });
  });

  it('notifies at 50/80/100% on BOTH actual and forecasted spend → the email', () => {
    const budgets = template.findResources('AWS::Budgets::Budget');
    const budget = Object.values(budgets)[0];
    const notifications = budget.Properties.NotificationsWithSubscribers as {
      Notification: { NotificationType: string; Threshold: number; ComparisonOperator: string };
      Subscribers: { SubscriptionType: string; Address: string }[];
    }[];

    // 3 thresholds × 2 notification types.
    expect(notifications).toHaveLength(6);
    const seen = notifications.map(
      (n) => `${n.Notification.NotificationType}@${n.Notification.Threshold}`,
    );
    for (const type of ['ACTUAL', 'FORECASTED']) {
      for (const threshold of [50, 80, 100]) {
        expect(seen).toContain(`${type}@${threshold}`);
      }
    }
    for (const n of notifications) {
      expect(n.Notification.ComparisonOperator).toBe('GREATER_THAN');
      expect(n.Subscribers).toEqual([{ SubscriptionType: 'EMAIL', Address: NOTIFY_EMAIL }]);
    }
  });
});

describe('EstimatedCharges billing alarm', () => {
  it('alarms on the USD-denominated us-east-1 billing metric at the €50-equivalent ceiling', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/Billing',
      MetricName: 'EstimatedCharges',
      Dimensions: [{ Name: 'Currency', Value: 'USD' }],
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 55,
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching',
    });
  });

  it('routes the alarm to the same SNS topic', () => {
    const topics = Object.keys(template.findResources('AWS::SNS::Topic'));
    expect(topics).toHaveLength(1);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: [{ Ref: topics[0] }],
    });
  });
});

// ADR 0031 §5 — the CLOUDFRONT-scoped WAF WebACL rides in this us-east-1 stack
// (CloudFront-scope WAF is us-east-1-only) so the web dist can attach it. Default-OFF:
// gated on WafEnabled, so a normal deploy provisions no WebACL / no standing cost.
describe('AWS WAF for CloudFront (default-OFF)', () => {
  it('exposes a WafEnabled parameter defaulting to false', () => {
    template.hasParameter('WafEnabled', {
      Type: 'String',
      Default: 'false',
      AllowedValues: ['true', 'false'],
    });
  });

  it('synthesizes one CLOUDFRONT-scoped WebACL gated on WafEnabled', () => {
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    const [id, acl] = Object.entries(template.findResources('AWS::WAFv2::WebACL'))[0];
    expect(acl.Condition, `${id} must be condition-gated`).toBe('WafEnabledCondition');
    expect(acl.Properties.Scope).toBe('CLOUDFRONT');
  });

  it('exports the WebACL ARN (to pass to the web stack) only when enabled', () => {
    const outputs = template.findOutputs('WebAclArn');
    expect(Object.keys(outputs)).toHaveLength(1);
    expect(outputs.WebAclArn.Condition).toBe('WafEnabledCondition');
  });
});
