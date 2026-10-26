# IAM scripts

## `syncLambdaPolicies.mjs` — Lambda inline policies, written with your own session

The backend stack carries no `AWS::IAM::Policy` resources:
`infra/externalPolicies.ts` moves each Lambda role's inline policy into the
template `Metadata`, and this script writes them with your session after the
deploy (doc/dev/deploy.md §8).

Run from `server/` with `--profile <your-profile>`; `--dry-run` reads only.

### Routine backend deploy

```bash
npx cdk deploy slackline-timer-v1          # doc/dev/deploy.md §2
node scripts/iam/syncLambdaPolicies.mjs --apply --dry-run --profile <p>
node scripts/iam/syncLambdaPolicies.mjs --apply --profile <p>
```

A grant the new code needs is live only after `--apply`. When a change adds
one, run `--apply --union --from cdk.out/slackline-timer-v1.template.json`
before the deploy (after `npx cdk synth`) so no Lambda runs short of it; the
`--apply` after the deploy then drops what the old code alone needed.
