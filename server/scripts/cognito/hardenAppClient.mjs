// Lock the timer's Cognito app client to the least-privilege DESIRED config
// (appClientPolicy.mjs, whose header explains why the removed admin scope, not
// WriteAttributes, is the write-lock). Dry-run unless --apply.
//
// update-user-pool-client REPLACES the whole config, so this describes first
// and overrides only DESIRED; callback URLs, token validity and providers carry
// over verbatim. The pre-change config is written to a timestamped backup file.

import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DESIRED,
  FORBIDDEN_SCOPE,
  buildDesiredInput,
  describeClient,
  evaluate,
  parseArgs,
  requireConfig,
  runAws,
  runMain,
} from './appClientPolicy.mjs';

const HELP = `harden the timer Cognito app client (read-only, least privilege)

  node scripts/cognito/hardenAppClient.mjs [options]

  --apply                    actually write the change (default: dry-run)
  --write-attributes a,b     also narrow the writable attributes to this explicit
                             set (default: leave unchanged; the removed admin
                             scope is the real write-lock — empty == all-writable)
  --client-id <id>           app client id    (default: $COGNITO_CLIENT_ID)
  --pool-id <id>             user pool id     (default: $COGNITO_USER_POOL_ID)
  --region <r>               AWS region       (default: $COGNITO_REGION)
  --profile <p>              AWS CLI profile  (default: $AWS_PROFILE)
  --help`;

const diffField = (label, before, after) => {
  const b = JSON.stringify(before ?? []);
  const a = JSON.stringify(after ?? []);
  const mark = b === a ? '   (unchanged)' : '  <— CHANGED';
  console.log(`   ${label.padEnd(24)} ${b}  →  ${a}${mark}`);
};

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  requireConfig(opts, 'poolId', 'clientId', 'region');

  console.log(`== harden app client ${opts.clientId} (pool ${opts.poolId}, ${opts.region}) ==`);
  console.log(`   profile=${opts.profile}  mode=${opts.apply ? 'APPLY' : 'dry-run'}\n`);

  const current = describeClient(opts);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(process.cwd(), `appclient-${opts.clientId}-before-${stamp}.json`);
  writeFileSync(backup, JSON.stringify(current, null, 2));
  console.log(`   backup (rollback record): ${backup}\n`);

  if ((current.AllowedOAuthScopes ?? []).includes(FORBIDDEN_SCOPE)) {
    console.log(`!! currently grants ${FORBIDDEN_SCOPE} — will be REMOVED (the actual write-lock)`);
  }

  // Empty --write-attributes is ignored — see buildDesiredInput (appClientPolicy.mjs).
  const targetWrite = opts.writeAttributes?.length ? opts.writeAttributes : current.WriteAttributes;

  console.log('   plan:');
  diffField('ReadAttributes', current.ReadAttributes, DESIRED.ReadAttributes);
  diffField('AllowedOAuthScopes', current.AllowedOAuthScopes, DESIRED.AllowedOAuthScopes);
  diffField('AllowedOAuthFlows', current.AllowedOAuthFlows, DESIRED.AllowedOAuthFlows);
  diffField('WriteAttributes', current.WriteAttributes, targetWrite);
  if (!opts.writeAttributes?.length) {
    console.log(
      '   note: WriteAttributes left unchanged — writes are blocked by the removed admin\n' +
        '         scope, not this list. Pass --write-attributes a,b to also narrow it.',
    );
  }

  if (!opts.apply) {
    console.log('\n-- dry-run: nothing changed. Re-run with --apply to write.');
    return;
  }

  const input = buildDesiredInput(current, opts);
  const payload = join(process.cwd(), `appclient-${opts.clientId}-input-${stamp}.json`);
  writeFileSync(payload, JSON.stringify(input));

  console.log('\n-- applying (update-user-pool-client) ...');
  try {
    runAws(
      ['cognito-idp', 'update-user-pool-client', '--cli-input-json', `file://${payload}`],
      opts,
    );
  } finally {
    // Transient — the rollback record is the `before` backup, not this input.
    unlinkSync(payload);
  }

  const after = describeClient(opts);
  const { checks, ok } = evaluate(after);
  console.log('\n-- verify:');
  for (const c of checks)
    console.log(`   ${c.ok ? '✅' : c.level === 'fail' ? '❌' : '⚠️ '} ${c.name}: ${c.detail}`);
  if (!ok)
    throw new Error(
      'post-apply verification FAILED — the client is not fully locked down (see above).',
    );
  console.log('\n✨ done — app client is read-only / least privilege.');
}

runMain(main);
