// List the members of a Cognito group (default: timeradmin) — the current timer
// operators.
//
// Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/getGroupMembers.mjs
//   node scripts/cognito/getGroupMembers.mjs timeradmin --profile <profile>

import { attr, parseArgs, runAws, runMain } from './cognitoCommon.mjs';

const HELP = `list the members of a Cognito group (default: timeradmin)

  node scripts/cognito/getGroupMembers.mjs [group] [--profile p] [--region r] [--pool-id id]`;

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const group = opts._[0] ?? opts.group;

  const out = runAws(
    ['cognito-idp', 'list-users-in-group', '--user-pool-id', opts.poolId, '--group-name', group],
    opts,
  );
  const users = JSON.parse(out).Users ?? [];

  if (users.length === 0) {
    console.log(`group '${group}' has no members.`);
    return;
  }
  console.table(
    users.map((u) => ({ Email: attr(u, 'email'), Username: u.Username, Status: u.UserStatus })),
  );
});
