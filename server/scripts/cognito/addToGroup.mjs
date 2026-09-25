// Resolve a user by EXACT email in the shared ISA Cognito pool and add them to a
// group (default: timeradmin), then verify. Group membership is baked into the
// IdToken at sign-in, so it only takes effect on the user's NEXT login.
//
// Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/addToGroup.mjs user@example.com
//   node scripts/cognito/addToGroup.mjs user@example.com --group timeradmin

import { findUserByEmail, listUsers, parseArgs, runAws, runMain } from './cognitoCommon.mjs';

const HELP = `add a user (by exact email) to a group (default: timeradmin)

  node scripts/cognito/addToGroup.mjs <email> [--group g] [--profile p] [--region r] [--pool-id id]`;

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const email = opts._[0];
  if (opts.help || !email) {
    console.log(HELP);
    if (!email) process.exitCode = 2;
    return;
  }

  console.log(`Looking up ${email} ...`);
  const user = findUserByEmail(listUsers(opts), email);
  if (!user) {
    console.error(
      `No user with email ${email} in pool ${opts.poolId}. They must sign into an ISA app once (Hosted UI) before they can be added.`,
    );
    process.exitCode = 3;
    return;
  }
  console.log(`Found username: ${user.Username}`);

  console.log(`Adding to group '${opts.group}' ...`);
  runAws(
    // prettier-ignore
    ['cognito-idp', 'admin-add-user-to-group', '--user-pool-id', opts.poolId, '--username', user.Username, '--group-name', opts.group],
    opts,
  );

  const out = runAws(
    // prettier-ignore
    ['cognito-idp', 'admin-list-groups-for-user', '--user-pool-id', opts.poolId, '--username', user.Username, '--query', 'Groups[].GroupName', '--output', 'text'],
    opts,
  );
  console.log(`OK: ${email} is now in: ${out.trim()}`);
  console.log('NOTE: takes effect on next login (have them sign out/in to refresh the token).');
});
