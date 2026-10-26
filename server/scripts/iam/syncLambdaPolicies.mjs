// Lambda inline IAM policies, applied with the operator's own session after each
// deploy: the backend stack keeps them in its template Metadata
// (infra/externalPolicies.ts) instead of as CloudFormation resources.
//
//   --apply   write each role's policy from the template Metadata — the deployed
//             template, or `--from <synthesized template>`; `--union` keeps every
//             statement the role already has.
//
// Also: --dry-run (read only), --stack <name> (default slackline-timer-v1),
// --profile. Runbook: README.md.

import { readFileSync } from 'node:fs';

import { parseArgs, resolveProfile, runAws, runMain } from '../lib/awsCli.mjs';
import { resolveEntry } from '../lib/stackLedger.mjs';
import { planPolicies, samePolicyDocument, unionDocuments } from './lib/iamPolicies.mjs';

const HELP = `Lambda inline IAM policies, written with your own session

  node scripts/iam/syncLambdaPolicies.mjs --apply [--dry-run] [--union] [--from template.json]
    [--stack name] [--profile p]`;

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
  const opts = parseArgs(process.argv.slice(2), { stack: 'slackline-timer-v1' });
  if (opts.help || !opts.apply) {
    console.log(HELP);
    return;
  }
  console.log('== Lambda IAM policies: --apply ==');
  apply(opts, session(opts));
});
