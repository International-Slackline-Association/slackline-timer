# decommission — stack ledger + reusable teardown

> The inverse — standing a stack up on the resources a prior stack left behind
> (`cdk deploy --import-existing-resources`) — lives in
> [`../commission`](../commission/README.md) and reads this same `stacks.json`.

A **reusable**, manifest-driven replacement for the one-off `rename-v1-teardown`
scripts (git history). Two jobs:

1. **`stacks.json` — the durable ledger.** The record of every CDK stack this repo
   has deployed and the resources that outlive `cdk destroy`. It is the answer to
   "when a stack is renamed/replaced, what did the old one own and how is it
   removed?" — that knowledge lives here, versioned, and is **not** lost when the
   CDK code stops referencing the old stack. See the `_readme` block inside the
   file for the schema.
2. **Generic scripts** that read the ledger and do the work, idempotently.

## Why a ledger at all

`RemovalPolicy.RETAIN` + `deletionProtection` resources (the two DynamoDB tables,
the photos bucket) **survive a stack delete** as unmanaged orphans. Standalone
resources (hand-provisioned SSM params, old CloudFront distributions, Lambda log
groups) are never in the template. So once the code no longer references an old
stack, nothing machine-readable says what it left behind. `stacks.json` is that
trace, and `test/infra/stack-ledger.test.ts` makes it **self-enforcing**: it
synthesizes the app and fails if any RETAIN resource, or any stack rename, is not
recorded here.

## Scripts (Node ESM, idempotent, `--what-if`-aware)

| Script                   | Does                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `decommissionStack.mjs`  | `delete-stack` + sweep that entry's `orphans` (tables, buckets, CloudFront, log groups) |
| `verifyDecommission.mjs` | read-only end-state check per the entry                                                 |

`aws` must be authenticated (`aws sts get-caller-identity --profile <your-profile>`;
re-run `aws sso login --profile <your-profile>` if expired). The profile comes from the repo-root `.env.deploy` (`AWS_PROFILE`, loaded
automatically — see `.env.deploy.example`); an exported `$AWS_PROFILE` or a
per-run `--profile` overrides it.

```bash
cd server

# Dry-run first — prints every action, changes nothing:
node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack --what-if

# Rename teardown: retire the old stack but KEEP its SSM params (the new stack reuses them):
node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack
node scripts/decommission/verifyDecommission.mjs --name SlacklineTimerV1Stack

# Full teardown of the whole app (also drops the secrets):
node scripts/decommission/decommissionStack.mjs --name slackline-timer-v1 --delete-ssm-params
```

**SSM params are kept by default** — a stack _rename_ reuses the same
`/slackline-timer-v1/*` params, so only `--delete-ssm-params` (a true teardown)
removes them.

**Data-preserving rename?** Use `--stack-only` to delete just the CloudFormation
stack and KEEP every orphan (the RETAIN tables + bucket survive as unmanaged
resources), then adopt them into the renamed stack with
[`../commission`](../commission/README.md) (`cdk deploy --import-existing-resources`).

```bash
node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack --stack-only  # keep orphans
node scripts/commission/commissionStack.mjs --name slackline-timer-v1                       # import them
```

## After decommissioning

Flip the entry's `status` in `stacks.json`: `retiring → retired` once
`verifyDecommission.mjs` is clean. Keep retired entries as history (they cost
nothing and document what was cleaned). Updating the ledger is part of the
migration Definition of Done (`doc/dev/workflow.md`).
