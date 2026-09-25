import { parseArgs, resolveProfile, runAws, runMain, tryAws } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';

const HELP = `read-only: stack + ledger orphans are gone

  node scripts/decommission/verifyDecommission.mjs --name <stack> [--profile p]`;

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
  const rp = { profile, region };
  const bp = { profile };
  let gone = true;
  const report = (label, isGone) => {
    if (isGone) console.log(`  [gone]    ${label}`);
    else {
      console.log(`  [PRESENT] ${label}`);
      gone = false;
    }
  };

  console.log(`== verify '${name}' (${region}) — expect everything [gone] ==`);

  report(
    `stack ${name}`,
    !tryAws(['cloudformation', 'describe-stacks', '--stack-name', name], rp).ok,
  );

  for (const t of (o.dynamodbTables ?? []).filter(Boolean)) {
    report(`dynamodb ${t}`, !tryAws(['dynamodb', 'describe-table', '--table-name', t], rp).ok);
  }
  for (const b of (o.s3Buckets ?? []).filter(Boolean)) {
    report(`s3 ${b}`, !tryAws(['s3api', 'head-bucket', '--bucket', b], bp).ok);
  }
  for (const cfId of (o.cloudfrontDistributions ?? []).filter(Boolean)) {
    report(`cloudfront ${cfId}`, !tryAws(['cloudfront', 'get-distribution', '--id', cfId], bp).ok);
  }
  for (const prefix of (o.logGroupPrefixes ?? []).filter(Boolean)) {
    // runAws (throwing), not tryAws: a failed listing must abort, not read as [gone].
    const lgs = runAws(
      // prettier-ignore
      ['logs', 'describe-log-groups', '--log-group-name-prefix', prefix, '--query', 'logGroups[].logGroupName', '--output', 'text'],
      rp,
    ).trim();
    report(`log groups ${prefix}*`, lgs === '');
  }
  for (const n of (o.ssmParams ?? []).filter(Boolean)) {
    const present = tryAws(['ssm', 'get-parameter', '--name', n], rp).ok;
    if (present)
      console.log(
        `  [kept]    ssm ${n} (expected across a rename; gone only after --delete-ssm-params)`,
      );
    else console.log(`  [gone]    ssm ${n}`);
  }

  console.log('');
  if (gone) console.log(`OK — '${name}' fully decommissioned (SSM params aside).`);
  else
    console.log(
      `INCOMPLETE — resources above are still present; re-run decommissionStack.mjs --name ${name}.`,
    );
});
