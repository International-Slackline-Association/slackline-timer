// Resolve a user by EXACT email and REMOVE them from a group (default:
// $COGNITO_TIMER_GROUP) — revokes operator access. Takes effect on next login /
// token refresh, not immediately.
//
// Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/removeFromGroup.mjs user@example.com
//   node scripts/cognito/removeFromGroup.mjs user@example.com --group <group>

import {
  findUserByEmail,
  listUsers,
  parseArgs,
  requireConfig,
  runAws,
  runMain,
} from './cognitoCommon.mjs';

const HELP = `remove a user (by exact email) from a group (default: $COGNITO_TIMER_GROUP)

  node scripts/cognito/removeFromGroup.mjs <email> [--group g] [--profile p] [--region r] [--pool-id id]`;

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const email = opts._[0];
  if (opts.help || !email) {
    console.log(HELP);
    if (!email) process.exitCode = 2;
    return;
  }
  requireConfig(opts, 'poolId', 'region', 'group');

  const user = findUserByEmail(listUsers(opts), email);
  if (!user) {
    console.error(`No user with email ${email} in pool ${opts.poolId}.`);
    process.exitCode = 3;
    return;
  }

  runAws(
    // prettier-ignore
    ['cognito-idp', 'admin-remove-user-from-group', '--user-pool-id', opts.poolId, '--username', user.Username, '--group-name', opts.group],
    opts,
  );
  console.log(`OK: removed ${email} from '${opts.group}'. Takes effect on next login.`);
});
