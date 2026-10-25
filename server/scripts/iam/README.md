# IAM scripts

## `syncLambdaPolicies.mjs` — Lambda inline policies, written with your own session

The ISA org SCP denies `iam:PutRolePolicy` to the CDK `cfn-exec-role` both
stacks are pinned to, so CloudFormation cannot update the Lambdas' inline
policies (doc/dev/deploy.md §8). Your `AdministratorAccess` SSO session can (the
probe below proved it on 2026-10-25). The backend stack therefore carries no
`AWS::IAM::Policy` resources: `infra/externalPolicies.ts` moves each Lambda
role's policy into the template `Metadata`, and this script writes them.

Every mode takes `--dry-run` (read only). Run from `server/`, with
`--profile <your-profile>` (the AdministratorAccess SSO profile).

| Mode       | Does                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--probe`  | Re-writes one role's current policy onto itself (no permission change): may this session write role policies? Exit 2 = denied.                                       |
| `--retain` | One-time: marks the deployed stack's `AWS::IAM::Policy` resources `Retain`, nothing else, so the deploy that drops them leaves them in IAM.                          |
| `--apply`  | Writes each role's policy from the deployed template's `Metadata` (or `--from cdk.out/slackline-timer-v1.template.json`); `--union` keeps the statements a role has. |

### Routine backend deploy

```bash
npx cdk deploy slackline-timer-v1          # doc/dev/deploy.md §2
node scripts/iam/syncLambdaPolicies.mjs --apply --dry-run --profile <p>
node scripts/iam/syncLambdaPolicies.mjs --apply --profile <p>
```

A grant the new code needs is live only after `--apply`. When a change adds
one, run `--apply --union --from cdk.out/slackline-timer-v1.template.json`
before the deploy (after `npx cdk synth`) so no Lambda runs short of it.

### One-time migration (the stack still owns the 13 policies)

1. `--probe` — must print ✅ ALLOWED.
2. `npx cdk synth slackline-timer-v1`, then
   `--apply --union --from cdk.out/slackline-timer-v1.template.json` — every
   role gets the new grants and keeps the old ones, so neither the running nor
   the new code is short of a permission.
3. `--retain` — waits for `UPDATE_COMPLETE`.
4. `npx cdk diff slackline-timer-v1` — the 13 `AWS::IAM::Policy` lines **must
   read `orphan`, not `destroy`**. `destroy` means step 3 did not land: do not
   deploy, CloudFormation would delete them through the denied role.
5. `npx cdk deploy slackline-timer-v1` — no IAM calls.
6. `--apply` — tightens every role to exactly the deployed grants.

Outside a live heat: the Lambda updates in step 5 cold-start the relay.
