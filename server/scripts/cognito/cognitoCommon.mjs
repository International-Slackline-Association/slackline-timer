// Shared foundation for the Cognito helper scripts (group management +
// app-client hardening). These shell out to an already-authenticated AWS CLI v2
// session rather than pulling in the Cognito SDK the server package doesn't
// otherwise carry — see README.md for the auth prerequisite.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Deployment config (AWS_PROFILE) from the ignored repo-root `.env.deploy` —
// template: `.env.deploy.example`. Loaded in this shared module rather than
// per-script: every script in the tree imports it, so the profile resolves
// without the operator exporting it by hand. An already-exported AWS_PROFILE
// still wins (loadEnvFile does not overwrite); an absent file is fine.
const DEPLOY_ENV = fileURLToPath(new URL('../../../.env.deploy', import.meta.url));
if (existsSync(DEPLOY_ENV)) process.loadEnvFile(DEPLOY_ENV);

// The Cognito pool these scripts operate on, all of it from `.env.deploy`
// (template: .env.deploy.example) — the same deploy input the CDK entrypoint
// and the web build read, because the pool is hand-provisioned outside this
// repo and no stack can publish it (ADR 0048). Each value is overridable per
// run by its flag (see parseArgs); none has a fallback, so a script pointed at
// no pool says so instead of touching someone else's users.
//
// `profile` comes from $AWS_PROFILE — the shell's, else the `.env.deploy` one
// loaded above — or `--profile` per run. When neither is set, runAws omits
// --profile so the AWS CLI uses its own default credential resolution — no
// profile name is hardcoded here.
export const POOL = {
  poolId: process.env.COGNITO_USER_POOL_ID,
  region: process.env.COGNITO_REGION,
  // The account that owns the pool (arn:aws:cognito-idp:<region>:…), from
  // AWS_ACCOUNT_ID in the `.env.deploy` loaded above. Pool ids are
  // account-scoped, so credentials resolving to any other account get a
  // misleading "User pool … does not exist" — runAws turns that into a
  // wrong-account diagnosis instead. Undefined without `.env.deploy`: the
  // diagnosis then just names the credentials in use, which is still the
  // actionable half.
  account: process.env.AWS_ACCOUNT_ID,
  profile: process.env.AWS_PROFILE,
  // The group the WS/HTTP authorizers require of an operator.
  group: process.env.COGNITO_TIMER_GROUP,
};

// Where each unset value should have come from — turns "undefined" into an
// instruction rather than an opaque AWS error further down.
const CONFIG_SOURCE = {
  poolId: { env: 'COGNITO_USER_POOL_ID', flag: '--pool-id' },
  region: { env: 'COGNITO_REGION', flag: '--region' },
  group: { env: 'COGNITO_TIMER_GROUP', flag: '--group' },
  clientId: { env: 'COGNITO_CLIENT_ID', flag: '--client-id' },
};

/**
 * Assert every named config key resolved (from `.env.deploy` or a flag), or
 * throw naming the env var and the flag for each one that did not. Call it
 * AFTER the --help/usage branch so `--help` still works with no config at all.
 */
export function requireConfig(opts, ...keys) {
  const missing = keys.filter((key) => !opts?.[key]);
  if (missing.length === 0) return opts;
  const err = new Error(
    'missing Cognito configuration:\n' +
      missing
        .map((key) => `   ${CONFIG_SOURCE[key].env}  (or pass ${CONFIG_SOURCE[key].flag} <value>)`)
        .join('\n') +
      '\n   Set it in the git-ignored repo-root `.env.deploy` — template: .env.deploy.example.',
  );
  err.code = 'CONFIG';
  throw err;
}

/**
 * Parse argv into `{ ...POOL, _: [positionals] }`. Flags: `--pool-id`, `--region`,
 * `--profile`, `--group` (and any `--k v`); `--help`/`-h` set `opts.help`.
 */
export function parseArgs(argv) {
  const opts = { ...POOL, _: [] };
  const alias = { 'pool-id': 'poolId' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      opts[alias[key] ?? key] = argv[(i += 1)];
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

/**
 * Run `aws <args>` with the given profile/region, returning stdout. Throws with
 * the CLI's stderr on a non-zero exit (usually an expired SSO session).
 */
export function runAws(args, { profile, region } = {}) {
  const full = [...args];
  if (region) full.push('--region', region);
  if (profile) full.push('--profile', profile);
  try {
    return execFileSync('aws', full, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      // Make the CLI's Python emit UTF-8 so non-ASCII names don't crash its
      // stdout encoder (the old Windows cp1252 charmap error).
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('`aws` CLI not found on PATH — install AWS CLI v2 (see README.md).', {
        cause: err,
      });
    }
    const stderr = err.stderr?.toString?.().trim();
    if (
      /ResourceNotFoundException/.test(stderr ?? '') &&
      /User pool .+ does not exist/.test(stderr ?? '')
    ) {
      throw new Error(wrongAccountDiagnosis(stderr, { profile }), { cause: err });
    }
    throw new Error(stderr || err.message, { cause: err });
  }
}

/**
 * "User pool … does not exist" almost always means the credentials resolved to
 * the wrong ACCOUNT (pool ids are account-scoped), not that the pool is gone —
 * on this box the `default` profile is the unrelated dev-account. Name the
 * account actually in use and the fix.
 */
function wrongAccountDiagnosis(stderr, { profile } = {}) {
  const credsInUse = profile
    ? `profile '${profile}'`
    : 'the default profile (no --profile/AWS_PROFILE set)';
  let caller = '';
  try {
    const args = ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'];
    if (profile) args.push('--profile', profile);
    caller = ` They resolve to account ${execFileSync('aws', args, { encoding: 'utf8', windowsHide: true }).trim()}.`;
  } catch {
    // identity lookup is best-effort — the diagnosis stands without it
  }
  const owner = POOL.account ? `account ${POOL.account}` : 'another account';
  const target = POOL.account ? `account ${POOL.account}` : "the pool's account";
  return (
    `${stderr}\n\n` +
    `   The pool lives in ${owner}, but this ran with ${credsInUse}.${caller}\n` +
    `   Fix: pass --profile profileName (or set AWS_PROFILE) so the CLI targets ${target}.`
  );
}

/** A user attribute value by name (e.g. 'email', 'given_name'), or undefined. */
export const attr = (user, name) => user.Attributes?.find((a) => a.Name === name)?.Value;

/** All users in the pool (list-users has no server-side substring filter). */
export function listUsers(opts) {
  const out = runAws(['cognito-idp', 'list-users', '--user-pool-id', opts.poolId], opts);
  return JSON.parse(out).Users ?? [];
}

/** The single user whose email EXACTLY matches (case-insensitive), or undefined. */
export function findUserByEmail(users, email) {
  const wanted = email.toLowerCase();
  return users.find((u) => (attr(u, 'email') ?? '').toLowerCase() === wanted);
}

/** Run a script's async main, printing an SSO hint on failure and exiting 1. */
export function runMain(mainFn) {
  mainFn().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    // A missing-config error is not an auth failure; the SSO hint would mislead.
    if (err.code !== 'CONFIG') {
      const profileArg = process.env.AWS_PROFILE ? ` --profile ${process.env.AWS_PROFILE}` : '';
      console.error(`   (expired SSO? try: aws sso login${profileArg})`);
    }
    process.exit(1);
  });
}
