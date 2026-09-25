// Read-only end-state check for a commissioned stack (from stacks.json). Prints
// whether the stack deployed cleanly and each ledger `orphans` table/bucket is
// now MANAGED by that stack (i.e. was adopted via --import-existing-resources).
// The inverse of verifyDecommission.mjs.
//
// Usage:
//   node scripts/commission/verifyCommission.mjs --name slackline-timer-v1
//
// Flags: --name (required), --profile. Auth is your AWS CLI v2 session.

import { parseArgs, resolveProfile, runMain, tryAws } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';

const HELP = `read-only: stack COMPLETE + ledger orphans now stack-managed

  node scripts/commission/verifyCommission.mjs --name <stack> [--profile p]`;

const GOOD_STATUS = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
  'IMPORT_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
];

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const name = opts.name;
  if (opts.help || !name) {
    console.log(HELP);
    if (!name) process.exitCode = 2;
    return;
  }
  const profile = resolveProfile(opts);

  const entry = resolveEntry(name);
  const region = entry.region;
  const o = entry.orphans;
  let ok = true;
  const report = (label, good, goodTag, badTag) => {
    if (good) console.log(`  [${goodTag}] ${label}`);
    else {
      console.log(`  [${badTag}] ${label}`);
      ok = false;
    }
  };

  console.log(`== verify '${name}' (${region}) — expect stack COMPLETE + orphans [managed] ==`);

  const st = tryAws(
    // prettier-ignore
    ['cloudformation', 'describe-stacks', '--stack-name', name, '--query', 'Stacks[0].StackStatus', '--output', 'text'],
    { profile, region },
  );
  if (!st.ok) report(`stack ${name} (not found)`, false, 'ok', 'MISSING');
  else {
    const status = st.stdout.trim();
    report(`stack ${name} (${status})`, GOOD_STATUS.includes(status), 'ok', 'BAD-STATE');
  }

  // Each orphan table/bucket should now appear as a resource OF this stack.
  // list-stack-resources (auto-paginates) — describe-stack-resources caps at 100
  // resources, so on a >100-resource stack managed resources fall off the page
  // and read as a false UNMANAGED.
  const res = tryAws(
    // prettier-ignore
    ['cloudformation', 'list-stack-resources', '--stack-name', name, '--query', 'StackResourceSummaries[].PhysicalResourceId', '--output', 'text'],
    { profile, region },
  );
  let managedSet = [];
  if (res.ok && res.stdout.trim()) managedSet = res.stdout.trim().split(/\s+/);

  for (const t of (o.dynamodbTables ?? []).filter(Boolean)) {
    report(`dynamodb ${t}`, managedSet.includes(t), 'managed', 'UNMANAGED');
  }
  for (const b of (o.s3Buckets ?? []).filter(Boolean)) {
    report(`s3 ${b}`, managedSet.includes(b), 'managed', 'UNMANAGED');
  }

  console.log('');
  if (ok) {
    console.log(
      `OK — '${name}' is deployed and owns its retained resources. Set its status to 'live' in stacks.json.`,
    );
  } else {
    console.log(
      `INCOMPLETE — items above are not yet stack-managed; re-check the deploy (commissionStack.mjs --name ${name}).`,
    );
  }
});
