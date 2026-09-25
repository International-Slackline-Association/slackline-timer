// Garbage-collect unreferenced assets from the CDK bootstrap ("cdk-hnb659fds-*")
// staging bucket, safely — via `cdk gc`, NOT an S3 lifecycle rule.
//
// The CDK bootstrap S3 bucket accumulates one content-hashed object per deploy
// (Lambda bundles, synth templates). A blanket lifecycle-expiry rule is UNSAFE
// here: an old asset can still be referenced by the currently-deployed stack, and
// deleting it breaks the next `cdk deploy` / Lambda code-update. `cdk gc` instead
// reads every deployed CloudFormation stack in the environment, marks only the
// assets no live stack references as "isolated", and (with --delete) removes
// those that have stayed isolated past the rollback buffer.
//
// Both this repo's stacks share one app (infra/app.ts): the backend in
// eu-central-2 and the web frontend in eu-central-1. Each has its own CDKToolkit
// bootstrap (and thus its own staging bucket), so gc runs against both
// environments by default. cdk gc is still flagged experimental, so --unstable=gc
// is required.
//
// DEFAULT IS DRY-RUN. Without --delete this only prints what would be collected
// (cdk gc --action print) and touches nothing. Pass --delete to actually reclaim.
//
// Usage:
//   node scripts/maintenance/gcBootstrapAssets.mjs
//   node scripts/maintenance/gcBootstrapAssets.mjs --delete --region eu-central-2
//
// Flags: --delete, --region (eu-central-2|eu-central-1), --rollback-buffer-days N
// (default 30), --created-buffer-days N (default 7), --profile, --account
// (defaults to AWS_ACCOUNT_ID from the repo-root `.env.deploy`).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveAccount, resolveProfile, runMain } from '../lib/awsCli.mjs';

const HELP = `cdk gc the bootstrap staging bucket (dry-run unless --delete)

  node scripts/maintenance/gcBootstrapAssets.mjs [--delete] [--region r]
    [--rollback-buffer-days N] [--created-buffer-days N] [--profile p] [--account id]`;

const REGIONS = ['eu-central-2', 'eu-central-1'];

// server/ is the CDK app root (cdk.json defines `app`); gc needs that context.
// ...\server\scripts\maintenance -> ...\server
const serverDir = fileURLToPath(new URL('../..', import.meta.url));

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2), { rollbackBufferDays: 30, createdBufferDays: 7 });
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.region && !REGIONS.includes(opts.region)) {
    throw new Error(`--region must be one of ${REGIONS.join(', ')} (got '${opts.region}').`);
  }
  const del = Boolean(opts.delete);
  const rollbackBufferDays = String(opts.rollbackBufferDays);
  const createdBufferDays = String(opts.createdBufferDays);
  const profile = resolveProfile(opts);

  const account = resolveAccount(opts);
  const regions = opts.region ? [opts.region] : REGIONS;
  const envs = regions.map((r) => `aws://${account}/${r}`);

  const action = del ? 'full' : 'print';
  const mode = del
    ? 'DELETE (--action full)'
    : 'DRY RUN (--action print) - nothing will be deleted';

  console.log('== cdk gc bootstrap assets ==');
  console.log(`  profile : ${profile ?? '(default)'}`);
  console.log(`  envs    : ${envs.join(', ')}`);
  console.log(`  buffers : rollback=${rollbackBufferDays} d, created=${createdBufferDays} d`);
  console.log(`  mode    : ${mode}`);
  console.log('');

  // --type s3: this app publishes no container/ECR assets, only S3.
  // --confirm leaves cdk gc's interactive prompt in place before any real delete.
  const res = spawnSync(
    'npx',
    [
      'cdk',
      'gc',
      ...envs,
      '--unstable=gc',
      '--type',
      's3',
      '--action',
      action,
      '--rollback-buffer-days',
      rollbackBufferDays,
      '--created-buffer-days',
      createdBufferDays,
      '--confirm',
    ],
    {
      cwd: serverDir,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32', // npx.cmd needs a shell on Windows
      // gc reads credentials via the profile; export AWS_PROFILE so cdk picks
      // it up. Omitted when unset.
      env: profile ? { ...process.env, AWS_PROFILE: profile } : process.env,
    },
  );
  if ((res.status ?? 1) !== 0) throw new Error(`cdk gc exited ${res.status}`);

  console.log('');
  if (del) console.log('Done - unreferenced assets reclaimed.');
  else console.log('Dry run complete. Re-run with --delete to reclaim the assets listed above.');
});
