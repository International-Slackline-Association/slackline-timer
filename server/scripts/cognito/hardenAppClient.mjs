// Lock the timer's Cognito app client down to read-only, least privilege:
//   - AllowedOAuthScopes = openid, email  (NO aws.cognito.signin.user.admin —
//                                          THIS is what blocks attribute writes)
//   - AllowedOAuthFlows = code            (auth-code only, no implicit grant)
//   - ReadAttributes = email, email_verified
//
// Note: attribute writes are blocked by REMOVING the self-service scope, not by
// clearing WriteAttributes — an empty WriteAttributes is a no-op that AWS treats
// as "all standard attributes writable" (see appClientPolicy.mjs header). Pass
// --write-attributes a,b to ALSO narrow it (e.g. to your IdP-mapped attributes);
// otherwise it is left unchanged.
//
// update-user-pool-client REPLACES the whole config, so we describe first and
// override only these fields — every other setting (callback URLs, token
// validity, providers) is carried over verbatim. The pre-change config is
// written to a timestamped backup file as a rollback record.
//
// Dry-run by default (prints the plan + diff, changes nothing); pass --apply to
// write. Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/hardenAppClient.mjs                 # dry-run
//   node scripts/cognito/hardenAppClient.mjs --apply
//   node scripts/cognito/hardenAppClient.mjs --write-attributes email --apply
//   node scripts/cognito/hardenAppClient.mjs --client-id <id> --profile <profile> --apply

import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DESIRED,
  FORBIDDEN_SCOPE,
  buildDesiredInput,
  describeClient,
  evaluate,
  parseArgs,
  runAws,
  runMain,
} from './appClientPolicy.mjs';

const HELP = `harden the timer Cognito app client (read-only, least privilege)

  node scripts/cognito/hardenAppClient.mjs [options]

  --apply                    actually write the change (default: dry-run)
  --write-attributes a,b     also narrow the writable attributes to this explicit
                             set (default: leave unchanged; the removed admin
                             scope is the real write-lock — empty == all-writable)
  --client-id <id>           app client id   (default: the timer SPA client)
  --pool-id <id>             user pool id     (default: shared ISA pool)
  --region <r>               AWS region       (default: eu-central-1)
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
