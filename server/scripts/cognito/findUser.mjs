// Find users in the shared ISA Cognito pool by a substring of their
// email/name (case-insensitive). Cognito's list-users API has no substring
// filter, so this lists everyone and filters locally.
//
// Auth is your AWS CLI v2 session — see README.md.
//
// Usage:
//   node scripts/cognito/findUser.mjs smith
//   node scripts/cognito/findUser.mjs smith --profile <profile>

import { attr, listUsers, parseArgs, runMain } from './cognitoCommon.mjs';

const HELP = `find users by a substring of email/name (case-insensitive)

  node scripts/cognito/findUser.mjs <term> [--profile p] [--region r] [--pool-id id]`;

runMain(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const term = opts._[0];
  if (opts.help || !term) {
    console.log(HELP);
    if (!term) process.exitCode = 2;
    return;
  }

  const wanted = term.toLowerCase();
  const rows = listUsers(opts)
    .map((u) => ({
      Email: attr(u, 'email'),
      Name: attr(u, 'name'),
      Given: attr(u, 'given_name'),
      Family: attr(u, 'family_name'),
      Username: u.Username,
      Status: u.UserStatus,
    }))
    .filter((r) =>
      [r.Email, r.Name, r.Given, r.Family].filter(Boolean).join(' ').toLowerCase().includes(wanted),
    );

  if (rows.length === 0) {
    console.warn(`no users match: ${term}`);
    process.exitCode = 3;
    return;
  }
  console.table(rows);
});
