import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

import { defineWafToggle, makeRateBasedWebAcl } from './waf';

// The account cost backstop (ADR 0031 §1): a monthly AWS Budget + an
// EstimatedCharges alarm. Its own stack because EstimatedCharges publishes only
// in us-east-1; the (global) Budget rides along.

// USD: Budgets rejects EUR on this account ("not in the supported unit set:
// [USD]") and EstimatedCharges is USD-only. $55 ≈ the €50 ceiling.
const BUDGET_LIMIT_USD = 55;
// Below the Budget so the alarm warns early; the Budget's 100% covers $55.
const ALARM_THRESHOLD_USD = 25;

export interface BillingStackProps extends StackProps {
  stage: string;
}

export class BillingStack extends Stack {
  constructor(scope: Construct, id: string, props: BillingStackProps) {
    super(scope, id, props);
    const { stage } = props;

    // Deployment config (ADR 0048), never defaulted: a fallback address would
    // turn the cost backstop into a silent no-op.
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

    // Budgets emails its subscribers directly; the SNS topic is the alarm's
    // channel only.
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

    // EstimatedCharges publishes every ~6h; the period matches.
    const estimatedCharges = new Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: { Currency: 'USD' },
      statistic: 'Maximum',
      period: Duration.hours(6),
    });
    const alarm = new Alarm(this, 'EstimatedChargesAlarm', {
      alarmName: `slackline-timer-v1-estimated-charges-${stage}`,
      alarmDescription: `Account estimated charges exceeded US$${ALARM_THRESHOLD_USD} this month (Budget US$${BUDGET_LIMIT_USD}).`,
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
    // CloudFront-scoped WAF must be provisioned in us-east-1, hence this stack.
    // Enable/disable runbook: doc/dev/deploy.md §6.3.
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
