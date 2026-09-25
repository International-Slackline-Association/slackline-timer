// Commission (deploy) a CDK stack that ADOPTS the RETAIN resources a prior stack
// left behind — the inverse of decommissionStack.mjs. Driven by stacks.json.
//
// The relay/competition DynamoDB tables and the photos bucket are
// RemovalPolicy.RETAIN, so `cdk destroy` leaves them as UNMANAGED orphans (data
// preserved). A plain `cdk deploy` then COLLIDES: CloudFormation cannot *create*
// a table/bucket whose fixed physical name already exists.
//
// This deploys with `--import-existing-resources`, which matches template
// resources to existing unmanaged ones by their explicit physical name and
// ADOPTS them instead of creating them — bringing up (or renaming) the stack with
// zero data loss. Resources in the template that do NOT already exist are created
// normally in the same deploy (mixed create + import).
//
// PRECONDITION: the orphans must be UNMANAGED — i.e. the old stack has already
// been `cdk destroy`'d (RETAIN resources survive) WITHOUT running the
// decommission sweep (that sweep DELETES the tables/bucket; use --stack-only, or
// you lose the data this script exists to preserve). If a table/bucket is still
// owned by a live stack, CloudFormation import fails; delete that stack first.
//
// Honours --what-if: prints the plan and runs `cdk diff` instead of deploying.
//
// Usage:
//   node scripts/commission/commissionStack.mjs --name slackline-timer-v1 --what-if
//   node scripts/commission/commissionStack.mjs --name slackline-timer-v1
//
// Flags: --name (required), --profile, --what-if, --skip-ssm-check.
// Auth is your AWS CLI v2 / CDK session — see README.md.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveProfile, runMain, tryAws } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';

const HELP = `commission (deploy + import) a stack from stacks.json

  node scripts/commission/commissionStack.mjs --name <stack> [--what-if] [--skip-ssm-check] [--profile p]`;

// ...\server\scripts\commission -> ...\server (the CDK app root; cdk.json is there)
const serverRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Run npx cdk with inherited stdio from the server root; return exit status. */
function runCdk(args) {
  const res = spawnSync('npx', ['cdk', ...args], {
    cwd: serverRoot,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32', // npx.cmd needs a shell on Windows
  });
  return res.status ?? 1;
}

/** Capture `npx cdk --version` stdout (best-effort; empty string on failure). */
function cdkVersion() {
  const res = spawnSync('npx', ['cdk', '--version'], {
    cwd: serverRoot,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return (res.stdout ?? '').trim().replace(/\s.*$/, '');
}

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const name = opts.name;
  if (opts.help || !name) {
    console.log(HELP);
    if (!name) process.exitCode = 2;
    return;
  }
  const whatIf = Boolean(opts.whatIf);
  const profile = resolveProfile(opts);
  const awsOpts = { profile };

  // CDK re-resolves the SSO profile to assume its bootstrap roles and can fail
  // with ExpiredToken even when the aws CLI works. If credentials are already
  // materialized in the environment (e.g. `aws configure export-credentials`),
  // let cdk use those directly and DON'T pass --profile (it would override them).
  // The aws CLI calls below keep --profile (they resolve SSO fine).
  const cdkProfileArgs =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? []
      : profile
        ? ['--profile', profile]
        : [];
  if (cdkProfileArgs.length === 0 && process.env.AWS_ACCESS_KEY_ID) {
    console.log('   using materialized env credentials for cdk (no --profile)');
  }

  const entry = resolveEntry(name, 'commissioning');
  const region = entry.region;
  const o = entry.orphans;
  console.log(`== commission '${name}' (${entry.role}, ${region}, status=${entry.status}) ==`);
  console.log(`   profile=${profile ?? '(default)'}  WhatIf=${whatIf}`);

  // --- 1a. cdk CLI must support --import-existing-resources (landed in 2.157) --
  const version = cdkVersion();
  const m = version.match(/^(\d+)\.(\d+)/);
  if (m) {
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major < 2 || (major === 2 && minor < 157)) {
      throw new Error(
        `cdk CLI ${version} is too old for --import-existing-resources (need >= 2.157). Upgrade aws-cdk.`,
      );
    }
    console.log(`   cdk CLI ${version} (supports --import-existing-resources)`);
  } else {
    console.log(
      `!! could not parse cdk version ('${version}') — proceeding, but --import-existing-resources needs >= 2.157`,
    );
  }

  // --- 1b. required SSM params must exist (deploy resolves them; runtime reads) -
  if (!opts.skipSsmCheck) {
    const ssmParams = (o.ssmParams ?? []).filter(Boolean);
    const missing = [];
    for (const n of ssmParams) {
      const { ok } = tryAws(['ssm', 'get-parameter', '--name', n], { profile, region });
      if (!ok) missing.push(n);
    }
    if (missing.length > 0) {
      console.log(
        "!! missing SSM param(s) the deploy needs (see doc/dev/deploy.md §0.2 'SSM parameters'):",
      );
      for (const n of missing) console.log(`     ${n}`);
      throw new Error(
        `provision the SSM params above (or pass --skip-ssm-check) before commissioning '${name}'.`,
      );
    }
    if (ssmParams.length > 0)
      console.log(`   all ${ssmParams.length} required SSM param(s) present`);
  }

  // --- 1c. classify each orphan: EXISTS (import) vs absent (create) ------------
  const willImport = [];
  for (const t of (o.dynamodbTables ?? []).filter(Boolean)) {
    const { ok } = tryAws(['dynamodb', 'describe-table', '--table-name', t], { profile, region });
    if (ok) {
      willImport.push(`dynamodb  ${t}`);
      console.log(`   [exists → IMPORT] table  ${t}`);
    } else {
      console.log(`   [absent → create] table  ${t}`);
    }
  }
  for (const b of (o.s3Buckets ?? []).filter(Boolean)) {
    // head-bucket is not region-scoped (S3 redirects across regions).
    const { ok } = tryAws(['s3api', 'head-bucket', '--bucket', b], awsOpts);
    if (ok) {
      willImport.push(`s3        ${b}`);
      console.log(`   [exists → IMPORT] bucket ${b}`);
    } else {
      console.log(`   [absent → create] bucket ${b}`);
    }
  }
  if (willImport.length === 0) {
    console.log('-- no existing orphans to import — this is a plain fresh deploy.');
  }

  // --- 2. deploy (importing matches by physical name), or diff under --what-if -
  if (!whatIf) {
    console.log(
      `-- cdk deploy ${name} --import-existing-resources (~5-25 min; CloudFront-heavy stacks are slow)`,
    );
    const status = runCdk([
      'deploy',
      name,
      '--import-existing-resources',
      '--require-approval',
      'never',
      ...cdkProfileArgs,
    ]);
    if (status !== 0) throw new Error(`cdk deploy failed (exit ${status}) — see output above.`);
    console.log('   deploy complete');
  } else {
    console.log(`-- WhatIf: running 'cdk diff ${name}' (no changes made)`);
    runCdk(['diff', name, ...cdkProfileArgs]);
  }

  console.log(
    `DONE — '${name}' commission pass complete. Run verifyCommission.mjs --name ${name} to confirm the orphans are now stack-managed, then flip its status to 'live' in stacks.json.`,
  );
});
