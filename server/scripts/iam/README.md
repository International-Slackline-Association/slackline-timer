# IAM scripts

## `syncLambdaPolicies.mjs` — Lambda inline policies, written with your own session

The ISA org SCP denies `iam:PutRolePolicy` to the CDK `cfn-exec-role` both
stacks are pinned to, so CloudFormation cannot update the Lambdas' inline
policies (doc/dev/deploy.md §8). Your `AdministratorAccess` SSO session appears
to be exempt; this script writes the policies with it.

**Probe first.** `--probe` re-writes one role's current inline policy onto itself
(no permission change) and reports whether your session may write role policies:

```bash
# Read only — shows the role and policy it would touch:
node scripts/iam/syncLambdaPolicies.mjs --probe --dry-run --profile <your-profile>

# The real probe — writes the identical document back:
node scripts/iam/syncLambdaPolicies.mjs --probe --profile <your-profile>
```

Exit code 2 with "DENIED by the org SCP" means your session is not exempt either;
only an org-admin SCP change can unblock the deploy. `--role <logical-id prefix>`
picks another role (default `ConnectionHandlerFunction`), `--stack` another stack
from `scripts/decommission/stacks.json`.
