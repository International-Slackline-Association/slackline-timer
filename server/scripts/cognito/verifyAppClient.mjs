// Read-only audit of the timer's Cognito app client against the least-privilege
// policy (appClientPolicy.mjs). Prints a pass/fail per check and exits non-zero
// if any hard check fails — safe to wire into a periodic security check.
//
// Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/verifyAppClient.mjs
//   node scripts/cognito/verifyAppClient.mjs --client-id <id> --profile <profile>
//   node scripts/cognito/verifyAppClient.mjs --json      # machine-readable

import { describeClient, evaluate, parseArgs, runMain } from './appClientPolicy.mjs';

const HELP = `audit the timer Cognito app client (read-only)

  node scripts/cognito/verifyAppClient.mjs [options]

  --client-id <id>     app client id     (default: the timer SPA client)
  --pool-id <id>       user pool id       (default: shared ISA pool)
  --region <r>         AWS region         (default: eu-central-1)
  --profile <p>        AWS CLI profile    (default: $AWS_PROFILE)
  --json               emit JSON instead of the table
  --help`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const client = describeClient(opts);
  const { checks, ok } = evaluate(client);

  if (opts.json) {
    console.log(JSON.stringify({ clientId: opts.clientId, ok, checks }, null, 2));
  } else {
    console.log(`== verify app client ${opts.clientId} (pool ${opts.poolId}, ${opts.region}) ==\n`);
    for (const c of checks) {
      const icon = c.ok ? '✅' : c.level === 'fail' ? '❌' : '⚠️ ';
      console.log(`   ${icon} ${c.name.padEnd(38)} ${c.detail}`);
    }
    console.log(
      `\n${ok ? '✅ PASS — read-only / least privilege.' : '❌ FAIL — run hardenAppClient.mjs --apply.'}`,
    );
  }

  if (!ok) process.exit(1);
}

runMain(main);
