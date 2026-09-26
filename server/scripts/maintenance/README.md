# Maintenance scripts

Housekeeping for the CDK-managed backend that isn't part of deploy/decommission.

## `gcBootstrapAssets.mjs` — reclaim CDK bootstrap staging-bucket assets

**What accumulates.** `cdk bootstrap` provisions a per-account/region `CDKToolkit`
stack whose S3 bucket (`cdk-hnb659fds-assets-<account>-<region>`) stores your
deploy assets — the esbuild Lambda bundles and synthesized templates. Every
`cdk deploy` / `cdk watch` publishes a new content-hashed object, so the bucket
grows without bound. The bootstrap **infrastructure itself is not removable**
while this repo deploys with CDK (delete it and the next deploy fails); only the
_old asset objects_ inside the bucket are reclaimable.

**Why not an S3 lifecycle rule.** A time-based expiry is unsafe here: an asset
untouched for months can still be referenced by the live stack (a stable Lambda
bundle, the current template). Expiring it breaks `cdk deploy` and Lambda
code-updates. `cdk gc` instead reads the deployed CloudFormation stacks, marks
only assets no live stack references as _isolated_, and deletes those that have
stayed isolated past a rollback buffer.

**Usage** (run from anywhere; the script cd's into `server/` for the CDK app):

```bash
# Dry run, both regions — prints what would be reclaimed, changes nothing:
node scripts/maintenance/gcBootstrapAssets.mjs

# Actually reclaim (both regions):
node scripts/maintenance/gcBootstrapAssets.mjs --delete

# One environment only:
node scripts/maintenance/gcBootstrapAssets.mjs --delete --region eu-central-2
```

Defaults are conservative: **dry-run unless `--delete`**, a 30-day rollback buffer
(`--rollback-buffer-days`) and a 7-day created buffer (`--created-buffer-days`) so
recent and recently-isolated assets are never touched. Needs `AWS_PROFILE` — from
the repo-root `.env.deploy`, the shell, or `--profile` per run — with access to
both regions. `cdk gc` is still experimental, hence
the `--unstable=gc` flag inside the script.

**Cadence.** There's no urgency — bootstrap-bucket storage is cheap. Run it
occasionally (e.g. after a burst of `cdk watch` iterations) or when the bucket
size becomes noticeable. It is safe to run the dry run any time.

## `renameCompId.mjs` — rename a competition's `compId`

**Why a script.** `compId` is the DynamoDB partition key (`COMP#<id>`) for _every_
item in a competition (META / athletes / times / matches / scores), is stored
again as a plain `compId` attribute on each, and is baked into every athlete's S3
photo key (`photos/<compId>/<hash>.ext`). DynamoDB can't mutate a primary key in
place and there is no rename API, so a rename is a copy-the-whole-partition-to-a-
new-key migration plus a matching S3 object copy — run directly against DynamoDB
and S3.

**Safety model** (like decommission / `gcBootstrapAssets`): **dry-run unless
`--yes`**; refuses to clobber a target that already holds items; **copy → verify
→ optional sweep** — the source is left intact unless you pass `--delete-source`,
so you can eyeball the renamed comp in `/admin` first; idempotent (Put/CopyObject
overwrite), so a re-run after a partial failure is safe.

**Usage:**

```bash
# 1. Dry run — prints the item/photo plan, writes nothing:
node scripts/maintenance/renameCompId.mjs --from old-id --to new-id --profile <your-profile>

# 2. Copy (source kept) — verifies counts landed under the new id:
node scripts/maintenance/renameCompId.mjs --from old-id --to new-id --profile <your-profile> --yes

# 3. After checking /admin, sweep the old partition + photos:
node scripts/maintenance/renameCompId.mjs --from old-id --to new-id --profile <your-profile> --yes --delete-source
```

`--profile` self-materializes the profile's (SSO) credentials into the env — the
SDK can't resolve the SSO cache directly on this box, so passing `--profile`
alone would otherwise fail "security token invalid" even right after
`aws sso login` (the same trap the CDK deploys hit; see `doc/dev/deploy.md` §8). Run
`aws sso login --profile <p>` first if the session is stale.

Other flags: `--skip-photos` (DynamoDB-only rename — leaves `photoKey` pointing at
`photos/<oldId>/`, which then must never be cleaned up), `--region` / `--table` /
`--bucket` (prod defaults, overridable for a non-prod target).

**Two manual follow-ups** the script prints and cannot do for you: re-mint the OBS
overlay read-token links on `/admin/overlays` (old tokens are scoped to the old
`compId`), and reload any open control/preview tabs with `?compId=<new-id>` (the
relay `sessionId` changed).

### Relationship to the stack ledger

The bootstrap `CDKToolkit` stacks are **not** in `../decommission/stacks.json` —
that ledger tracks _application_ stacks and their RETAIN orphans. The bootstrap
stacks are shared CDK plumbing; they'd only come down as part of abandoning CDK
in a region entirely (see the eu-central-1 note in the ledger: its CDKToolkit
must stay while `slackline-timer-v1-web` lives there).
