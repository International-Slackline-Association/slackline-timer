import { Stack } from 'aws-cdk-lib';
import { CfnPolicy } from 'aws-cdk-lib/aws-iam';

/** Template Metadata key scripts/iam/syncLambdaPolicies.mjs reads. */
export const EXTERNAL_POLICIES_KEY = 'SlacklineTimer::ExternalPolicies';

/**
 * Moves every inline `AWS::IAM::Policy` out of the template's Resources into its
 * Metadata, keyed by the policy's logical id. The org SCP denies
 * iam:PutRolePolicy to the cfn-exec-role (doc/dev/deploy.md §8), so the
 * operator's session applies them with syncLambdaPolicies.mjs after each deploy.
 *
 * Call it last in the constructor: a grant added afterwards would land on a
 * detached policy and never reach the template.
 */
export function externaliseInlinePolicies(stack: Stack): void {
  const policies: Record<string, unknown> = {};
  for (const node of stack.node.findAll()) {
    if (!(node instanceof CfnPolicy)) continue;
    policies[stack.getLogicalId(node)] = {
      PolicyName: stack.resolve(node.policyName),
      Roles: stack.resolve(node.roles),
      PolicyDocument: stack.resolve(node.policyDocument),
    };
    // The L2 Policy owning this CfnPolicy; removing it drops the resource and
    // the DependsOn edges CDK derives from it.
    const policy = node.node.scope!;
    policy.node.scope!.node.tryRemoveChild(policy.node.id);
  }
  stack.templateOptions.metadata = {
    ...stack.templateOptions.metadata,
    [EXTERNAL_POLICIES_KEY]: policies,
  };
}
