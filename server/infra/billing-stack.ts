import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

import { defineWafToggle, makeRateBasedWebAcl } from './waf';

// The account cost backstop (ADR 0031 §1): a monthly AWS Budget + a CloudWatch
// EstimatedCharges alarm, both notifying one SNS email. Built first so any
// missing app-level control (throttling, concurrency caps) is non-catastrophic.
//
// Why its OWN stack in us-east-1: CloudWatch only publishes the billing metric
// AWS/Billing EstimatedCharges in us-east-1, so the alarm (and the topic it
// targets) MUST live there — the backend runs in eu-central-2. AWS Budgets is a
// global service reachable from any region; co-locating the CfnBudget here keeps
// every billing resource in one reproducible, infra-test-pinned place.

// Monthly ceiling, denominated in USD. AWS Budgets only accepts USD in this
// account (it rejects EUR: "not in the supported unit set: [USD]"), and the
// CloudWatch EstimatedCharges metric is USD-only too — so USD is the single
// currency of truth for both backstops. $55 ≈ €50 with round headroom.
const BUDGET_LIMIT_USD = 55;
const ALARM_THRESHOLD_USD = 55;

export interface BillingStackProps extends StackProps {
  stage: string;
}

export class BillingStack extends Stack {
  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, props);
    const { stage } = props;

    // The cost-alert subscriber is DEPLOYMENT CONFIG, not source: this repo is
    // public, so it carries no mailbox, and the right subscriber differs per
    // operator (an ISA distribution list beats any individual). Required, not
    // defaulted — a silent fallback would subscribe a dead address and turn the
    // account cost backstop into a no-op:
    // Set BILLING_ALERT_EMAIL in the ignored repo-root `.env.deploy`, or pass
    //   cdk deploy slackline-timer-v1-billing -c billingAlertEmail=ops@example.org
    const notifyEmail =
      (this.node.tryGetContext('billingAlertEmail') as string | undefined) ??
      process.env.BILLING_ALERT_EMAIL;
    if (!notifyEmail) {
      throw new Error(
        'Missing required CDK context "billingAlertEmail" (the address subscribed to the cost alerts). ' +
          'Set BILLING_ALERT_EMAIL in .env.deploy (see .env.deploy.example) or pass -c billingAlertEmail=<address> — see doc/dev/deploy.md.',
      );
    }

    const topic = new Topic(this, 'BillingAlarmTopic', {
      topicName: `slackline-timer-v1-billing-${stage}`,
      displayName: 'slackline-timer-v1 cost alerts',
    });
    topic.addSubscription(new EmailSubscription(notifyEmail));

    // Monthly cost Budget with 50/80/100% notifications on BOTH actual and
    // forecasted spend → the same email. Budgets delivers to email subscribers
    // directly (declared inline here), independent of the SNS topic — the topic
    // is the CloudWatch alarm's channel, not the Budget's.
    const percentThresholds = [50, 80, 100];
    const notificationsWithSubscribers = percentThresholds.flatMap((threshold) =>
      (['ACTUAL', 'FORECASTED'] as const).map((notificationType) => ({
        notification: {
          notificationType,
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: notifyEmail }],
      })),
    );

    new CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: `slackline-timer-v1-monthly-${stage}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: BUDGET_LIMIT_USD, unit: 'USD' },
      },
      notificationsWithSubscribers,
    });

    // CloudWatch billing alarm: AWS/Billing EstimatedCharges is a us-east-1-only
    // metric, published ~6h, currency USD. period 6h matches its cadence.
    const estimatedCharges = new Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: { Currency: 'USD' },
      statistic: 'Maximum',
      period: Duration.hours(6),
    });
    const alarm = new Alarm(this, 'EstimatedChargesAlarm', {
      alarmName: `slackline-timer-v1-estimated-charges-${stage}`,
      alarmDescription: `Account estimated charges exceeded US$${ALARM_THRESHOLD_USD} (≈ €50).`,
      metric: estimatedCharges,
      threshold: ALARM_THRESHOLD_USD,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      // Charges reset to 0 at the month boundary; treat gaps as not-breaching so
      // the alarm doesn't flap on a missing datapoint.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    alarm.addAlarmAction(new SnsAction(topic));

    // ── AWS WAF for CloudFront (ADR 0031 §5), authored default-OFF ──────────────
    // CloudFront-scoped WAF must be provisioned in us-east-1, so the WebACL for the
    // web CloudFront distribution rides in this us-east-1 stack (its regional
    // counterpart for the API GW endpoints lives in the eu-central-2 backend stack).
    // Gated on WafEnabled so a normal deploy provisions no WAF resource / no standing
    // cost. Enable: `cdk deploy slackline-timer-v1-billing --parameters WafEnabled=true`,
    // then attach the exported WebAclArn to the web stack (doc/dev/deploy.md §6.3).
    const wafEnabled = defineWafToggle(this);
    const webAcl = makeRateBasedWebAcl(this, 'CloudFrontWebAcl', {
      scope: 'CLOUDFRONT',
      namePrefix: `slackline-timer-v1-cf-${stage}`,
      condition: wafEnabled,
    });
    const aclArnOutput = new CfnOutput(this, 'WebAclArn', {
      description:
        'CLOUDFRONT-scoped WAF WebACL ARN — pass to the web stack as WafWebAclArn when enabling (ADR 0031 §5).',
      value: webAcl.attrArn,
    });
    aclArnOutput.condition = wafEnabled;
  }
}
