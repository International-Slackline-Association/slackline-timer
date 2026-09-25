# commission — stand a stack up on the resources a prior stack left behind

The inverse of [`../decommission`](../decommission/README.md). Both read the same
durable ledger, [`../decommission/stacks.json`](../decommission/stacks.json).

## Why this exists

The relay/competition DynamoDB tables and the photos bucket are
`RemovalPolicy.RETAIN`, so `cdk destroy` deletes the stack but **leaves those
resources behind as unmanaged orphans** (the data survives — by design). A plain
`cdk deploy` then **collides**: CloudFormation cannot _create_ a table or bucket
whose fixed physical name (`slackline-timer-v1-relay-prod`, …) already exists.

`commissionStack.mjs` deploys with **`--import-existing-resources`**, which
matches each template resource to an existing unmanaged one **by its explicit
physical name** and **adopts** it instead of creating it. So you can bring a
stack up — or rename/replace one — over the surviving data with **zero loss**.
Resources in the template that don't already exist are created normally in the
same deploy (mixed create + import).

## Precondition: the orphans must be UNMANAGED

Import only works on resources no live stack owns. The intended sequence:

1. `cdk destroy` (or `delete-stack`) the old stack — its RETAIN tables/bucket
   survive as orphans. **Do _not_ run the Decommission _sweep_** here: that sweep
   (`decommissionStack.mjs`) _deletes_ the tables/bucket, which is the opposite
   of what you want when preserving data.
2. `commissionStack.mjs` the new stack — it imports those orphans.

If a table/bucket is still owned by a live stack, CloudFormation import fails
(`resource already managed`); delete that stack first.

## Scripts (Node ESM, idempotent, `--what-if`-aware)

| Script                 | Does                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `commissionStack.mjs`  | pre-flight (cdk ≥ 2.157, required SSM params, classify orphans import/create) + `cdk deploy --import-existing-resources` |
| `verifyCommission.mjs` | read-only check: stack is COMPLETE and each orphan is now a resource **of** the stack (managed)                          |

`aws` and `cdk` must be authenticated
(`aws sts get-caller-identity --profile <your-profile>`; re-run
`aws sso login --profile <your-profile>` if expired). The profile comes from the repo-root `.env.deploy` (`AWS_PROFILE`, loaded
automatically — see `.env.deploy.example`); an exported `$AWS_PROFILE` or a
per-run `--profile` overrides it.

```bash
cd server

# Preview — what imports vs creates, plus a cdk diff. Changes nothing:
node scripts/commission/commissionStack.mjs --name slackline-timer-v1 --what-if

# Adopt the surviving tables + photos bucket into the stack:
node scripts/commission/commissionStack.mjs --name slackline-timer-v1
node scripts/commission/verifyCommission.mjs --name slackline-timer-v1
```

The required SSM params (the read-token secret + photo keys) must exist before
the deploy resolves them — see §0.2 "SSM parameters" in
[`doc/dev/deploy.md`](../../../doc/dev/deploy.md). The pre-flight fails fast if
any are missing (pass `--skip-ssm-check` to override).

## After commissioning

Flip the entry's `status` in `stacks.json` to `live` once
`verifyCommission.mjs` is clean. Updating the ledger is part of the migration
Definition of Done (`doc/dev/workflow.md`).
