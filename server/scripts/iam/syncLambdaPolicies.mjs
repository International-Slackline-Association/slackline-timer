// Lambda inline IAM policies, applied with the operator's own session instead of
// CloudFormation: the ISA org SCP denies iam:PutRolePolicy to the CDK
// cfn-exec-role every stack is pinned to (doc/dev/deploy.md §8).
//
// --probe re-writes ONE role's current inline policy onto itself — no
// permission changes — and reports whether this session may write role
// policies. Run it before anything else; a denial here means only an org-admin
// SCP change can unblock the deploy.
//
// Flags: --probe, --dry-run (read only, writes nothing), --role <logical-id
// prefix> (default ConnectionHandlerFunction), --stack <name> (default
// slackline-timer-v1), --profile.

import { parseArgs, resolveProfile, runAws, runMain } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';
import { classifyDenial, pickProbeRole, samePolicyDocument } from './lib/iamPolicies.mjs';

const HELP = `Lambda inline IAM policies, written with your own session

  node scripts/iam/syncLambdaPolicies.mjs --probe [--dry-run] [--role prefix]
    [--stack name] [--profile p]`;

const json = (out) => JSON.parse(out);

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2), {
    stack: 'slackline-timer-v1',
    role: 'ConnectionHandlerFunction',
  });
  if (opts.help || !opts.probe) {
    console.log(HELP);
    return;
  }
  const profile = resolveProfile(opts);
  const { region } = resolveEntry(opts.stack, 'probing');
  const dryRun = Boolean(opts.dryRun);

  const caller = json(runAws(['sts', 'get-caller-identity', '--output', 'json'], { profile }));
  console.log('== IAM policy-write probe ==');
  console.log(`  caller : ${caller.Arn}`);
  console.log(`  stack  : ${opts.stack} (${region})`);
  console.log(
    `  mode   : ${dryRun ? 'DRY RUN — nothing is written' : 'WRITE (identical document)'}`,
  );
  if (!/AWSReservedSSO_AdministratorAccess_/.test(caller.Arn)) {
    console.log(
      '  ⚠️  not the AdministratorAccess SSO role — the only principal the SCP seems to exempt',
    );
  }

  const { StackResourceSummaries: resources } = json(
    runAws(
      ['cloudformation', 'list-stack-resources', '--stack-name', opts.stack, '--output', 'json'],
      {
        profile,
        region,
      },
    ),
  );
  const roleName = pickProbeRole(resources, opts.role);
  const { PolicyNames: names } = json(
    runAws(['iam', 'list-role-policies', '--role-name', roleName, '--output', 'json'], { profile }),
  );
  if (names.length !== 1) {
    throw new Error(
      `${roleName} has ${names.length} inline policies, expected CDK's one DefaultPolicy`,
    );
  }
  const [policyName] = names;
  const read = () =>
    json(
      runAws(
        [
          'iam',
          'get-role-policy',
          '--role-name',
          roleName,
          '--policy-name',
          policyName,
          '--output',
          'json',
        ],
        { profile },
      ),
    ).PolicyDocument;

  const before = read();
  console.log(`  role   : ${roleName}`);
  console.log(`  policy : ${policyName} (${before.Statement.length} statement(s))`);
  if (dryRun) {
    console.log(
      '\nDry run: would PUT the document above back unchanged. Re-run without --dry-run.',
    );
    return;
  }

  try {
    runAws(
      [
        'iam',
        'put-role-policy',
        '--role-name',
        roleName,
        '--policy-name',
        policyName,
        '--policy-document',
        JSON.stringify(before),
      ],
      { profile },
    );
  } catch (err) {
    const kind = classifyDenial(err.message);
    if (kind === 'scp') {
      console.error('\n❌ DENIED by the org SCP: this session cannot write role policies either.');
      console.error(
        '   Only an org-admin SCP exemption can unblock the deploy (doc/dev/deploy.md §8).',
      );
      process.exit(2);
    }
    if (kind === 'identity') {
      console.error(
        '\n❌ DENIED by an identity policy of this session — use the AdministratorAccess profile.',
      );
      process.exit(2);
    }
    throw err;
  }

  if (!samePolicyDocument(before, read())) {
    throw new Error(
      `${policyName} reads back different from what was written — inspect it in the console`,
    );
  }
  console.log('\n✅ ALLOWED: this session can write role policies; the document is unchanged.');
});
