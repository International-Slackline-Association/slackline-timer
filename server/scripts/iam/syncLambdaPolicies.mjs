// Lambda inline IAM policies, applied with the operator's own session instead of
// CloudFormation: the ISA org SCP denies iam:PutRolePolicy to the CDK
// cfn-exec-role every stack is pinned to (doc/dev/deploy.md §8). The backend
// stack keeps the policies in its template Metadata (infra/externalPolicies.ts).
//
//   --probe   re-write ONE role's current policy onto itself (no permission
//             change): may this session write role policies at all?
//   --retain  one-time migration step: mark the deployed stack's
//             AWS::IAM::Policy resources Retain (nothing else changes), so the
//             deploy that drops them from the template leaves them in IAM.
//   --apply   write each role's policy from the template Metadata — the deployed
//             template, or `--from <synthesized template>`; `--union` keeps every
//             statement the role already has.
//
// Every mode takes --dry-run (read only). Also: --role <logical-id prefix>
// (probe; default ConnectionHandlerFunction), --stack <name> (default
// slackline-timer-v1), --profile. Runbook: README.md.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, resolveProfile, runAws, runMain } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';
import {
  classifyDenial,
  pickProbeRole,
  planPolicies,
  retainPolicies,
  samePolicyDocument,
  unionDocuments,
} from './lib/iamPolicies.mjs';

const HELP = `Lambda inline IAM policies, written with your own session

  node scripts/iam/syncLambdaPolicies.mjs --probe  [--dry-run] [--role prefix]
  node scripts/iam/syncLambdaPolicies.mjs --retain [--dry-run]
  node scripts/iam/syncLambdaPolicies.mjs --apply  [--dry-run] [--union] [--from template.json]
    common: [--stack name] [--profile p]`;

// IAM's quota for one role's inline policies, whitespace excluded.
const INLINE_POLICY_MAX_CHARS = 10_240;

// Must match EXTERNAL_POLICIES_KEY in infra/externalPolicies.ts.
const EXTERNAL_POLICIES_KEY = 'SlacklineTimer::ExternalPolicies';

const json = (out) => JSON.parse(out);

function session(opts) {
  const profile = resolveProfile(opts);
  const { region } = resolveEntry(opts.stack, 'syncing its policies');
  const aws = (args, { regional = false } = {}) =>
    json(runAws([...args, '--output', 'json'], { profile, region: regional ? region : undefined }));
  const caller = aws(['sts', 'get-caller-identity']);
  console.log(`  caller : ${caller.Arn}`);
  console.log(`  stack  : ${opts.stack} (${region})`);
  console.log(`  mode   : ${opts.dryRun ? 'DRY RUN — nothing is written' : 'WRITE'}`);
  if (!/AWSReservedSSO_AdministratorAccess_/.test(caller.Arn)) {
    console.log(
      '  ⚠️  not the AdministratorAccess SSO role — the only principal the SCP seems to exempt',
    );
  }
  const resources = () =>
    aws(['cloudformation', 'list-stack-resources', '--stack-name', opts.stack], { regional: true })
      .StackResourceSummaries;
  return { profile, region, account: caller.Account, aws, resources };
}

function readPolicy(s, roleName, policyName) {
  try {
    return s.aws(['iam', 'get-role-policy', '--role-name', roleName, '--policy-name', policyName])
      .PolicyDocument;
  } catch (err) {
    if (/NoSuchEntity/.test(err.message)) return null;
    throw err;
  }
}

function putPolicy(s, roleName, policyName, document) {
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
        JSON.stringify(document),
      ],
      { profile: s.profile },
    );
  } catch (err) {
    const kind = classifyDenial(err.message);
    if (kind === 'scp') {
      console.error(
        `\n❌ ${roleName}: DENIED by the org SCP — this session cannot write role policies.`,
      );
      console.error(
        '   Only an org-admin SCP exemption can unblock the deploy (doc/dev/deploy.md §8).',
      );
      process.exit(2);
    }
    if (kind === 'identity') {
      console.error(
        `\n❌ ${roleName}: DENIED by an identity policy — use the AdministratorAccess profile.`,
      );
      process.exit(2);
    }
    throw err;
  }
  if (!samePolicyDocument(document, readPolicy(s, roleName, policyName))) {
    throw new Error(`${roleName}/${policyName} reads back different from what was written`);
  }
}

function deployedTemplate(s, stack) {
  const body = s.aws(
    ['cloudformation', 'get-template', '--stack-name', stack, '--template-stage', 'Original'],
    { regional: true },
  ).TemplateBody;
  return typeof body === 'string' ? JSON.parse(body) : body;
}

function probe(opts, s) {
  const roleName = pickProbeRole(s.resources(), opts.role);
  const { PolicyNames: names } = s.aws(['iam', 'list-role-policies', '--role-name', roleName]);
  if (names.length !== 1) {
    throw new Error(
      `${roleName} has ${names.length} inline policies, expected CDK's one DefaultPolicy`,
    );
  }
  const [policyName] = names;
  const current = readPolicy(s, roleName, policyName);
  console.log(`  role   : ${roleName}`);
  console.log(`  policy : ${policyName} (${current.Statement.length} statement(s))`);
  if (opts.dryRun) {
    console.log(
      '\nDry run: would PUT the document above back unchanged. Re-run without --dry-run.',
    );
    return;
  }
  putPolicy(s, roleName, policyName, current);
  console.log('\n✅ ALLOWED: this session can write role policies; the document is unchanged.');
}

function retain(opts, s) {
  const { template, changed } = retainPolicies(deployedTemplate(s, opts.stack));
  if (changed.length === 0) {
    console.log('\nEvery AWS::IAM::Policy is already Retain — nothing to do.');
    return;
  }
  console.log(`\nMarks Retain (${changed.length}): ${changed.join(', ')}`);
  if (opts.dryRun) {
    console.log('Dry run: no stack update. Re-run without --dry-run.');
    return;
  }

  // Past update-stack's 51,200-byte inline limit, so it goes through the CDK
  // bootstrap staging bucket.
  const bucket = `cdk-hnb659fds-assets-${s.account}-${s.region}`;
  const key = `iam-retain/${opts.stack}-${Date.now()}.json`;
  const file = join(tmpdir(), `iam-retain-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(template));
  try {
    runAws(['s3', 'cp', file, `s3://${bucket}/${key}`, '--only-show-errors'], {
      profile: s.profile,
      region: s.region,
    });
  } finally {
    rmSync(file, { force: true });
  }

  const parameters = (
    s.aws(['cloudformation', 'describe-stacks', '--stack-name', opts.stack], { regional: true })
      .Stacks[0].Parameters ?? []
  ).map((p) => `ParameterKey=${p.ParameterKey},UsePreviousValue=true`);
  runAws(
    [
      'cloudformation',
      'update-stack',
      '--stack-name',
      opts.stack,
      '--template-url',
      `https://${bucket}.s3.${s.region}.amazonaws.com/${key}`,
      ...(parameters.length ? ['--parameters', ...parameters] : []),
      '--capabilities',
      'CAPABILITY_IAM',
      'CAPABILITY_NAMED_IAM',
      'CAPABILITY_AUTO_EXPAND',
    ],
    { profile: s.profile, region: s.region },
  );
  console.log('Stack update started; waiting for UPDATE_COMPLETE…');
  runAws(['cloudformation', 'wait', 'stack-update-complete', '--stack-name', opts.stack], {
    profile: s.profile,
    region: s.region,
  });
  console.log(`\n✅ ${changed.length} inline policies are Retain; the deploy may now drop them.`);
}

function apply(opts, s) {
  const template = opts.from
    ? JSON.parse(readFileSync(opts.from, 'utf8'))
    : deployedTemplate(s, opts.stack);
  const external = template.Metadata?.[EXTERNAL_POLICIES_KEY];
  if (!external) {
    throw new Error(
      `${opts.from ?? 'the deployed template'} has no Metadata.${EXTERNAL_POLICIES_KEY} — ` +
        'synthesize/deploy the stack with infra/externalPolicies.ts first, or pass --from cdk.out/<stack>.template.json',
    );
  }
  const plan = planPolicies(external, {
    partition: 'aws',
    region: s.region,
    account: s.account,
    resources: s.resources(),
  });
  console.log(
    `  source : ${opts.from ?? 'deployed template'}${opts.union ? ' (union with current)' : ''}`,
  );

  let changes = 0;
  for (const { roleName, policyName, document } of plan) {
    const current = readPolicy(s, roleName, policyName);
    const next = opts.union && current ? unionDocuments(current, document) : document;
    if (JSON.stringify(next).length > INLINE_POLICY_MAX_CHARS) {
      throw new Error(
        `${policyName}: the union is past IAM's ${INLINE_POLICY_MAX_CHARS} characters`,
      );
    }
    if (current && samePolicyDocument(current, next)) {
      console.log(`  =  ${policyName}`);
      continue;
    }
    changes += 1;
    const from = current ? current.Statement.length : 'none';
    console.log(`  ~  ${policyName}: ${from} → ${next.Statement.length} statement(s)`);
    if (!opts.dryRun) putPolicy(s, roleName, policyName, next);
  }
  if (changes === 0) console.log('\nEvery policy already matches.');
  else if (opts.dryRun)
    console.log(`\nDry run: ${changes} policies would change. Re-run without --dry-run.`);
  else console.log(`\n✅ ${changes} policies written and read back.`);
}

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2), {
    stack: 'slackline-timer-v1',
    role: 'ConnectionHandlerFunction',
  });
  const mode = ['probe', 'retain', 'apply'].filter((m) => opts[m]);
  if (opts.help || mode.length !== 1) {
    console.log(HELP);
    return;
  }
  console.log(`== Lambda IAM policies: --${mode[0]} ==`);
  const s = session(opts);
  ({ probe, retain, apply })[mode[0]](opts, s);
});
