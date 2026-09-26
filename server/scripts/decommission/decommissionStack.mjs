// Decommission a CDK/CloudFormation stack + the orphans it leaves behind, driven
// by the ledger in stacks.json. Reusable across renames and full teardowns.
//
//   1. Deletes the CloudFormation stack by name (idempotent — skips if gone).
//   2. Sweeps the ledger entry's `orphans` that a stack delete leaves unmanaged:
//      RETAIN + deletion-protected DynamoDB tables, RETAIN S3 buckets, standalone
//      CloudFront distributions, and Lambda log groups. All idempotent.
//
// SSM parameters are NOT deleted unless --delete-ssm-params is given: a stack
// RENAME keeps the same parameters (the new stack reuses them), so only a true
// teardown should remove them.
//
// Every mutating step honours --what-if (prints the action, changes nothing).
//
// Usage:
//   # Rename: retire the old stack, keep its SSM params for the new one.
//   node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack --what-if
//   node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack
//
//   # Full teardown of the app (also drop the secrets):
//   node scripts/decommission/decommissionStack.mjs --name slackline-timer-v1 --delete-ssm-params
//
//   # Data-preserving rename step 1: delete the stack, KEEP its tables/bucket as
//   # orphans so commissionStack.mjs can import them into the new stack.
//   node scripts/decommission/decommissionStack.mjs --name SlacklineTimerV1Stack --stack-only
//
// Flags: --name (required), --profile, --skip-stack-delete, --stack-only,
// --delete-ssm-params, --what-if. Auth is your AWS CLI v2 session.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, resolveProfile, runAws, runMain, tryAws } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';

const HELP = `decommission a stack + sweep its ledger orphans

  node scripts/decommission/decommissionStack.mjs --name <stack> [--what-if]
    [--skip-stack-delete] [--stack-only] [--delete-ssm-params] [--profile p]`;

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const name = opts.name;
  if (opts.help || !name) {
    console.log(HELP);
    if (!name) process.exitCode = 2;
    return;
  }
  const whatIf = Boolean(opts.whatIf);
  const skipStackDelete = Boolean(opts.skipStackDelete);
  const stackOnly = Boolean(opts.stackOnly);
  const deleteSsmParams = Boolean(opts.deleteSsmParams);
  const profile = resolveProfile(opts);

  if (stackOnly && skipStackDelete) {
    throw new Error(
      '--stack-only and --skip-stack-delete are mutually exclusive (nothing would happen).',
    );
  }
  if (stackOnly && deleteSsmParams) {
    throw new Error('--stack-only keeps all orphans by definition — drop --delete-ssm-params.');
  }

  const entry = resolveEntry(name, 'decommissioning');
  const region = entry.region;
  const o = entry.orphans;
  const rp = { profile, region }; // region-scoped calls
  const bp = { profile }; // bucket/CloudFront calls (not region-scoped)

  // Mirrors PowerShell's ShouldProcess (hence the message wording): under
  // --what-if, print the action and return false so the caller skips the mutation.
  const shouldProcess = (target, action) => {
    if (whatIf) {
      console.log(`   What if: Performing the operation "${action}" on target "${target}".`);
      return false;
    }
    return true;
  };

  console.log(`== decommission '${name}' (${entry.role}, ${region}, status=${entry.status}) ==`);
  console.log(
    `   profile=${profile ?? '(default)'}  WhatIf=${whatIf}  DeleteSsmParams=${deleteSsmParams}`,
  );

  // --- 1. the stack itself ----------------------------------------------------
  if (!skipStackDelete) {
    const exists = tryAws(['cloudformation', 'describe-stacks', '--stack-name', name], rp).ok;
    if (exists) {
      if (shouldProcess(name, 'delete-stack')) {
        console.log(`-- deleting stack ${name} (~2-20 min; CloudFront-heavy stacks are slow)`);
        runAws(['cloudformation', 'delete-stack', '--stack-name', name], rp);
        runAws(['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', name], rp);
        console.log('   stack deleted');
      }
    } else {
      console.log(`-- stack ${name} already gone`);
    }
  }

  // --- StackOnly: keep every orphan for a data-preserving rename (import) ------
  if (stackOnly) {
    console.log('-- StackOnly: KEEPING all orphans as UNMANAGED resources (nothing swept):');
    for (const t of (o.dynamodbTables ?? []).filter(Boolean)) console.log(`     dynamodb  ${t}`);
    for (const b of (o.s3Buckets ?? []).filter(Boolean)) console.log(`     s3        ${b}`);
    for (const n of (o.ssmParams ?? []).filter(Boolean)) console.log(`     ssm       ${n}`);
    console.log(
      'NEXT — adopt them into the renamed stack: node ../commission/commissionStack.mjs --name <new-name>',
    );
    return;
  }

  // --- 2. RETAIN + deletion-protected DynamoDB tables -------------------------
  for (const t of (o.dynamodbTables ?? []).filter(Boolean)) {
    if (!tryAws(['dynamodb', 'describe-table', '--table-name', t], rp).ok) {
      console.log(`   table ${t}: already gone`);
      continue;
    }
    if (shouldProcess(t, 'delete-table')) {
      console.log(`-- table ${t}: disabling deletion protection`);
      runAws(
        ['dynamodb', 'update-table', '--table-name', t, '--no-deletion-protection-enabled'],
        rp,
      );
      // Poll until the table settles back to ACTIVE before deleting (the
      // update-table transitions it to UPDATING). Bounded (~20 × 3s = 60s) so a
      // table wedged non-ACTIVE can't hang the teardown forever — throw instead
      // and let the operator investigate.
      let status;
      for (let attempt = 1; ; attempt += 1) {
        await sleep(3000);
        status = tryAws(
          [
            'dynamodb',
            'describe-table',
            '--table-name',
            t,
            '--query',
            'Table.TableStatus',
            '--output',
            'text',
          ],
          rp,
        ).stdout.trim();
        if (status === 'ACTIVE') break;
        if (attempt >= 20) {
          throw new Error(
            `table ${t}: still '${status || 'unknown'}' after ${attempt} polls (~60s) — not ACTIVE, aborting before delete.`,
          );
        }
      }
      runAws(['dynamodb', 'delete-table', '--table-name', t], rp);
      console.log(`   deleted table ${t}`);
    }
  }

  // --- 3. RETAIN S3 buckets (empty first — CFN/S3 refuse non-empty deletes) ----
  for (const b of (o.s3Buckets ?? []).filter(Boolean)) {
    if (!tryAws(['s3api', 'head-bucket', '--bucket', b], bp).ok) {
      console.log(`   bucket ${b}: already gone`);
      continue;
    }
    if (shouldProcess(b, 'empty + delete bucket')) {
      runAws(['s3', 'rm', `s3://${b}`, '--recursive'], bp);
      runAws(['s3', 'rb', `s3://${b}`], bp);
      console.log(`   deleted bucket ${b}`);
    }
  }

  // --- 4. standalone CloudFront distributions (disable, wait, delete) ----------
  for (const cfId of (o.cloudfrontDistributions ?? []).filter(Boolean)) {
    if (!tryAws(['cloudfront', 'get-distribution', '--id', cfId], bp).ok) {
      console.log(`   cloudfront ${cfId}: already gone`);
      continue;
    }
    if (shouldProcess(cfId, 'disable + delete distribution')) {
      const enabled = tryAws(
        // prettier-ignore
        ['cloudfront', 'get-distribution', '--id', cfId, '--query', 'Distribution.DistributionConfig.Enabled', '--output', 'text'],
        bp,
      ).stdout.trim();
      if (enabled === 'True') {
        console.log(`-- cloudfront ${cfId}: disabling`);
        const cfg = JSON.parse(
          runAws(['cloudfront', 'get-distribution-config', '--id', cfId, '--output', 'json'], bp),
        );
        const etag = cfg.ETag;
        cfg.DistributionConfig.Enabled = false;
        const tmp = join(tmpdir(), `cf-off-${cfId}.json`);
        // Node's writeFileSync emits UTF-8 WITHOUT a BOM (aws file:// chokes on a BOM).
        writeFileSync(tmp, JSON.stringify(cfg.DistributionConfig));
        // file:// URI must use forward slashes for the aws CLI on Windows.
        const uri = `file://${tmp.replace(/\\/g, '/')}`;
        runAws(
          [
            'cloudfront',
            'update-distribution',
            '--id',
            cfId,
            '--distribution-config',
            uri,
            '--if-match',
            etag,
          ],
          bp,
        );
      }
      console.log('   waiting for Deployed (~15 min)...');
      runAws(['cloudfront', 'wait', 'distribution-deployed', '--id', cfId], bp);
      const etag = runAws(
        [
          'cloudfront',
          'get-distribution-config',
          '--id',
          cfId,
          '--query',
          'ETag',
          '--output',
          'text',
        ],
        bp,
      ).trim();
      runAws(['cloudfront', 'delete-distribution', '--id', cfId, '--if-match', etag], bp);
      console.log(`   deleted cloudfront ${cfId}`);
    }
  }

  // --- 5. Lambda log groups (survive stack deletion) --------------------------
  for (const prefix of (o.logGroupPrefixes ?? []).filter(Boolean)) {
    const lgs = runAws(
      // prettier-ignore
      ['logs', 'describe-log-groups', '--log-group-name-prefix', prefix, '--query', 'logGroups[].logGroupName', '--output', 'text'],
      rp,
    ).trim();
    if (!lgs) {
      console.log(`   log groups ${prefix}*: none`);
      continue;
    }
    for (const lg of lgs.split(/\s+/).filter(Boolean)) {
      if (shouldProcess(lg, 'delete-log-group')) {
        runAws(['logs', 'delete-log-group', '--log-group-name', lg], rp);
        console.log(`   deleted log group ${lg}`);
      }
    }
  }

  // --- 6. SSM parameters (only on a true teardown, never on a rename) ----------
  const ssmParams = (o.ssmParams ?? []).filter(Boolean);
  if (deleteSsmParams) {
    for (const n of ssmParams) {
      if (!tryAws(['ssm', 'get-parameter', '--name', n], rp).ok) {
        console.log(`   ssm ${n}: already gone`);
        continue;
      }
      if (shouldProcess(n, 'delete-parameter')) {
        runAws(['ssm', 'delete-parameter', '--name', n], rp);
        console.log(`   deleted ssm ${n}`);
      }
    }
  } else if (ssmParams.length > 0) {
    console.log(
      `-- KEPT ${ssmParams.length} SSM param(s) (pass --delete-ssm-params for a full teardown):`,
    );
    for (const n of ssmParams) console.log(`     ${n}`);
  }

  console.log(
    `DONE — '${name}' decommission pass complete. Run verifyDecommission.mjs --name ${name} to confirm.`,
  );
});
